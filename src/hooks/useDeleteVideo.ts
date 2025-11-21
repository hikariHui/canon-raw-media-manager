import { invoke } from "@tauri-apps/api/core";
import { proxyDir } from "./useProxyFile";
import { getProxyVideoPath } from "../utils/getProxyVideoPath";
import { getDeletedPath } from "../utils/getDeletedPath";
import { addHistory, type Operation } from "../utils/oprationHistory";

export const deleteVideo = async (rawVideoPath: string) => {
  const proxyPath = getProxyVideoPath(rawVideoPath, proxyDir.value);
  const isProxyExists = await invoke("is_file_exists", { filePath: proxyPath });
  // 记录操作历史
  const operations: Operation[] = [];
  if (isProxyExists) {
    // 删除 proxy 文件
    const deletedProxyPath = getDeletedPath(proxyPath);
    console.log("deletedPath", deletedProxyPath);
    await invoke("move_file", {
      sourcePath: proxyPath,
      destinationPath: deletedProxyPath,
      overwrite: false,
    });
    operations.push({
      name: "moveFile",
      params: {
        sourcePath: proxyPath,
        destinationPath: deletedProxyPath,
      },
    });
  }
  // 删除原始文件
  const deletedPath = getDeletedPath(rawVideoPath);
  await invoke("move_file", {
    sourcePath: rawVideoPath,
    destinationPath: deletedPath,
    overwrite: false,
  });
  operations.push({
    name: "moveFile",
    params: {
      sourcePath: rawVideoPath,
      destinationPath: deletedPath,
    },
  });
  addHistory(operations);
};
