import { invoke } from "@tauri-apps/api/core";
import { notificationOpen } from "animal-island-ui";
import { getProxyVideoPath } from "../utils/getProxyVideoPath";
import { getDeletedPath, getStarredPath } from "../utils/getDeletedPath";
import {
  addHistory,
  withHistoryMutation,
  type Operation,
} from "../utils/oprationHistory";

const moveFile = async (
  sourcePath: string,
  destinationPath: string,
  operations: Operation[],
) => {
  const isExists = await invoke("is_file_exists", { filePath: sourcePath });
  if (!isExists) return;
  await invoke("move_file", { sourcePath, destinationPath, overwrite: false });
  operations.push({
    name: "moveFile",
    params: { sourcePath, destinationPath },
  });
};

const getCpfPath = (videoPath: string) =>
  videoPath.includes(".")
    ? videoPath.replace(/\.[^/.]+$/, ".cpf")
    : `${videoPath}.cpf`;

const batchMoveVideoFiles = async (
  paths: string[],
  destFor: (src: string) => string,
  actionLabel: string,
) => {
  const operations: Operation[] = [];
  const failed: string[] = [];
  for (const path of paths) {
    try {
      await moveFile(path, destFor(path), operations);
    } catch (e) {
      console.error(`${actionLabel}失败:`, path, e);
      failed.push(path);
    }
  }
  if (operations.length) addHistory(operations);
  if (failed.length) {
    throw new Error(
      failed.length === paths.length
        ? `${actionLabel}失败（${failed.length}）`
        : `部分${actionLabel}失败（${failed.length}/${paths.length}）`,
    );
  }
  if (paths.length && !operations.length) {
    throw new Error(`没有可${actionLabel}的文件（可能已不在原位置）`);
  }
};

const tipProxyMissing = () => {
  notificationOpen({
    type: "warning",
    message: "未配置 Proxy 目录",
    description: "将仅移动 Raw 及相关 sidecar，Proxy 不会一并处理。",
    duration: 4,
    key: "proxy-dir-missing",
  });
};

export const deleteVideo = async (rawVideoPath: string, proxyDir: string) => {
  await withHistoryMutation(async () => {
    const paths: string[] = [];
    if (proxyDir.trim()) {
      const proxyPath = getProxyVideoPath(rawVideoPath, proxyDir);
      paths.push(proxyPath, getCpfPath(proxyPath));
    } else {
      tipProxyMissing();
    }
    paths.push(rawVideoPath, getCpfPath(rawVideoPath));
    await batchMoveVideoFiles(paths, getDeletedPath, "删除");
  });
};

export const starVideo = async (rawVideoPath: string, proxyDir: string) => {
  await withHistoryMutation(async () => {
    const paths: string[] = [];
    if (proxyDir.trim()) {
      const proxyPath = getProxyVideoPath(rawVideoPath, proxyDir);
      paths.push(proxyPath, getCpfPath(proxyPath));
    } else {
      tipProxyMissing();
    }
    paths.push(rawVideoPath, getCpfPath(rawVideoPath));
    await batchMoveVideoFiles(paths, getStarredPath, "移到 starred");
  });
};
