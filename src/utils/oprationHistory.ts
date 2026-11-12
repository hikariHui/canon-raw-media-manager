// 操作历史记录
import { invoke } from "@tauri-apps/api/core";
import { notificationOpen } from "animal-island-ui";

/** 移动文件方法 */
type MoveFile = {
  name: "moveFile";
  params: {
    sourcePath: string;
    destinationPath: string;
  };
};

/** 操作类型 */
export type Operation = MoveFile;

/** 操作记录栈 */
const history: Operation[][] = [];

type UndoListener = () => void;
const undoListeners = new Set<UndoListener>();

let undoing = false;
/** 批量移动进行中：与 undo 互斥，避免并发 move_file 竞态 */
let mutating = false;

/** 撤销完成后的回调（用于刷新列表） */
export const onUndoComplete = (fn: UndoListener) => {
  undoListeners.add(fn);
  return () => {
    undoListeners.delete(fn);
  };
};

/** 在文件系统批量变更期间持锁；与 undo 互斥 */
export const withHistoryMutation = async <T>(
  fn: () => Promise<T>,
): Promise<T> => {
  if (undoing) {
    throw new Error("正在撤销，请稍后再操作");
  }
  if (mutating) {
    throw new Error("有文件正在移动，请稍后再试");
  }
  mutating = true;
  try {
    return await fn();
  } finally {
    mutating = false;
  }
};

/** 添加操作历史记录 */
export const addHistory = (method: Operation[]) => {
  if (!method.length) return;
  history.push(method);
};

/** 撤销操作 */
export const undo = async () => {
  if (undoing) return;
  if (mutating) {
    notificationOpen({
      type: "warning",
      message: "文件移动中",
      description: "请等当前删除/星标完成后再撤销",
      duration: 3,
      key: "undo-busy",
    });
    return;
  }
  const lastOperations = history.pop();
  if (!lastOperations?.length) {
    return;
  }

  undoing = true;
  try {
    const reversed = [...lastOperations].reverse();
    let failAt = -1;
    let failReason = "";
    let moved = 0;
    let skipped = 0;
    for (let i = 0; i < reversed.length; i++) {
      const operation = reversed[i];
      switch (operation.name) {
        case "moveFile": {
          const { sourcePath, destinationPath } = operation.params;
          try {
            // 撤销：从 destination 移回 source；源位已不存在则幂等跳过
            const stillThere = await invoke<boolean>("is_file_exists", {
              filePath: destinationPath,
            });
            if (!stillThere) {
              skipped += 1;
              break;
            }
            await invoke("move_file", {
              sourcePath: destinationPath,
              destinationPath: sourcePath,
              overwrite: false,
            });
            moved += 1;
          } catch (e) {
            console.error("撤销移动失败:", e);
            failAt = i;
            failReason = e instanceof Error ? e.message : String(e);
          }
          break;
        }
        default:
          break;
      }
      if (failAt >= 0) break;
    }

    // 未成功撤销的操作压回栈，便于重试。
    // 搁置：部分已成功移回的项不压回——再撤销会把已恢复文件又挪走，更乱。
    if (failAt >= 0) {
      const notUndone = reversed.slice(failAt);
      history.push([...notUndone].reverse());
      notificationOpen({
        type: "error",
        message: "撤销未全部完成",
        description:
          failReason ||
          "部分文件未能移回（原路径可能已有同名文件），可再试一次 Cmd/Ctrl+Z",
        duration: 4,
        key: "undo-failed",
      });
    } else if (moved === 0 && skipped > 0) {
      // 整批幂等跳过：压回栈，文件稍后回来仍可再撤销
      history.push(lastOperations);
      notificationOpen({
        type: "info",
        message: "无需撤销",
        description: "相关文件已不在目标位置",
        duration: 3,
        key: "undo-noop",
      });
    }

    undoListeners.forEach((fn) => fn());
  } finally {
    undoing = false;
  }
};
