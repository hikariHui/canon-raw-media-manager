import { invoke } from "@tauri-apps/api/core";
import { proxyDir } from "./useProxyFile";
import { getProxyVideoPath } from "../utils/getProxyVideoPath";
import { getDeletedPath } from "../utils/getDeletedPath";
import { addHistory, type Operation } from "../utils/oprationHistory";

/** 删除文件操作 */
const deleteFile = async (sourcePath: string, operations: Operation[]) => {
  // 检查文件是否存在
  const isExists = await invoke("is_file_exists", { filePath: sourcePath });
  if (!isExists) {
    return;
  }

  // 移动文件到已删除文件夹
  const destinationPath = getDeletedPath(sourcePath);
  await invoke("move_file", {
    sourcePath,
    destinationPath,
    overwrite: false,
  });
  operations.push({
    name: "moveFile",
    params: {
      sourcePath,
      destinationPath,
    },
  });
};

/** 获取对应的 cpf 文件路径 */
const getCpfPath = (videoPath: string) => {
  return videoPath && videoPath.includes(".")
    ? videoPath.replace(/\.[^/.]+$/, ".cpf")
    : `${videoPath}.cpf`;
};

export const deleteVideo = async (rawVideoPath: string) => {
  // 记录操作历史
  const operations: Operation[] = [];
  // 删除 proxy 文件
  const proxyPath = getProxyVideoPath(rawVideoPath, proxyDir.value);
  await deleteFile(proxyPath, operations);
  // 删除 proxy cpf 文件
  const proxyCpfPath = getCpfPath(proxyPath);
  await deleteFile(proxyCpfPath, operations);
  // 删除原始文件
  await deleteFile(rawVideoPath, operations);
  // 删除原始 cpf 文件
  const rawCpfPath = getCpfPath(rawVideoPath);
  await deleteFile(rawCpfPath, operations);
  // 添加操作历史
  addHistory(operations);
};
