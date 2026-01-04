import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { store, DURATION_CACHE_KEY, RAW_DIR_KEY } from "../utils/store";

/** 文件信息接口 */
export interface FileItem {
  path: string;
  duration?: number; // 时长（秒）
  loading?: boolean; // 是否正在加载
}

/** 当前选中的 raw 文件 */
export const curCrmFile = ref("");

/** raw 文件目录路径 */
export const rawDir = ref((await store.get<string>(RAW_DIR_KEY)) || "");

/** raw 文件列表 */
export const filesList = ref<FileItem[]>([]);

/** 时长缓存 - 使用 Map 存储在内存中 */
const durationCache = new Map<string, number>();

/** 保存缓存的防抖定时器 */
let saveCacheTimer: number | null = null;

/** 从持久化存储加载时长缓存 */
const loadDurationCache = async () => {
  try {
    if (!rawDir.value) {
      return;
    }
    const cached = await store.get<Record<string, number>>(DURATION_CACHE_KEY);
    if (cached) {
      durationCache.clear();
      Object.entries(cached).forEach(([path, duration]) => {
        durationCache.set(path, duration);
      });
      console.log(`加载了 ${durationCache.size} 个时长缓存`);
    }
  } catch (error) {
    console.error("加载时长缓存失败:", error);
  }
};

/** 保存时长缓存到持久化存储（立即保存） */
const saveDurationCacheImmediate = async () => {
  try {
    const cacheObject: Record<string, number> = {};
    durationCache.forEach((duration, path) => {
      cacheObject[path] = duration;
    });
    await store.set(DURATION_CACHE_KEY, cacheObject);
    console.log("时长缓存已保存");
  } catch (error) {
    console.error("保存时长缓存失败:", error);
  }
};

/** 保存时长缓存到持久化存储（带防抖，延迟2秒） */
const saveDurationCache = () => {
  // 清除之前的定时器
  if (saveCacheTimer !== null) {
    clearTimeout(saveCacheTimer);
  }

  // 设置新的定时器，2秒后保存
  saveCacheTimer = setTimeout(() => {
    saveDurationCacheImmediate();
    saveCacheTimer = null;
  }, 2000) as unknown as number;
};

/** 清空时长缓存（供外部调用） */
export const clearDurationCache = async () => {
  try {
    await store.delete(DURATION_CACHE_KEY);
    durationCache.clear();
    console.log("已清空时长缓存");
  } catch (error) {
    console.error("清空时长缓存失败:", error);
  }
};

// 监听 rawDir 变化
watch(rawDir, async (newDir, oldDir) => {
  // 切换目录时，先立即保存当前缓存，然后清空
  if (oldDir && oldDir !== newDir) {
    // 取消防抖定时器，立即保存
    if (saveCacheTimer !== null) {
      clearTimeout(saveCacheTimer);
      saveCacheTimer = null;
    }
    // 立即保存旧目录的缓存
    if (durationCache.size > 0) {
      await saveDurationCacheImmediate();
    }
    // 清空缓存
    await clearDurationCache();
    console.log("切换目录，已保存并清空时长缓存");
  }

  // 保存新目录路径
  await store.set(RAW_DIR_KEY, newDir);

  // 加载新目录的缓存（如果有）
  if (newDir) {
    await loadDurationCache();
  }
});

/** 获取视频时长 */
const getVideoDuration = async (
  filePath: string,
  forceUpdate = false,
): Promise<number | undefined> => {
  // 如果不强制更新，先检查缓存
  if (!forceUpdate && durationCache.has(filePath)) {
    return durationCache.get(filePath);
  }

  try {
    const info: { duration: number } = await invoke("get_video_info", {
      videoPath: filePath,
    });
    const duration = info.duration;
    // 保存到缓存
    durationCache.set(filePath, duration);
    // 防抖保存到持久化存储
    saveDurationCache();
    return duration;
  } catch (error) {
    console.error(`获取视频时长失败: ${filePath}`, error);
    return undefined;
  }
};

/** 更新指定文件的时长（供外部调用） */
export const updateFileDuration = async (filePath: string) => {
  const duration = await getVideoDuration(filePath, true);
  const fileItem = filesList.value.find((f) => f.path === filePath);
  if (fileItem && duration !== undefined) {
    fileItem.duration = duration;
    fileItem.loading = false;
  }
};

/** 批量异步获取时长 */
const fetchDurationsAsync = async (files: FileItem[]) => {
  // 计算需要获取的文件数量
  const needFetch = files.filter(
    (file) => file.duration === undefined && !file.loading,
  );

  if (needFetch.length === 0) {
    return;
  }

  console.log(`开始异步获取 ${needFetch.length} 个文件的时长...`);

  // 逐个异步获取时长
  for (const file of needFetch) {
    file.loading = true;

    // 异步获取时长
    getVideoDuration(file.path).then((duration) => {
      const fileItem = filesList.value.find((f) => f.path === file.path);
      if (fileItem) {
        fileItem.duration = duration;
        fileItem.loading = false;
      }
    });
  }
};

/** 读取 raw 文件列表 */
let readDirectoryFilesTimer: number | null = null;
const readDirectoryFiles = async () => {
  if (readDirectoryFilesTimer) {
    clearTimeout(readDirectoryFilesTimer);
  }
  readDirectoryFilesTimer = setTimeout(async () => {
    const files: string[] = await invoke("read_directory_files", {
      dirPath: rawDir.value,
    });
    const filteredFiles = files.filter(
      (file) =>
        file.toLowerCase().endsWith(".crm") ||
        file.toLowerCase().endsWith(".mp4"),
    );

    // 转换为 FileItem 格式
    filesList.value = filteredFiles.map((path) => ({
      path,
      duration: durationCache.get(path), // 从缓存中获取时长
      loading: false,
    }));

    // 异步获取所有文件的时长
    fetchDurationsAsync(filesList.value);
  }, 300);
};

/** 监听目录变化 */
const watchDirectory = async (newVal: string, oldVal?: string) => {
  try {
    if (oldVal) {
      await invoke("unwatch_directory", { dirPath: oldVal });
    }
  } catch (error) {
    console.error(error);
  }
  const result = await invoke("watch_directory", { dirPath: newVal });
  console.log(result);
};

// 监听 raw 文件目录变化
watch(
  rawDir,
  (newVal, oldVal) => {
    readDirectoryFiles();
    watchDirectory(newVal, oldVal);
  },
  { immediate: true },
);

// 监听文件变化
listen(
  "file-change",
  (event: {
    event: string;
    payload: { kind: string; dir_path: string; paths: string[] };
    id: number;
  }) => {
    if (event.payload.dir_path !== rawDir.value) {
      return;
    }
    // 重新读取目录文件
    readDirectoryFiles();
  },
);

// 初始化：如果有目录，加载缓存
if (rawDir.value) {
  loadDurationCache();
}

// 页面卸载时立即保存缓存
window.addEventListener("beforeunload", () => {
  if (saveCacheTimer !== null) {
    clearTimeout(saveCacheTimer);
  }
  if (durationCache.size > 0) {
    // 使用同步方式尝试保存（注意：beforeunload 中异步操作可能不可靠）
    saveDurationCacheImmediate();
  }
});
