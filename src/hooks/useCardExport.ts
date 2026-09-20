import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { store, CARD_PATHS_KEY, EXPORT_PATHS_KEY } from "../utils/store";

export interface CardScanResult {
  cardPath: string;
  files: { relativePath: string; size: number }[];
  totalBytes: number;
  error: string | null;
}

export interface SpaceCheckResult {
  items: {
    path: string;
    available: number;
    required: number;
    sufficient: boolean;
  }[];
  allSufficient: boolean;
}

export interface ConflictItem {
  key: string;
  cardPath: string;
  relativePath: string;
  exportPath: string;
  destPath: string;
  sourceSize: number;
  destSize: number;
  sourceMtimeSecs: number;
  destMtimeSecs: number;
}

export interface IdenticalItem {
  key: string;
  cardPath: string;
  relativePath: string;
  exportPath: string;
  destPath: string;
}

export interface ConflictDetectResult {
  identical: IdenticalItem[];
  conflicts: ConflictItem[];
  dateFolder: string;
}

export interface ExportProgressEvent {
  cardPath: string;
  exportPath: string;
  fileName: string;
  relativePath: string;
  bytesCopied: number;
  totalBytes: number;
  filesDone: number;
  filesTotal: number;
  cardBytesCopied: number;
  cardTotalBytes: number;
  status: string;
}

export interface ExportResultItem {
  cardPath: string;
  relativePath: string;
  exportPath: string;
  destPath: string;
  reason: string | null;
  error: string | null;
}

export interface ExportFinishedEvent {
  succeeded: ExportResultItem[];
  skippedIdentical: ExportResultItem[];
  skippedConflict: ExportResultItem[];
  failed: ExportResultItem[];
  cancelled: boolean;
  dateFolder: string;
}

