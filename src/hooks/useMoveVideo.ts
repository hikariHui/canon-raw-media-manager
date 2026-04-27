import { invoke } from "@tauri-apps/api/core";
import { getProxyVideoPath } from "../utils/getProxyVideoPath";
import { getDeletedPath, getStarredPath } from "../utils/getDeletedPath";
import { addHistory, type Operation } from "../utils/oprationHistory";

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

const deleteFile = async (sourcePath: string, operations: Operation[]) =>
  moveFile(sourcePath, getDeletedPath(sourcePath), operations);

const starFile = async (sourcePath: string, operations: Operation[]) =>
  moveFile(sourcePath, getStarredPath(sourcePath), operations);

const getCpfPath = (videoPath: string) =>
  videoPath.includes(".")
    ? videoPath.replace(/\.[^/.]+$/, ".cpf")
    : `${videoPath}.cpf`;

export const deleteVideo = async (rawVideoPath: string, proxyDir: string) => {
  const operations: Operation[] = [];
  const proxyPath = getProxyVideoPath(rawVideoPath, proxyDir);
  await deleteFile(proxyPath, operations);
  await deleteFile(getCpfPath(proxyPath), operations);
  await deleteFile(rawVideoPath, operations);
  await deleteFile(getCpfPath(rawVideoPath), operations);
  addHistory(operations);
};

export const starVideo = async (rawVideoPath: string, proxyDir: string) => {
  const operations: Operation[] = [];
  const proxyPath = getProxyVideoPath(rawVideoPath, proxyDir);
  await starFile(proxyPath, operations);
  await starFile(getCpfPath(proxyPath), operations);
  await starFile(rawVideoPath, operations);
  await starFile(getCpfPath(rawVideoPath), operations);
  addHistory(operations);
};
