import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type PreviewKind = "thumb" | "preview";

type QueueItem = {
  path: string;
  kind: PreviewKind;
  epoch: number;
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
};

const memoryCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
/** 每 key 代数：prune 时递增，完成时核对，避免旧请求写回缓存 */
const keyEpoch = new Map<string, number>();
const queue: QueueItem[] = [];
let active = 0;
const MAX_CONCURRENT = 4;

const cacheKey = (path: string, kind: PreviewKind) => `${kind}::${path}`;

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
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!alivePaths.has(queue[i].path)) {
      const [item] = queue.splice(i, 1);
      bumpEpoch(cacheKey(item.path, item.kind));
      item.reject(new Error("file removed"));
    }
  }
  for (const key of [...inflight.keys()]) {
    if (!alivePaths.has(pathFromCacheKey(key))) {
      bumpEpoch(key);
      inflight.delete(key);
    }
  }
}

export function invalidateCr3Preview(path: string) {
  for (const kind of ["thumb", "preview"] as PreviewKind[]) {
    const key = cacheKey(path, kind);
    memoryCache.delete(key);
    bumpEpoch(key);
    inflight.delete(key);
  }
  invalidateListeners.forEach((fn) => fn(path));
}

async function runNext() {
  if (active >= MAX_CONCURRENT || !queue.length) return;
  const item = queue.shift()!;
  const key = cacheKey(item.path, item.kind);
  active += 1;
  try {
    if ((keyEpoch.get(key) ?? 0) !== item.epoch) {
      item.reject(new Error("file removed"));
      return;
    }
    const cachedPath = await invoke<string>("get_cr3_preview", {
      path: item.path,
      kind: item.kind,
    });
    // 等待期间若被 prune，代数已变，禁止写回
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
    active -= 1;
    void runNext();
  }
}

export function loadCr3Preview(
  path: string,
  kind: PreviewKind,
): Promise<string> {
  const key = cacheKey(path, kind);
  const hit = memoryCache.get(key);
  if (hit) return Promise.resolve(hit);

  const existing = inflight.get(key);
  if (existing) return existing;

  const epoch = keyEpoch.get(key) ?? 0;
  const promise = new Promise<string>((resolve, reject) => {
    queue.push({ path, kind, epoch, resolve, reject });
    void runNext();
  }).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** 视口内懒加载 CR3 预览 URL */
export function useCr3Preview(
  path: string | undefined,
  kind: PreviewKind,
  enabled: boolean,
) {
  const [url, setUrl] = useState<string | null>(() =>
    path ? (memoryCache.get(cacheKey(path, kind)) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
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
      setUrl(path ? (memoryCache.get(cacheKey(path, kind)) ?? null) : null);
      return;
    }
    const hit = memoryCache.get(cacheKey(path, kind));
    if (hit) {
      setUrl(hit);
      setLoading(false);
      setError(false);
      return;
    }
    const gen = ++genRef.current;
    setLoading(true);
    setError(false);
    loadCr3Preview(path, kind)
      .then((u) => {
        if (genRef.current !== gen) return;
        setUrl(u);
        setLoading(false);
      })
      .catch(() => {
        if (genRef.current !== gen) return;
        // 仅清内存，勿再 notify listeners（避免失败重试死循环）
        memoryCache.delete(cacheKey(path, kind));
        bumpEpoch(cacheKey(path, kind));
        setError(true);
        setLoading(false);
      });
  }, [path, kind, enabled, reloadToken]);

  return { url, loading, error };
}
