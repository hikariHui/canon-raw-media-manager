import { Store } from "@tauri-apps/plugin-store";

export const store = await Store.load("store.bin");

/** 存储 Key 常量 */
/** 时长缓存 */
export const DURATION_CACHE_KEY = "duration_cache";

/** Raw 文件目录路径 */
export const RAW_DIR_KEY = "raw_dir";

/** Proxy 文件目录路径 */
export const PROXY_DIR_KEY = "proxy_dir";

/** 存储卡根路径列表 */
export const CARD_PATHS_KEY = "card_paths";

/** 导出目标路径列表 */
export const EXPORT_PATHS_KEY = "export_paths";

/** 允许管理的文件根目录列表（空则禁止选择 Raw/Proxy） */
export const ALLOWED_MANAGED_DIRS_KEY = "allowed_managed_dirs";
