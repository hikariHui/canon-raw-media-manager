import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { notificationOpen } from "animal-island-ui";
import {
  store,
  DURATION_CACHE_KEY,
  RAW_DIR_KEY,
  PROXY_DIR_KEY,
} from "../utils/store";
import { useAppMode } from "./ModeContext";
import { ensureAllowedManagedDir } from "../utils/allowedDirs";
import { onUndoComplete } from "../utils/oprationHistory";
import { getProxyVideoPath } from "../utils/getProxyVideoPath";

export interface FileItem {
  path: string;
  duration?: number;
  loading?: boolean;
}

interface FindProxyResult {
  path: string | null;
  cancelled: boolean;
}

export type ProxySearchPhase = "idle" | "searching" | "not_found";

interface AppContextValue {
  curCrmFile: string;
  setCurCrmFile: (path: string) => void;
  rawDir: string;
  setRawDir: (dir: string) => Promise<boolean>;
  filesList: FileItem[];
  proxyDir: string;
  setProxyDir: (dir: string) => Promise<boolean>;
  curProxyFilePath: string;
  curProxyFileUrl: string;
  clearDurationCache: () => Promise<void>;
  updateFileDuration: (filePath: string) => Promise<void>;
  proxySearchPhase: ProxySearchPhase;
  cancelProxySearch: () => Promise<void>;
  dismissProxySearchNotFound: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useAppMode();
  const [curCrmFile, setCurCrmFile] = useState("");
  const [rawDir, setRawDirState] = useState("");
  const [filesList, setFilesList] = useState<FileItem[]>([]);
  const [proxyDir, setProxyDirState] = useState("");
  const [curProxyFilePath, setCurProxyFilePath] = useState("");
  const [curProxyFileUrl, setCurProxyFileUrl] = useState("");
  const [proxySearchPhase, setProxySearchPhase] =
    useState<ProxySearchPhase>("idle");

  const durationCache = useRef(new Map<string, number>());
  const saveCacheTimer = useRef<number | null>(null);
  const readDirTimer = useRef<number | null>(null);
  const readDirGen = useRef(0);
  const rawDirRef = useRef(rawDir);
  const filesListRef = useRef(filesList);
  const proxySearchGen = useRef(0);
  const proxySearchDelayTimer = useRef<number | null>(null);

  useEffect(() => {
    rawDirRef.current = rawDir;
  }, [rawDir]);

  useEffect(() => {
    filesListRef.current = filesList;
  }, [filesList]);

  // Init: load persisted dirs
  useEffect(() => {
    const init = async () => {
      const savedRaw = await store.get<string>(RAW_DIR_KEY);
      const savedProxy = await store.get<string>(PROXY_DIR_KEY);
      if (savedRaw) setRawDirState(savedRaw);
      if (savedProxy) setProxyDirState(savedProxy);
    };
    init();
  }, []);

  const saveDurationCacheImmediate = useCallback(async () => {
    try {
      const cacheObject: Record<string, number> = {};
      durationCache.current.forEach((duration, path) => {
        cacheObject[path] = duration;
      });
      await store.set(DURATION_CACHE_KEY, cacheObject);
    } catch (error) {
      console.error("保存时长缓存失败:", error);
    }
  }, []);

  const saveDurationCache = useCallback(() => {
    if (saveCacheTimer.current !== null) clearTimeout(saveCacheTimer.current);
    saveCacheTimer.current = setTimeout(() => {
      saveDurationCacheImmediate();
      saveCacheTimer.current = null;
    }, 2000) as unknown as number;
  }, [saveDurationCacheImmediate]);

  const loadDurationCache = useCallback(async (dir: string) => {
    if (!dir) return;
    try {
      const cached =
        await store.get<Record<string, number>>(DURATION_CACHE_KEY);
      if (cached) {
        durationCache.current.clear();
        Object.entries(cached).forEach(([path, duration]) => {
          durationCache.current.set(path, duration);
        });
      }
    } catch (error) {
      console.error("加载时长缓存失败:", error);
    }
  }, []);

  const clearDurationCache = useCallback(async () => {
    try {
      await store.delete(DURATION_CACHE_KEY);
      durationCache.current.clear();
    } catch (error) {
      console.error("清空时长缓存失败:", error);
    }
  }, []);

  const getVideoDuration = useCallback(
    async (
      filePath: string,
      forceUpdate = false,
    ): Promise<number | undefined> => {
      if (!forceUpdate && durationCache.current.has(filePath)) {
        return durationCache.current.get(filePath);
      }
      try {
        const info: { duration: number } = await invoke("get_video_info", {
          videoPath: filePath,
        });
        durationCache.current.set(filePath, info.duration);
        saveDurationCache();
        return info.duration;
      } catch {
        return undefined;
      }
    },
    [saveDurationCache],
  );

