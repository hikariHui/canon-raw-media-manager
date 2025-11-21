import { ref, watch } from "vue";
import { curCrmFile } from "./useRawFile";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getProxyVideoPath } from "../utils/getProxyVideoPath";
import { store } from "../utils/store";

/** proxy 文件目录路径 */
export const proxyDir = ref((await store.get<string>("proxyDir")) || "");

// 监听 proxyDir 变化，保存到 store 中
watch(proxyDir, async (newDir) => {
  await store.set("proxyDir", newDir);
});

/** 当前选中的 proxy 文件路径 */
export const curProxyFilePath = ref("");
/** 当前选中的 proxy 文件 url */
export const curProxyFileUrl = ref("");

watch([curCrmFile, proxyDir], async ([crmPath]) => {
  // 如果当前选中的 raw 文件为空，则设置当前选中的 proxy 文件 url 为空
  if (!crmPath) {
    curProxyFileUrl.value = "";
    curProxyFilePath.value = "";
    return;
  }
  // 如果 proxy 文件目录路径为空，则设置当前选中的 proxy 文件 url 为空
  if (!proxyDir.value) {
    curProxyFileUrl.value = "";
    curProxyFilePath.value = "";
    return;
  }
  const proxyPath = getProxyVideoPath(crmPath, proxyDir.value);
  const isExists = await invoke("is_file_exists", { filePath: proxyPath });
  // 如果 proxy 文件存在，则设置当前选中的 proxy 文件 url 为 proxy 文件 url
  if (isExists) {
    curProxyFileUrl.value = convertFileSrc(proxyPath);
    curProxyFilePath.value = proxyPath;
    console.log("file exists");
  } else {
    curProxyFileUrl.value = "";
    curProxyFilePath.value = "";
    console.log("file not exists");
  }
});
