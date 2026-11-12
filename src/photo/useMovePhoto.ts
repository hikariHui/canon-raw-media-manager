import { invoke } from "@tauri-apps/api/core";
import { notificationOpen } from "animal-island-ui";
import { getDeletedPath, getStarredPath } from "../utils/getDeletedPath";
import {
  addHistory,
  withHistoryMutation,
  type Operation,
} from "../utils/oprationHistory";

export class PartialMoveError extends Error {
  failed: string[];
  constructor(message: string, failed: string[]) {
    super(message);
    this.name = "PartialMoveError";
    this.failed = failed;
  }
}

/** @returns 是否实际发生了移动 */
const moveFile = async (
  sourcePath: string,
  destinationPath: string,
  operations: Operation[],
): Promise<boolean> => {
  // 特性：源已不存在则幂等跳过（不抛错、不入撤销栈）
  const isExists = await invoke("is_file_exists", { filePath: sourcePath });
  if (!isExists) return false;
  // 特性：不覆盖 deleted/starred 已有同名，避免悄悄冲掉旧内容（与视频侧一致）
  await invoke("move_file", { sourcePath, destinationPath, overwrite: false });
  operations.push({
    name: "moveFile",
    params: { sourcePath, destinationPath },
  });
  return true;
};

/**
 * macOS 默认 APFS/HFS+ 大小写不敏感：`.JPG` 与 `.jpg` 是同一文件。
 * 每组只尝试移动「第一个真实存在」的变体，避免双记撤销栈 / 误报侧车失败。
 */
const SIDECAR_EXT_GROUPS = [
  [".JPG", ".jpg", ".JPEG", ".jpeg"],
  [".xmp", ".XMP"],
] as const;

const tipSidecarFailed = (cr3Path: string, failed: string[]) => {
  const name = cr3Path.split(/[/\\]/).pop() ?? cr3Path;
  const names = failed.map((p) => p.split(/[/\\]/).pop() ?? p);
  notificationOpen({
    type: "warning",
    message: "附属文件未完全移动",
    description: `${name} 已处理，但 ${names.join("、")} 仍留在原目录，请手动检查。`,
    duration: 6,
    key: `sidecar-failed-${cr3Path}`,
  });
};

const movePhotoWithSidecars = async (
  cr3Path: string,
  destFor: (src: string) => string,
  operations: Operation[],
) => {
  // CR3 为准：主文件未移动则不碰 sidecar，避免孤废附属文件
  // 源已不存在：与视频侧一致，幂等跳过（不进 failed、不抛错）
  const cr3Moved = await moveFile(cr3Path, destFor(cr3Path), operations);
  if (!cr3Moved) return;
  // sidecar 尽力移动，不因侧车失败回滚 CR3
  const base = cr3Path.replace(/\.[^/.]+$/, "");
  const sidecarFailed: string[] = [];
  for (const exts of SIDECAR_EXT_GROUPS) {
    let candidate: string | null = null;
    for (const ext of exts) {
      const side = `${base}${ext}`;
      const exists = await invoke<boolean>("is_file_exists", {
        filePath: side,
      });
      if (exists) {
        candidate = side;
        break;
      }
    }
    if (!candidate) continue;
    try {
      await moveFile(candidate, destFor(candidate), operations);
    } catch (e) {
      console.warn("sidecar 移动失败（已忽略）:", candidate, e);
      sidecarFailed.push(candidate);
    }
  }
  if (sidecarFailed.length) tipSidecarFailed(cr3Path, sidecarFailed);
};

const batchMovePhotos = async (
  paths: string[],
  destFor: (src: string) => string,
  actionLabel: string,
) => {
  const operations: Operation[] = [];
  const failed: string[] = [];
  for (const path of paths) {
    try {
      await movePhotoWithSidecars(path, destFor, operations);
    } catch (e) {
      console.error(`${actionLabel}失败:`, path, e);
      failed.push(path);
    }
  }
  // 即使后续失败，已成功移动的也要可撤销
  if (operations.length) addHistory(operations);
  if (failed.length) {
    throw new PartialMoveError(
      failed.length === paths.length
        ? `${actionLabel}失败（${failed.length}）`
        : `部分${actionLabel}失败（${failed.length}/${paths.length}）`,
      failed,
    );
  }
  if (paths.length && !operations.length) {
    throw new Error(`没有可${actionLabel}的文件（可能已不在原位置）`);
  }
};

export const deletePhotos = async (paths: string[]) =>
  withHistoryMutation(() => batchMovePhotos(paths, getDeletedPath, "删除"));

export const starPhotos = async (paths: string[]) =>
  withHistoryMutation(() =>
    batchMovePhotos(paths, getStarredPath, "移到 starred"),
  );
