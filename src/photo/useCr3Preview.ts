import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type PreviewKind = "thumb" | "preview" | "raw";
export type ThumbQuality = "fast" | "heavy";

type QueueItem = {
  path: string;
  kind: PreviewKind;
  quality: ThumbQuality;
  epoch: number;
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
};

const memoryCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
/** 每 key 代数：prune 时递增，完成时核对，避免旧请求写回缓存 */
const keyEpoch = new Map<string, number>();

const thumbQueue: QueueItem[] = [];
const previewQueue: QueueItem[] = [];
const rawQueue: QueueItem[] = [];
let thumbActive = 0;
let previewActive = 0;
let rawActive = 0;
const MAX_THUMB = 8;
const MAX_PREVIEW = 4;
const MAX_RAW = 1;
/** 当前预览中的路径：RAW 队列插队优先（不打断正在解析的任务） */
let rawPriorityPaths: string[] = [];

const cacheKey = (path: string, kind: PreviewKind, quality?: ThumbQuality) =>
  kind === "thumb"
    ? `${kind}:${quality ?? "fast"}::${path}`
    : `${kind}::${path}`;

const pathFromCacheKey = (key: string) => {
  const idx = key.indexOf("::");
  return idx >= 0 ? key.slice(idx + 2) : key;
};

const bumpEpoch = (key: string) => {
  keyEpoch.set(key, (keyEpoch.get(key) ?? 0) + 1);
};

/** 通知已挂载的 useCr3Preview 重新拉取（同路径内容被覆盖时） */
const invalidateListeners = new Set<(path: string) => void>();

/** 列表变化后剔除已不存在文件的内存缓存与排队请求 */
export function pruneCr3PreviewCache(alivePaths: Set<string>) {
  for (const key of [...memoryCache.keys()]) {
    if (!alivePaths.has(pathFromCacheKey(key))) {
      memoryCache.delete(key);
    }
  }
  const pruneQueue = (queue: QueueItem[]) => {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!alivePaths.has(queue[i].path)) {
        const [item] = queue.splice(i, 1);
        bumpEpoch(cacheKey(item.path, item.kind, item.quality));
        item.reject(new Error("file removed"));
      }
    }
  };
  pruneQueue(thumbQueue);
  pruneQueue(previewQueue);
  pruneQueue(rawQueue);
  for (const key of [...inflight.keys()]) {
    if (!alivePaths.has(pathFromCacheKey(key))) {
      bumpEpoch(key);
      inflight.delete(key);
    }
  }
  // 剔除后若槽位空闲，唤醒队列，避免 active=0 且队列非空时停转
  void runNext("thumb");
  void runNext("preview");
  void runNext("raw");
}

export function invalidateCr3Preview(path: string) {
  for (const kind of ["thumb", "preview", "raw"] as PreviewKind[]) {
    if (kind === "thumb") {
      for (const q of ["fast", "heavy"] as ThumbQuality[]) {
        const key = cacheKey(path, kind, q);
        memoryCache.delete(key);
        bumpEpoch(key);
        inflight.delete(key);
      }
    } else {
      const key = cacheKey(path, kind);
      memoryCache.delete(key);
      bumpEpoch(key);
      inflight.delete(key);
    }
  }
  invalidateListeners.forEach((fn) => fn(path));
}

function queueFor(kind: PreviewKind) {
  if (kind === "thumb") return thumbQueue;
  if (kind === "raw") return rawQueue;
  return previewQueue;
}

function limits(kind: PreviewKind): { active: number; max: number } {
  if (kind === "thumb") return { active: thumbActive, max: MAX_THUMB };
  if (kind === "raw") return { active: rawActive, max: MAX_RAW };
  return { active: previewActive, max: MAX_PREVIEW };
}

function setActive(kind: PreviewKind, n: number) {
  if (kind === "thumb") thumbActive = n;
  else if (kind === "raw") rawActive = n;
  else previewActive = n;
}

/** 把优先路径排到 RAW 队列最前；不取消 rawActive 中的任务 */
function reorderRawQueue() {
  if (!rawQueue.length) return;
  if (!rawPriorityPaths.length) return;
  const priIndex = new Map(rawPriorityPaths.map((p, i) => [p, i]));
  const high: QueueItem[] = [];
  const low: QueueItem[] = [];
  for (const item of rawQueue) {
    if (priIndex.has(item.path)) high.push(item);
    else low.push(item);
  }
  high.sort(
    (a, b) => (priIndex.get(a.path) ?? 0) - (priIndex.get(b.path) ?? 0),
  );
  rawQueue.length = 0;
  rawQueue.push(...high, ...low);
}

function rejectQueuedItem(item: QueueItem, reason: string) {
  const key = cacheKey(item.path, item.kind, item.quality);
  bumpEpoch(key);
  inflight.delete(key);
  item.reject(new Error(reason));
}

/**
 * 声明当前仍需要 RAW 的路径（多图对比 / 当前预览）。
 * - 不在列表里的等待项直接移出队列（已划走的不再占坑）
 * - 列表内的排到队首
 * - 正在解析的不强制中断（完成后若仍不需要，仅写入缓存，UI 已忽略）
 */
export function setRawPreviewPriority(paths: string[]) {
  rawPriorityPaths = [...paths];
  const allow = new Set(paths);
  for (let i = rawQueue.length - 1; i >= 0; i--) {
    if (allow.has(rawQueue[i].path)) continue;
    const [item] = rawQueue.splice(i, 1);
    rejectQueuedItem(item, "raw preview cancelled");
  }
  reorderRawQueue();
  void runNext("raw");
}

