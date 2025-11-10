import { invoke } from "@tauri-apps/api/core";
import { proxyDir } from "./useProxyFile";
import { getProxyVideoPath } from "../utils/getProxyVideoPath";
import { getDeletedPath } from "../utils/getDeletedPath";

export const deleteVideo = async (rawVideoPath: string) => {
  const proxyPath = getProxyVideoPath(rawVideoPath, proxyDir.value);
  const isProxyExists = await invoke("is_file_exists", { filePath: proxyPath });
  if (isProxyExists) {
    // 删除 proxy 文件
    const deletedProxyPath = getDeletedPath(proxyPath);
    console.log("deletedPath", deletedProxyPath);
    await invoke("move_file", {
      sourcePath: proxyPath,
      destinationPath: deletedProxyPath,
      overwrite: false,
    });
  }
  // 删除原始文件
  const deletedPath = getDeletedPath(rawVideoPath);
  await invoke("move_file", {
    sourcePath: rawVideoPath,
    destinationPath: deletedPath,
    overwrite: false,
  });
};
