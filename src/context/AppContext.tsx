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
import {
  store,
  DURATION_CACHE_KEY,
  RAW_DIR_KEY,
  PROXY_DIR_KEY,
} from "../utils/store";
import { getProxyVideoPath } from "../utils/getProxyVideoPath";

export interface FileItem {
  path: string;
  duration?: number;
  loading?: boolean;
}

interface AppContextValue {
  curCrmFile: string;
  setCurCrmFile: (path: string) => void;
  rawDir: string;
  setRawDir: (dir: string) => void;
  filesList: FileItem[];
  proxyDir: string;
  setProxyDir: (dir: string) => void;
  curProxyFilePath: string;
  curProxyFileUrl: string;
  clearDurationCache: () => Promise<void>;
  updateFileDuration: (filePath: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [curCrmFile, setCurCrmFile] = useState("");
  const [rawDir, setRawDirState] = useState("");
  const [filesList, setFilesList] = useState<FileItem[]>([]);
  const [proxyDir, setProxyDirState] = useState("");
  const [curProxyFilePath, setCurProxyFilePath] = useState("");
  const [curProxyFileUrl, setCurProxyFileUrl] = useState("");

  const durationCache = useRef(new Map<string, number>());
  const saveCacheTimer = useRef<number | null>(null);
  const readDirTimer = useRef<number | null>(null);
  const rawDirRef = useRef(rawDir);
  const filesListRef = useRef(filesList);

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
        if (!dir) return;
        try {
          const files: string[] = await invoke("read_directory_files", {
            dirPath: dir,
          });
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
          console.error("读取目录失败:", error);
        }
      }, 300) as unknown as number;
    },
    [fetchDurationsAsync],
  );

  // rawDir change: save/load cache, persist, watch, read files
  const prevRawDir = useRef("");
  const setRawDir = useCallback(
    async (newDir: string) => {
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
      if (newDir) await loadDurationCache(newDir);
    },
    [saveDurationCacheImmediate, clearDurationCache, loadDurationCache],
  );

  const setProxyDir = useCallback(async (newDir: string) => {
    setProxyDirState(newDir);
    await store.set(PROXY_DIR_KEY, newDir);
  }, []);

  // Watch rawDir: read files + Tauri watch
  useEffect(() => {
    if (!rawDir) return;
    readDirectoryFiles(rawDir);

    let unwatchCalled = false;
    const watchDir = async () => {
      try {
        await invoke("watch_directory", { dirPath: rawDir });
      } catch (error) {
        console.error(error);
      }
    };
    watchDir();

    return () => {
      if (!unwatchCalled) {
        unwatchCalled = true;
        invoke("unwatch_directory", { dirPath: rawDir }).catch(console.error);
      }
    };
  }, [rawDir, readDirectoryFiles]);

  // Listen to file-change events
  useEffect(() => {
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
  }, [readDirectoryFiles]);

  // Load duration cache on init when rawDir is set from store
  useEffect(() => {
    if (rawDir) loadDurationCache(rawDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // Save cache on page unload
  useEffect(() => {
    const handler = () => {
      if (saveCacheTimer.current !== null) clearTimeout(saveCacheTimer.current);
      if (durationCache.current.size > 0) saveDurationCacheImmediate();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveDurationCacheImmediate]);

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