export type ExportPhase =
  | "idle"
  | "scanning"
  | "conflicts"
  | "exporting"
  | "done";

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "--";
  if (bytesPerSec >= 1024 ** 3)
    return `${(bytesPerSec / 1024 ** 3).toFixed(2)} GB/s`;
  if (bytesPerSec >= 1024 ** 2)
    return `${(bytesPerSec / 1024 ** 2).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

/** 预估剩余时间文案 */
export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "计算中…";
  if (seconds <= 1) return "即将完成";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `约 ${h} 小时 ${m} 分`;
  if (m > 0) return `约 ${m} 分 ${sec} 秒`;
  return `约 ${sec} 秒`;
}

export interface ExportThroughput {
  bytesPerSec: number;
  etaSeconds: number | null;
}

const SPEED_WINDOW_MS = 3000;
const SPEED_MIN_SPAN_MS = 400;

export function formatMtime(secs: number): string {
  if (!secs) return "-";
  return new Date(secs * 1000).toLocaleString();
}

export function useCardExport() {
  const [cardPaths, setCardPaths] = useState<string[]>([]);
  const [exportPaths, setExportPaths] = useState<string[]>([]);
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [error, setError] = useState("");
  const [scanResults, setScanResults] = useState<CardScanResult[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [overwriteKeys, setOverwriteKeys] = useState<Set<string>>(new Set());
  const [dateFolder, setDateFolder] = useState("");
  const [progress, setProgress] = useState<ExportProgressEvent | null>(null);
  const [cardProgress, setCardProgress] = useState<
    Record<string, ExportProgressEvent>
  >({});
  const [finished, setFinished] = useState<ExportFinishedEvent | null>(null);
  const [throughput, setThroughput] = useState<ExportThroughput>({
    bytesPerSec: 0,
    etaSeconds: null,
  });

  const unlistenRef = useRef<UnlistenFn[]>([]);
  const cardPathsRef = useRef(cardPaths);
  const exportPathsRef = useRef(exportPaths);
  const speedSamplesRef = useRef<{ t: number; bytes: number }[]>([]);
  const cardProgressRef = useRef<Record<string, ExportProgressEvent>>({});
  cardPathsRef.current = cardPaths;
  exportPathsRef.current = exportPaths;

  const resetThroughput = useCallback(() => {
    speedSamplesRef.current = [];
    setThroughput({ bytesPerSec: 0, etaSeconds: null });
  }, []);

  const recordThroughput = useCallback((copied: number, total: number) => {
    const now = performance.now();
    const samples = speedSamplesRef.current;
    const last = samples[samples.length - 1];
    // 字节未增加时不灌样本，避免跳过文件瞬间把速度拉爆
    if (!last || copied !== last.bytes) {
      samples.push({ t: now, bytes: copied });
    }
    while (samples.length > 1 && now - samples[0].t > SPEED_WINDOW_MS) {
      samples.shift();
    }

    if (samples.length < 2) return;
    const first = samples[0];
    const latest = samples[samples.length - 1];
    const dtMs = latest.t - first.t;
    if (dtMs < SPEED_MIN_SPAN_MS) return;

    const bytesPerSec = Math.max(
      0,
      (latest.bytes - first.bytes) / (dtMs / 1000),
    );
    const remaining = Math.max(0, total - copied);
    const etaSeconds =
      bytesPerSec > 0 && remaining > 0
        ? remaining / bytesPerSec
        : remaining <= 0
          ? 0
          : null;

    setThroughput({ bytesPerSec, etaSeconds });
  }, []);

  useEffect(() => {
    const load = async () => {
      const cards = (await store.get<string[]>(CARD_PATHS_KEY)) ?? [];
      const exports = (await store.get<string[]>(EXPORT_PATHS_KEY)) ?? [];
      setCardPaths(cards);
      setExportPaths(exports);
    };
    load();
  }, []);

  const persistCards = useCallback(async (paths: string[]) => {
    setCardPaths(paths);
    await store.set(CARD_PATHS_KEY, paths);
  }, []);

  const persistExports = useCallback(async (paths: string[]) => {
    setExportPaths(paths);
    await store.set(EXPORT_PATHS_KEY, paths);
  }, []);

  const addCardPath = useCallback(async () => {
    const selected = await open({ multiple: true, directory: true });
    if (!selected) return;
    const list = Array.isArray(selected) ? selected : [selected];
    const next = [...cardPathsRef.current];
    for (const p of list) {
      if (!next.includes(p)) next.push(p);
    }
    await persistCards(next);
  }, [persistCards]);

  const removeCardPath = useCallback(
    async (path: string) => {
      await persistCards(cardPathsRef.current.filter((p) => p !== path));
    },
    [persistCards],
  );

  const addExportPath = useCallback(async () => {
    const selected = await open({ multiple: true, directory: true });
    if (!selected) return;
    const list = Array.isArray(selected) ? selected : [selected];
    const next = [...exportPathsRef.current];
    for (const p of list) {
      if (!next.includes(p)) next.push(p);
    }
    await persistExports(next);
  }, [persistExports]);

  const removeExportPath = useCallback(
    async (path: string) => {
      await persistExports(exportPathsRef.current.filter((p) => p !== path));
    },
    [persistExports],
  );

  const clearListeners = useCallback(() => {
    for (const u of unlistenRef.current) u();
    unlistenRef.current = [];
  }, []);

  const resetSession = useCallback(() => {
    clearListeners();
    setPhase("idle");
    setError("");
    setScanResults([]);
    setConflicts([]);
    setOverwriteKeys(new Set());
    setProgress(null);
    setCardProgress({});
    setFinished(null);
    cardProgressRef.current = {};
    resetThroughput();
  }, [clearListeners, resetThroughput]);

  const runExport = useCallback(
    async (folder: string, keys: string[]) => {
      setPhase("exporting");
      setError("");
      setFinished(null);
      setProgress(null);
      setCardProgress({});
      cardProgressRef.current = {};
      resetThroughput();
      clearListeners();

      const u1 = await listen<ExportProgressEvent>("export-progress", (ev) => {
        setProgress(ev.payload);
        const next = {
          ...cardProgressRef.current,
          [ev.payload.cardPath]: ev.payload,
        };
        cardProgressRef.current = next;
        setCardProgress(next);
        const copied = Object.values(next).reduce(
          (sum, p) => sum + p.cardBytesCopied,
          0,
        );
        recordThroughput(copied, ev.payload.totalBytes);
      });
      const u2 = await listen<ExportFinishedEvent>("export-finished", (ev) => {
        setFinished(ev.payload);
        setPhase("done");
      });
      unlistenRef.current = [u1, u2];

      try {
        await invoke("start_export", {
          cardPaths: cardPathsRef.current,
          exportPaths: exportPathsRef.current,
          dateFolder: folder,
          overwriteKeys: keys,
        });
      } catch (e) {
        setPhase("idle");
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [clearListeners, recordThroughput, resetThroughput],
  );

  const prepareExport = useCallback(async () => {
    setError("");
    setFinished(null);
    setProgress(null);
    setCardProgress({});
    cardProgressRef.current = {};
    resetThroughput();
    const cards = cardPathsRef.current;
    const exports = exportPathsRef.current;
    if (!cards.length) {
      setError("请至少添加一张存储卡路径");
      return;
    }
    if (!exports.length) {
      setError("请至少添加一个导出路径");
      return;
    }

    setPhase("scanning");
    try {
      const scans = await invoke<CardScanResult[]>("scan_card_media", {
        cardPaths: cards,
      });
      setScanResults(scans);
      for (const s of scans) {
        if (s.error) throw new Error(s.error);
      }
      const totalBytes = scans.reduce((sum, s) => sum + s.totalBytes, 0);
      if (totalBytes === 0) {
        throw new Error("未在存储卡中找到可导出的媒体文件（DCIM/CRM/XFVC）");
      }

      const conflictResult = await invoke<ConflictDetectResult>(
        "detect_export_conflicts",
        {
          cardPaths: cards,
          exportPaths: exports,
          dateFolder: null,
        },
      );
      setDateFolder(conflictResult.dateFolder);
      setConflicts(conflictResult.conflicts);
      setOverwriteKeys(new Set());

      // 按盘估算：已一致文件可不计入；冲突按需覆盖（预检按最坏情况计入）
      const identicalSizeByExport = new Map<string, number>();
      const sizeByRel = new Map<string, number>();
      for (const s of scans) {
        for (const f of s.files)
          sizeByRel.set(`${s.cardPath}::${f.relativePath}`, f.size);
      }
      for (const item of conflictResult.identical) {
        const size =
          sizeByRel.get(`${item.cardPath}::${item.relativePath}`) ?? 0;
        identicalSizeByExport.set(
          item.exportPath,
          (identicalSizeByExport.get(item.exportPath) ?? 0) + size,
        );
      }
      const requiredBytesPerPath = exports.map(
        (ep) => totalBytes - (identicalSizeByExport.get(ep) ?? 0),
      );

      const space = await invoke<SpaceCheckResult>("check_export_space", {
        exportPaths: exports,
        requiredBytesPerPath,
      });
      if (!space.allSufficient) {
        const detail = space.items
          .filter((i) => !i.sufficient)
          .map(
            (i) =>
              `${i.path}: 可用 ${formatBytes(i.available)} / 需要 ${formatBytes(i.required)}`,
          )
          .join("\n");
        throw new Error(`磁盘空间不足：\n${detail}`);
      }

      if (conflictResult.conflicts.length > 0) {
        setPhase("conflicts");
      } else {
        await runExport(conflictResult.dateFolder, []);
      }
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [runExport, resetThroughput]);

  const confirmConflictsAndExport = useCallback(async () => {
    await runExport(dateFolder, Array.from(overwriteKeys));
  }, [dateFolder, overwriteKeys, runExport]);

  const cancelExport = useCallback(async () => {
    try {
      await invoke("cancel_export");
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => () => clearListeners(), [clearListeners]);

  return {
    cardPaths,
    exportPaths,
    phase,
    error,
    scanResults,
    conflicts,
    overwriteKeys,
    setOverwriteKeys,
    dateFolder,
    progress,
    cardProgress,
    throughput,
    finished,
    addCardPath,
    removeCardPath,
    addExportPath,
    removeExportPath,
    prepareExport,
    confirmConflictsAndExport,
    cancelExport,
    resetSession,
  };
}
