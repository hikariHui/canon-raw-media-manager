import { ref, watch } from "vue";
import { curCrmFile } from "./useRawFile";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

/** proxy 文件目录路径 */
export const proxyDir = ref("");

/** 当前选中的 proxy 文件 url */
export const curProxyFileUrl = ref("");
watch([curCrmFile, proxyDir], async ([crmPath]) => {
  // 如果当前选中的 raw 文件为空，则设置当前选中的 proxy 文件 url 为空
  if (!crmPath) {
    curProxyFileUrl.value = "";
    return;
  }
  // 如果 proxy 文件目录路径为空，则设置当前选中的 proxy 文件 url 为空
  if (!proxyDir.value) {
    curProxyFileUrl.value = "";
    return;
  }
  const crmFileName = crmPath.split(/[\\/]/).pop();
  const crmName = crmFileName?.split(".").shift();
  const proxyPath =
    proxyDir.value.replace(/[\\/]$/, "") + "/" + crmName + "_proxy.mp4";
  const isExists = await invoke("is_file_exists", { filePath: proxyPath });
  // 如果 proxy 文件存在，则设置当前选中的 proxy 文件 url 为 proxy 文件 url
  if (isExists) {
    curProxyFileUrl.value = convertFileSrc(proxyPath);
    console.log("file exists");
  } else {
    curProxyFileUrl.value = "";
    console.log("file not exists");
  }
});
