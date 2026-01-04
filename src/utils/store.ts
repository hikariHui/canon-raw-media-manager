import { Store } from "@tauri-apps/plugin-store";

export const store = await Store.load("store.bin");

/** 存储 Key 常量 */
/** 时长缓存 */
export const DURATION_CACHE_KEY = "duration_cache";

/** Raw 文件目录路径 */
export const RAW_DIR_KEY = "raw_dir";

/** Proxy 文件目录路径 */
export const PROXY_DIR_KEY = "proxy_dir";
