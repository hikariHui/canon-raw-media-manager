import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { notificationOpen } from "animal-island-ui";
import { useAppMode } from "../context/ModeContext";
import { ensureAllowedManagedDir } from "../utils/allowedDirs";
import { onUndoComplete } from "../utils/oprationHistory";
import { PHOTO_DIR_KEY, store } from "../utils/store";
import { groupBursts, type BurstGroup, type PhotoMeta } from "./groupBursts";
import { pruneThumbHeavyPaths } from "./LazyThumb";
import { invalidateCr3Preview, pruneCr3PreviewCache } from "./useCr3Preview";

export const MAX_COMPARE = 16;

const tipCompareLimit = (extra?: string) => {
  notificationOpen({
    type: "warning",
    message: `对比最多 ${MAX_COMPARE} 张`,
    description: extra ?? "请先取消部分对比，再添加新的照片。",
    duration: 3,
    key: "compare-limit",
  });
};

export interface SyncViewport {
  scale: number;
  x: number;
  y: number;
}

interface PhotoContextValue {
  photoDir: string;
  setPhotoDir: (dir: string) => Promise<boolean>;
  photos: PhotoMeta[];
  groups: BurstGroup[];
  loading: boolean;
  /** 列表已出、元数据仍在渐进解析 */
  enriching: boolean;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  activeGroup: BurstGroup | null;
  selectedPaths: Set<string>;
  /** 多选锚点（最近一次点选），回退预览优先用它 */
  selectionAnchor: string | null;
  toggleSelect: (path: string) => void;
  selectOnly: (path: string) => void;
  /** 从锚点到目标做范围多选（含两端，可跨连拍组） */
  selectRangeTo: (toPath: string) => void;
  clearSelection: () => void;
  /** 保留指定路径为选中（用于部分失败后重试） */
  selectPaths: (paths: string[]) => void;
  selectAllInGroup: () => void;
  /** 在全部照片中按顺序切换；正数下一张，负数上一张 */
  navigatePhoto: (delta: number) => void;
  /** 切换连拍组；正数下一组，负数上一组 */
  navigateGroup: (delta: number) => void;
  comparePaths: string[];
  toggleCompare: (path: string) => void;
  setComparePaths: (paths: string[]) => void;
  /** 基于最新 prev 更新对比列表（异步操作后乐观裁剪用） */
  updateComparePaths: (fn: (prev: string[]) => string[]) => void;
  clearCompare: () => void;
  /** 对比区内勾选要保留的照片 */
  keepPaths: Set<string>;
  toggleKeep: (path: string) => void;
  clearKeep: () => void;
  syncViewport: SyncViewport;
  setSyncViewport: React.Dispatch<React.SetStateAction<SyncViewport>>;
  resetSyncViewport: () => void;
  /**
   * 适应窗口对应的物理像素倍率（1 = 100%）。
   * syncViewport.scale 同语义：1 = 1 图像像素 / 1 物理像素；≤0 表示待测完后自动适应。
   */
  fitNativeZoom: number | null;
  setFitNativeZoom: (z: number | null) => void;
  zoomTo100Percent: () => void;
  canZoom100: boolean;
  /** 当前相对物理像素的放大百分比文案 */
  zoomPercentLabel: string;
  refresh: () => void;
}

const PhotoContext = createContext<PhotoContextValue | null>(null);

/** scale≤0：等待测到 fitNativeZoom 后写入适应倍率 */
const DEFAULT_VIEWPORT: SyncViewport = { scale: 0, x: 0, y: 0 };

