import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { store } from "../utils/store";

/** 当前选中的 raw 文件 */
export const curCrmFile = ref("");

/** raw 文件目录路径 */
export const rawDir = ref((await store.get<string>("rawDir")) || "");

// 监听 rawDir 变化，保存到 store 中
watch(rawDir, async (newDir) => {
  await store.set("rawDir", newDir);
});

/** raw 文件列表 */
export const filesList = ref<string[]>([]);

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
    filesList.value = files.filter(
      (file) =>
        file.toLowerCase().endsWith(".crm") ||
        file.toLowerCase().endsWith(".mp4"),
    );
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