/** 视口离开 / 关闭某类预览时，从对应等待队列剔除（不打断已在跑的任务） */
export function cancelQueuedPreview(
  path: string,
  kind: PreviewKind,
  quality: ThumbQuality = "fast",
) {
  const queue = queueFor(kind);
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if (item.path !== path || item.kind !== kind) continue;
    if (kind === "thumb" && item.quality !== quality) continue;
    queue.splice(i, 1);
    rejectQueuedItem(item, "preview cancelled");
  }
  void runNext(kind);
}

async function runNext(kind: PreviewKind) {
  const queue = queueFor(kind);
  const { active, max } = limits(kind);
  if (active >= max || !queue.length) return;
  const item = queue.shift()!;
  const key = cacheKey(item.path, item.kind, item.quality);
  setActive(kind, active + 1);
  try {
    if ((keyEpoch.get(key) ?? 0) !== item.epoch) {
      item.reject(new Error("file removed"));
      return;
    }
    let cachedPath: string;
    if (item.kind === "raw") {
      cachedPath = await invoke<string>("get_cr3_raw_preview", {
        path: item.path,
      });
    } else {
      cachedPath = await invoke<string>("get_cr3_preview", {
        path: item.path,
        kind: item.kind,
        quality: item.kind === "thumb" ? item.quality : undefined,
      });
    }
    if ((keyEpoch.get(key) ?? 0) !== item.epoch) {
      item.reject(new Error("file removed"));
      return;
    }
    const url = convertFileSrc(cachedPath);
    memoryCache.set(key, url);
    item.resolve(url);
  } catch (e) {
    item.reject(e);
  } finally {
    setActive(kind, limits(kind).active - 1);
    void runNext(kind);
  }
}

export function loadCr3Preview(
  path: string,
  kind: PreviewKind,
  quality: ThumbQuality = "fast",
): Promise<string> {
  const key = cacheKey(path, kind, quality);
  const hit = memoryCache.get(key);
  if (hit) return Promise.resolve(hit);

  const existing = inflight.get(key);
  if (existing) return existing;

  const epoch = keyEpoch.get(key) ?? 0;
  const promise = new Promise<string>((resolve, reject) => {
    queueFor(kind).push({ path, kind, quality, epoch, resolve, reject });
    if (kind === "raw") reorderRawQueue();
    void runNext(kind);
  }).finally(() => {
    // 勿误删后到的同 key 新请求
    if (inflight.get(key) === promise) {
      inflight.delete(key);
    }
  });
  inflight.set(key, promise);
  return promise;
}

/** 视口内懒加载 CR3 预览 URL */
export function useCr3Preview(
  path: string | undefined,
  kind: PreviewKind,
  enabled: boolean,
  quality: ThumbQuality = "fast",
) {
  const [url, setUrl] = useState<string | null>(() =>
    path ? (memoryCache.get(cacheKey(path, kind, quality)) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const genRef = useRef(0);

  useEffect(() => {
    if (!path) return;
    const onInvalidate = (p: string) => {
      if (p === path) setReloadToken((n) => n + 1);
    };
    invalidateListeners.add(onInvalidate);
    return () => {
      invalidateListeners.delete(onInvalidate);
    };
  }, [path]);

  useEffect(() => {
    if (!path || !enabled) {
      // 作废进行中的 UI 回写，并从等待队列剔除（不占坑）
      genRef.current += 1;
      if (path) cancelQueuedPreview(path, kind, quality);
      setUrl(
        path ? (memoryCache.get(cacheKey(path, kind, quality)) ?? null) : null,
      );
      setLoading(false);
      return;
    }
    const hit = memoryCache.get(cacheKey(path, kind, quality));
    if (hit) {
      setUrl(hit);
      setLoading(false);
      setError(false);
      setErrorMessage(null);
      return;
    }
    const gen = ++genRef.current;
    setLoading(true);
    setError(false);
    setErrorMessage(null);
    loadCr3Preview(path, kind, quality)
      .then((u) => {
        if (genRef.current !== gen) return;
        setUrl(u);
        setLoading(false);
      })
      .catch((e) => {
        if (genRef.current !== gen) return;
        const msg = e instanceof Error ? e.message : String(e);
        // 文件已删：停
        if (msg.includes("file removed")) {
          setLoading(false);
          setError(false);
          setErrorMessage(null);
          return;
        }
        // 优先级/卸载踢队：若仍 enabled，微任务后重试（避免中间 [] 导致永久停转）
        if (msg.includes("cancelled")) {
          setLoading(false);
          setError(false);
          setErrorMessage(null);
          void Promise.resolve().then(() => {
            if (genRef.current !== gen) return;
            setReloadToken((n) => n + 1);
          });
          return;
        }
        // 仅清内存，勿再 notify listeners（避免失败重试死循环）
        memoryCache.delete(cacheKey(path, kind, quality));
        bumpEpoch(cacheKey(path, kind, quality));
        setError(true);
        setErrorMessage(msg);
        setLoading(false);
        console.warn("CR3 preview failed", path, kind, quality, e);
      });
  }, [path, kind, enabled, quality, reloadToken]);

  const retry = () => setReloadToken((n) => n + 1);

  return { url, loading, error, errorMessage, retry };
}