  const updateFileDuration = useCallback(
    async (filePath: string) => {
      const duration = await getVideoDuration(filePath, true);
      setFilesList((prev) =>
        prev.map((f) =>
          f.path === filePath ? { ...f, duration, loading: false } : f,
        ),
      );
    },
    [getVideoDuration],
  );

  const fetchDurationsAsync = useCallback(
    (files: FileItem[]) => {
      const needFetch = files.filter(
        (f) => f.duration === undefined && !f.loading,
      );
      for (const file of needFetch) {
        setFilesList((prev) =>
          prev.map((f) => (f.path === file.path ? { ...f, loading: true } : f)),
        );
        getVideoDuration(file.path).then((duration) => {
          setFilesList((prev) =>
            prev.map((f) =>
              f.path === file.path ? { ...f, duration, loading: false } : f,
            ),
          );
        });
      }
    },
    [getVideoDuration],
  );

  const readDirectoryFiles = useCallback(
    (dir: string) => {
      if (readDirTimer.current) clearTimeout(readDirTimer.current);
      readDirTimer.current = setTimeout(async () => {
        const gen = ++readDirGen.current;
        if (!dir) return;
        try {
          const files: string[] = await invoke("read_directory_files", {
            dirPath: dir,
          });
          if (gen !== readDirGen.current) return;
          const filteredFiles = files.filter(
            (f) =>
              f.toLowerCase().endsWith(".crm") ||
              f.toLowerCase().endsWith(".mp4"),
          );
          const items: FileItem[] = filteredFiles.map((path) => ({
            path,
            duration: durationCache.current.get(path),
            loading: false,
          }));
          setFilesList(items);
          fetchDurationsAsync(items);
        } catch (error) {
          if (gen !== readDirGen.current) return;
          console.error("读取目录失败:", error);
        }
      }, 300) as unknown as number;
    },
    [fetchDurationsAsync],
  );

  // rawDir / proxyDir setters + auto proxy search
  const prevRawDir = useRef("");

  const setProxyDir = useCallback(async (newDir: string) => {
    if (newDir && !(await ensureAllowedManagedDir(newDir, "Proxy"))) {
      return false;
    }
    setProxyDirState(newDir);
    await store.set(PROXY_DIR_KEY, newDir);
    return true;
  }, []);

  const clearProxySearchDelay = useCallback(() => {
    if (proxySearchDelayTimer.current !== null) {
      clearTimeout(proxySearchDelayTimer.current);
      proxySearchDelayTimer.current = null;
    }
  }, []);

  const cancelProxySearch = useCallback(async () => {
    proxySearchGen.current += 1;
    clearProxySearchDelay();
    setProxySearchPhase("idle");
    try {
      await invoke("cancel_find_proxy_directory");
    } catch (error) {
      console.error("取消 Proxy 搜索失败:", error);
    }
  }, [clearProxySearchDelay]);

  const dismissProxySearchNotFound = useCallback(() => {
    setProxySearchPhase("idle");
  }, []);

  const startProxySearch = useCallback(
    async (dir: string) => {
      if (!dir) return;

      // 取消上一轮搜索，避免结果写回旧目录
      try {
        await invoke("cancel_find_proxy_directory");
      } catch {
        // ignore
      }

      const gen = ++proxySearchGen.current;
      clearProxySearchDelay();
      setProxySearchPhase("idle");
      proxySearchDelayTimer.current = setTimeout(() => {
        if (proxySearchGen.current === gen) {
          setProxySearchPhase("searching");
        }
      }, 400) as unknown as number;

      try {
        const result = await invoke<FindProxyResult>("find_proxy_directory", {
          rawDir: dir,
        });
        if (proxySearchGen.current !== gen) return;
        clearProxySearchDelay();
        if (result.cancelled) {
          setProxySearchPhase("idle");
          return;
        }
        if (result.path) {
          // 自动结果若超出白名单：静默拒绝，提示手动选择
          const allowed = await ensureAllowedManagedDir(result.path, "Proxy", {
            silent: true,
          });
          if (!allowed) {
            setProxySearchPhase("not_found");
            return;
          }
          setProxySearchPhase("idle");
          await setProxyDir(result.path);
        } else {
          setProxySearchPhase("not_found");
        }
      } catch (error) {
        if (proxySearchGen.current !== gen) return;
        clearProxySearchDelay();
        setProxySearchPhase("not_found");
        console.error("自动搜索 Proxy 目录失败:", error);
      }
    },
    [clearProxySearchDelay, setProxyDir],
  );