export function PhotoProvider({ children }: { children: React.ReactNode }) {
  const [photoDir, setPhotoDirState] = useState("");
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [comparePaths, setComparePathsState] = useState<string[]>([]);
  const [keepPaths, setKeepPaths] = useState<Set<string>>(() => new Set());
  const [syncViewport, setSyncViewport] =
    useState<SyncViewport>(DEFAULT_VIEWPORT);
  const [fitNativeZoom, setFitNativeZoom] = useState<number | null>(null);

  const { mode } = useAppMode();
  const photoDirRef = useRef(photoDir);
  const scanTimer = useRef<number | null>(null);
  const scanGen = useRef(0);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  useEffect(() => {
    photoDirRef.current = photoDir;
  }, [photoDir]);

  useEffect(() => {
    store.get<string>(PHOTO_DIR_KEY).then((dir) => {
      if (dir) setPhotoDirState(dir);
    });
    invoke("cleanup_photo_preview_cache").catch(() => {});
  }, []);

  const scanDirectory = useCallback((dir: string) => {
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = window.setTimeout(async () => {
      const gen = ++scanGen.current;
      if (!dir) {
        if (gen === scanGen.current) {
          setPhotos([]);
          setEnriching(false);
        }
        void invoke("cancel_cr3_enrich", { gen }).catch(() => {});
        return;
      }
      setLoading(true);
      setEnriching(false);
      try {
        const list = await invoke<PhotoMeta[]>("list_cr3_directory", { dir });
        if (gen !== scanGen.current) return;
        setPhotos(list);
        setLoading(false);
        setEnriching(list.length > 0);
        // 即使 0 文件也调 enrich：推进 ENRICH_GEN，作废旧目录后台扫描
        void invoke("enrich_cr3_directory", { dir, gen }).catch((e) => {
          if (gen !== scanGen.current) return;
          console.error("渐进解析 CR3 失败:", e);
          setEnriching(false);
          if (list.length) {
            notificationOpen({
              type: "warning",
              message: "照片元数据解析未完成",
              description: e instanceof Error ? e.message : String(e),
              duration: 4,
              key: "photo-enrich-failed",
            });
          }
        });
      } catch (e) {
        if (gen !== scanGen.current) return;
        console.error("列出 CR3 目录失败:", e);
        setPhotos([]);
        setEnriching(false);
        notificationOpen({
          type: "error",
          message: "扫描照片目录失败",
          description: e instanceof Error ? e.message : String(e),
          duration: 5,
          key: "photo-scan-failed",
        });
        setLoading(false);
      }
    }, 200);
  }, []);

  useEffect(() => {
    if (mode !== "photo") return;
    const unMeta = listen<{ gen: number; photos: PhotoMeta[] }>(
      "photo-scan-meta",
      (event) => {
        if (event.payload.gen !== scanGen.current) return;
        const updates = new Map(
          event.payload.photos.map((p) => [p.path, p] as const),
        );
        setPhotos((prev) =>
          prev.map((p) => {
            const u = updates.get(p.path);
            return u ? { ...p, ...u } : p;
          }),
        );
      },
    );
    const unDone = listen<{ gen: number }>("photo-scan-done", (event) => {
      if (event.payload.gen !== scanGen.current) return;
      setEnriching(false);
    });
    return () => {
      unMeta.then((fn) => fn());
      unDone.then((fn) => fn());
    };
  }, [mode]);

  const setPhotoDir = useCallback(async (newDir: string) => {
    if (newDir && !(await ensureAllowedManagedDir(newDir, "Raw"))) {
      return false;
    }
    // 立即作废旧 enrich / meta，避免 debounce 窗口内写入旧目录
    const gen = ++scanGen.current;
    void invoke("cancel_cr3_enrich", { gen }).catch(() => {});
    setPhotoDirState(newDir);
    await store.set(PHOTO_DIR_KEY, newDir);
    setPhotos([]);
    setActiveGroupId(null);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setComparePathsState([]);
    setKeepPaths(new Set());
    setSyncViewport(DEFAULT_VIEWPORT);
    setFitNativeZoom(null);
    setEnriching(false);
    return true;
  }, []);

  // 仅照片模式监听/扫描，避免视频模式后台占用
  useEffect(() => {
    if (mode !== "photo" || !photoDir) {
      if (mode !== "photo") {
        if (scanTimer.current) {
          clearTimeout(scanTimer.current);
          scanTimer.current = null;
        }
        const gen = ++scanGen.current;
        setPhotos([]);
        setLoading(false);
        setEnriching(false);
        void invoke("cancel_cr3_enrich", { gen }).catch(() => {});
        return;
      }
      setPhotos([]);
      setEnriching(false);
      return;
    }
    scanDirectory(photoDir);

    let unwatchCalled = false;
    let pollTimer: number | null = null;
    let cancelled = false;

    invoke("watch_directory", { dirPath: photoDir }).catch((e) => {
      console.error("监听照片目录失败，改为定时刷新:", e);
      if (cancelled) return;
      notificationOpen({
        type: "warning",
        message: "目录监听失败",
        description: "已改为定时刷新列表，外部增删文件可能稍有延迟。",
        duration: 4,
        key: "photo-watch-fallback",
      });
      pollTimer = window.setInterval(() => {
        if (photoDirRef.current) scanDirectory(photoDirRef.current);
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (pollTimer != null) clearInterval(pollTimer);
      if (!unwatchCalled) {
        unwatchCalled = true;
        invoke("unwatch_directory", { dirPath: photoDir }).catch(console.error);
      }
    };
  }, [mode, photoDir, scanDirectory]);

  useEffect(() => {
    if (mode !== "photo") return;
    const unlisten = listen(
      "file-change",
      (event: {
        payload: { kind: string; dir_path: string; paths: string[] };
      }) => {
        if (event.payload.dir_path !== photoDirRef.current) return;
        // 同路径原地覆盖时列表可能不变，必须主动丢掉前端预览缓存
        for (const p of event.payload.paths) {
          if (/\.cr3$/i.test(p)) invalidateCr3Preview(p);
        }
        scanDirectory(photoDirRef.current);
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [mode, scanDirectory]);

  // 全局撤销栈跨模式共用：不论当前 mode，有 photoDir 就刷新，避免切回才看到变化
  useEffect(() => {
    return onUndoComplete(() => {
      if (photoDirRef.current) scanDirectory(photoDirRef.current);
    });
  }, [scanDirectory]);

  // 仅 path 集合变化时 prune，避免 meta 渐进更新反复跑
  const photosPathsKey = useMemo(
    () => photos.map((p) => p.path).join("\0"),
    [photos],
  );
  useEffect(() => {
    const alive = photosPathsKey
      ? new Set(photosPathsKey.split("\0"))
      : new Set<string>();
    pruneCr3PreviewCache(alive);
    pruneThumbHeavyPaths(alive);
  }, [photosPathsKey]);

  const groups = useMemo(
    () => groupBursts(photos, { deferBurstMerge: enriching }),
    [photos, enriching],
  );

  useEffect(() => {
    if (!groups.length) {
      setActiveGroupId(null);
      return;
    }
    if (activeGroupId && groups.some((g) => g.id === activeGroupId)) return;
    // 组 id 可能因首张 path 变化而变：优先落到仍含锚点/选中/对比项的组
    const findByPath = (path: string | null | undefined) =>
      path
        ? groups.find((g) => g.photos.some((p) => p.path === path))
        : undefined;
    const next =
      findByPath(selectionAnchor) ??
      findByPath([...selectedPaths][0]) ??
      findByPath(comparePaths[0]) ??
      groups[0];
    setActiveGroupId(next.id);
  }, [groups, activeGroupId, selectionAnchor, selectedPaths, comparePaths]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );

  // Drop selection/compare/anchor for removed files
  useEffect(() => {
    const alive = new Set(photos.map((p) => p.path));
    setSelectedPaths((prev) => {
      const next = new Set([...prev].filter((p) => alive.has(p)));
      return next.size === prev.size ? prev : next;
    });
    setSelectionAnchor((a) => (a && alive.has(a) ? a : null));
    setComparePathsState((prev) => {
      const next = prev.filter((p) => alive.has(p));
      return next.length === prev.length ? prev : next;
    });
    setKeepPaths((prev) => {
      const next = new Set([...prev].filter((p) => alive.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [photos]);

  // 正式对比才保留 keep；对比清空或项被移除时同步裁剪（预览回退不算对比）
  useEffect(() => {
    const inCompare = new Set(comparePaths);
    setKeepPaths((prev) => {
      if (!prev.size) return prev;
      if (!inCompare.size) {
        return prev.size ? new Set() : prev;
      }
      const next = new Set([...prev].filter((p) => inCompare.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [comparePaths]);

  const toggleSelect = useCallback((path: string) => {
    // 函数式更新避免快点多选丢状态；锚点在 updater 外设置（StrictMode 双跑 updater 时勿嵌套 setState）
    let nextSnap: Set<string> = new Set();
    let added = false;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        added = true;
      }
      nextSnap = next;
      return next;
    });
    if (added) {
      setSelectionAnchor(path);
    } else {
      setSelectionAnchor((a) => {
        if (a && nextSnap.has(a)) return a;
        const it = nextSnap.values().next();
        return it.done ? null : it.value;
      });
    }
  }, []);

  const selectOnly = useCallback((path: string) => {
    setSelectionAnchor(path);
    setSelectedPaths(new Set([path]));
  }, []);

  const selectRangeTo = useCallback(
    (toPath: string) => {
      const flat = groups.flatMap((g) => g.photos.map((p) => p.path));
      const toIdx = flat.indexOf(toPath);
      if (toIdx < 0) {
        selectOnly(toPath);
        return;
      }
      // 锚点须仍在选中集内才作为 Shift 起点
      let fromIdx =
        selectionAnchor && selectedPaths.has(selectionAnchor)
          ? flat.indexOf(selectionAnchor)
          : -1;
      if (fromIdx < 0) {
        fromIdx = flat.findIndex((p) => selectedPaths.has(p));
      }
      if (fromIdx < 0) {
        setSelectionAnchor(toPath);
        setSelectedPaths(new Set([toPath]));
        return;
      }
      const [a, b] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      // Shift 多选保持原锚点，便于连续扩展；预览用锚点（仍在选中集内）
      setSelectedPaths(new Set(flat.slice(a, b + 1)));
    },
    [groups, selectOnly, selectedPaths, selectionAnchor],
  );

  const clearSelection = useCallback(() => {
    setSelectionAnchor(null);
    setSelectedPaths(new Set());
  }, []);

  const selectPaths = useCallback((paths: string[]) => {
    setSelectionAnchor(paths[0] ?? null);
    setSelectedPaths(new Set(paths));
  }, []);

  const selectAllInGroup = useCallback(() => {
    if (!activeGroup) return;
    const paths = activeGroup.photos.map((p) => p.path);
    setSelectionAnchor(paths[0] ?? null);
    setSelectedPaths(new Set(paths));
  }, [activeGroup]);

  const focusPhoto = useCallback(
    (path: string, groupId?: string | null) => {
      setSelectionAnchor(path);
      setSelectedPaths(new Set([path]));
      // 不清空对比列表，避免方向键浏览时打断对比
      setSyncViewport(DEFAULT_VIEWPORT);
      if (groupId) setActiveGroupId(groupId);
      else {
        const g = groups.find((gr) => gr.photos.some((p) => p.path === path));
        if (g) setActiveGroupId(g.id);
      }
    },
    [groups],
  );

  // 特性：←/→ 是「浏览定位」，focusPhoto 会塌成单选；批量删除靠 Shift/⌘，不靠方向键保多选。
  // 特性：正式对比时对比区仍由 comparePaths 驱动，←/→ 只改左侧选中/预览锚点，不换对比集。
  const navigatePhoto = useCallback(
    (delta: number) => {
      if (!photos.length) return;
      const flat = groups.flatMap((g) =>
        g.photos.map((p) => ({ path: p.path, groupId: g.id })),
      );
      if (!flat.length) return;

      let idx =
        selectionAnchor && selectedPaths.has(selectionAnchor)
          ? flat.findIndex((p) => p.path === selectionAnchor)
          : flat.findIndex((p) => selectedPaths.has(p.path));
      if (idx < 0 && comparePaths.length) {
        idx = flat.findIndex((p) => p.path === comparePaths[0]);
      }
      if (idx < 0 && activeGroup) {
        idx = flat.findIndex((p) => p.groupId === activeGroup.id);
      }
      if (idx < 0) idx = 0;
      else idx = Math.max(0, Math.min(flat.length - 1, idx + delta));

      const next = flat[idx];
      if (next) focusPhoto(next.path, next.groupId);
    },
    [
      photos.length,
      groups,
      selectedPaths,
      selectionAnchor,
      comparePaths,
      activeGroup,
      focusPhoto,
    ],
  );

  const navigateGroup = useCallback(
    (delta: number) => {
      if (!groups.length) return;
      let idx = groups.findIndex((g) => g.id === activeGroupId);
      if (idx < 0) idx = 0;
      else idx = Math.max(0, Math.min(groups.length - 1, idx + delta));
      const g = groups[idx];
      if (!g?.photos.length) return;
      setActiveGroupId(g.id);
      focusPhoto(g.photos[0].path, g.id);
    },
    [groups, activeGroupId, focusPhoto],
  );

  const toggleCompare = useCallback((path: string) => {
    setComparePathsState((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path);
      if (prev.length >= MAX_COMPARE) {
        tipCompareLimit();
        return prev;
      }
      return [...prev, path];
    });
    setSyncViewport(DEFAULT_VIEWPORT);
  }, []);

  /** 用给定列表重建对比（整表替换，非追加）；工具栏「左侧设为对比」用此接口 */
  const replaceComparePaths = useCallback(
    (paths: string[]) => {
      // 按当前列表顺序截断，避免 Set 迭代顺序导致「取前 9 张」不稳定
      const flatOrder = new Map(
        groups
          .flatMap((g) => g.photos.map((p) => p.path))
          .map((p, i) => [p, i] as const),
      );
      const sorted = [...paths].sort(
        (a, b) => (flatOrder.get(a) ?? 0) - (flatOrder.get(b) ?? 0),
      );
      if (sorted.length > MAX_COMPARE) {
        tipCompareLimit(
          `已选 ${sorted.length} 张，仅取前 ${MAX_COMPARE} 张进行对比。`,
        );
      }
      setComparePathsState(sorted.slice(0, MAX_COMPARE));
      setSyncViewport(DEFAULT_VIEWPORT);
    },
    [groups],
  );

  const updateComparePaths = useCallback((fn: (prev: string[]) => string[]) => {
    setComparePathsState(fn);
  }, []);

  const clearCompare = useCallback(() => {
    // 特性：清除对比即结束对比会话，keep 只服务正式对比，一并清空
    setComparePathsState([]);
    setKeepPaths(new Set());
    setSyncViewport(DEFAULT_VIEWPORT);
  }, []);

  const toggleKeep = useCallback((path: string) => {
    setKeepPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const clearKeep = useCallback(() => {
    setKeepPaths(new Set());
  }, []);

  const resetSyncViewport = useCallback(() => {
    if (fitNativeZoom && fitNativeZoom > 0) {
      setSyncViewport({ scale: fitNativeZoom, x: 0, y: 0 });
    } else {
      setSyncViewport(DEFAULT_VIEWPORT);
    }
  }, [fitNativeZoom]);

  const zoomTo100Percent = useCallback(() => {
    setSyncViewport({ scale: 1, x: 0, y: 0 });
  }, []);

  const effectiveNativeZoom =
    syncViewport.scale > 0 ? syncViewport.scale : (fitNativeZoom ?? 0);
  const zoomPercentLabel =
    effectiveNativeZoom > 0 ? `${Math.round(effectiveNativeZoom * 100)}%` : "—";

  const refresh = useCallback(() => {
    if (photoDirRef.current) scanDirectory(photoDirRef.current);
  }, [scanDirectory]);

  return (
    <PhotoContext.Provider
      value={{
        photoDir,
        setPhotoDir,
        photos,
        groups,
        loading,
        enriching,
        activeGroupId,
        setActiveGroupId,
        activeGroup,
        selectedPaths,
        selectionAnchor,
        toggleSelect,
        selectOnly,
        selectRangeTo,
        clearSelection,
        selectPaths,
        selectAllInGroup,
        navigatePhoto,
        navigateGroup,
        comparePaths,
        toggleCompare,
        setComparePaths: replaceComparePaths,
        updateComparePaths,
        clearCompare,
        keepPaths,
        toggleKeep,
        clearKeep,
        syncViewport,
        setSyncViewport,
        resetSyncViewport,
        fitNativeZoom,
        setFitNativeZoom,
        zoomTo100Percent,
        canZoom100: true,
        zoomPercentLabel,
        refresh,
      }}
    >
      {children}
    </PhotoContext.Provider>
  );
}

export function usePhotoContext() {
  const ctx = useContext(PhotoContext);
  if (!ctx)
    throw new Error("usePhotoContext must be used within PhotoProvider");
  return ctx;
}
