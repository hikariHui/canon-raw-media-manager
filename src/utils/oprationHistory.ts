// 操作历史记录
import { invoke } from "@tauri-apps/api/core";

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

/** 添加操作历史记录 */
export const addHistory = (method: Operation[]) => {
  history.push(method);
  console.log("history", history);
};

/** 撤销操作 */
export const undo = () => {
  const lastOperations = history.pop();
  if (!lastOperations) {
    return;
  }
  lastOperations.reverse().forEach(async (operation) => {
    switch (operation.name) {
      case "moveFile":
        const { sourcePath, destinationPath } = operation.params;
        await invoke("move_file", {
          sourcePath: destinationPath,
          destinationPath: sourcePath,
          overwrite: false,
        });
        break;
      default:
        break;
    }
  });
};