  const setRawDir = useCallback(
    async (newDir: string) => {
      if (newDir && !(await ensureAllowedManagedDir(newDir, "Raw"))) {
        return false;
      }
      const oldDir = prevRawDir.current;
      if (oldDir && oldDir !== newDir) {
        if (saveCacheTimer.current !== null) {
          clearTimeout(saveCacheTimer.current);
          saveCacheTimer.current = null;
        }
        if (durationCache.current.size > 0) await saveDurationCacheImmediate();
        await clearDurationCache();
      }
      prevRawDir.current = newDir;
      setRawDirState(newDir);
      await store.set(RAW_DIR_KEY, newDir);
      if (newDir) {
        await loadDurationCache(newDir);
        void startProxySearch(newDir);
      }
      return true;
    },
    [
      saveDurationCacheImmediate,
      clearDurationCache,
      loadDurationCache,
      startProxySearch,
    ],
  );

  // 仅视频模式监听/扫描 Raw 目录
  useEffect(() => {
    if (mode !== "video" || !rawDir) return;
    readDirectoryFiles(rawDir);

    let unwatchCalled = false;
    let pollTimer: number | null = null;
    let cancelled = false;

    invoke("watch_directory", { dirPath: rawDir }).catch((error) => {
      console.error("监听视频目录失败，改为定时刷新:", error);
      if (cancelled) return;
      notificationOpen({
        type: "warning",
        message: "目录监听失败",
        description: "已改为定时刷新列表，外部增删文件可能稍有延迟。",
        duration: 4,
        key: "video-watch-fallback",
      });
      pollTimer = window.setInterval(() => {
        if (rawDirRef.current) readDirectoryFiles(rawDirRef.current);
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (pollTimer != null) clearInterval(pollTimer);
      if (!unwatchCalled) {
        unwatchCalled = true;
        invoke("unwatch_directory", { dirPath: rawDir }).catch(console.error);
      }
    };
  }, [mode, rawDir, readDirectoryFiles]);

  useEffect(() => {
    if (mode !== "video") return;
    const unlisten = listen(
      "file-change",
      (event: {
        payload: { kind: string; dir_path: string; paths: string[] };
      }) => {
        if (event.payload.dir_path !== rawDirRef.current) return;
        readDirectoryFiles(rawDirRef.current);
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [mode, readDirectoryFiles]);

  // 全局撤销栈跨模式共用：不论当前 mode，有 rawDir 就刷新
  useEffect(() => {
    return onUndoComplete(() => {
      if (rawDirRef.current) readDirectoryFiles(rawDirRef.current);
    });
  }, [readDirectoryFiles]);

  // store 异步恢复 rawDir 后也要加载时长缓存（勿只在 mount 时空 rawDir 时跑一次）
  useEffect(() => {
    if (rawDir) void loadDurationCache(rawDir);
  }, [rawDir, loadDurationCache]);

  // Save cache on page unload
  useEffect(() => {
    const handler = () => {
      if (saveCacheTimer.current !== null) clearTimeout(saveCacheTimer.current);
      if (durationCache.current.size > 0) saveDurationCacheImmediate();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveDurationCacheImmediate]);

  // Cleanup proxy search timers on unmount
  useEffect(() => {
    return () => {
      clearProxySearchDelay();
      invoke("cancel_find_proxy_directory").catch(() => {});
    };
  }, [clearProxySearchDelay]);

  // Resolve proxy file when curCrmFile or proxyDir changes
  useEffect(() => {
    const resolve = async () => {
      if (!curCrmFile || !proxyDir) {
        setCurProxyFilePath("");
        setCurProxyFileUrl("");
        return;
      }
      const proxyPath = getProxyVideoPath(curCrmFile, proxyDir);
      const isExists = await invoke<boolean>("is_file_exists", {
        filePath: proxyPath,
      });
      if (isExists) {
        setCurProxyFilePath(proxyPath);
        setCurProxyFileUrl(convertFileSrc(proxyPath));
      } else {
        setCurProxyFilePath("");
        setCurProxyFileUrl("");
      }
    };
    resolve();
  }, [curCrmFile, proxyDir]);

  return (
    <AppContext.Provider
      value={{
        curCrmFile,
        setCurCrmFile,
        rawDir,
        setRawDir,
        filesList,
        proxyDir,
        setProxyDir,
        curProxyFilePath,
        curProxyFileUrl,
        clearDurationCache,
        updateFileDuration,
        proxySearchPhase,
        cancelProxySearch,
        dismissProxySearchNotFound,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
