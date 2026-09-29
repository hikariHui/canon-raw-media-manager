import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { formatBytes, formatEta, formatSpeed } from "./useCardExport";

export interface SyncMoveItem {
  from: string;
  to: string;
}

export interface SyncCopyItem {
  path: string;
  size: number;
}

export interface SyncPlanSummary {
  sourceDir: string;
  targetDir: string;
  sourceFileCount: number;
  targetFileCount: number;
  moveCount: number;
  copyCount: number;
  trashCount: number;
  skipCount: number;
  totalCopyBytes: number;
  timestamp: string;
  movePreview: SyncMoveItem[];
  copyPreview: SyncCopyItem[];
  trashPreview: string[];
  alreadySynced: boolean;
}

export interface SyncProgressEvent {
  phase: string;
  message: string;
  currentPath: string;
  targetDir: string;
  targetIndex: number;
  targetTotal: number;
  filesDone: number;
  filesTotal: number;
  bytesCopied: number;
  totalCopyBytes: number;
  status: string;
}

export interface SyncTargetResult {
  targetDir: string;
  moved: number;
  copied: number;
  trashed: number;
  skipped: number;
  failed: string[];
  trashDir: string | null;
  totalCopyBytes: number;
  alreadySynced: boolean;
}

export interface SyncFinishedEvent {
  sourceDir: string;
  results: SyncTargetResult[];
  cancelled: boolean;
}

export type SyncPhase = "idle" | "planning" | "review" | "syncing" | "done";

export { formatBytes, formatEta, formatSpeed };

export function useFolderSync() {
  const [sourceDir, setSourceDir] = useState("");
  const [targetDirs, setTargetDirs] = useState<string[]>([]);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<SyncPlanSummary[]>([]);
  const [progress, setProgress] = useState<SyncProgressEvent | null>(null);
  const [finished, setFinished] = useState<SyncFinishedEvent | null>(null);
  const [throughput, setThroughput] = useState({
    bytesPerSec: 0,
    etaSeconds: null as number | null,
  });

  const unlistenRef = useRef<UnlistenFn[]>([]);
  const targetDirsRef = useRef(targetDirs);
  const speedSamplesRef = useRef<{ t: number; bytes: number }[]>([]);
  targetDirsRef.current = targetDirs;

  const resetThroughput = useCallback(() => {
    speedSamplesRef.current = [];
    setThroughput({ bytesPerSec: 0, etaSeconds: null });
  }, []);

  const recordThroughput = useCallback((copied: number, total: number) => {
    const now = performance.now();
    const samples = speedSamplesRef.current;
    const last = samples[samples.length - 1];
    if (!last || copied !== last.bytes) {
      samples.push({ t: now, bytes: copied });
    }
    while (samples.length > 1 && now - samples[0].t > 3000) {
      samples.shift();
    }
    if (samples.length < 2) return;
    const first = samples[0];
    const latest = samples[samples.length - 1];
    const dtMs = latest.t - first.t;
    if (dtMs < 400) return;
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

  const cleanupListeners = useCallback(async () => {
    for (const un of unlistenRef.current) {
      un();
    }
    unlistenRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      void cleanupListeners();
    };
  }, [cleanupListeners]);

  const resetSession = useCallback(() => {
    void cleanupListeners();
    setPhase("idle");
    setError("");
    setPlans([]);
    setProgress(null);
    setFinished(null);
    resetThroughput();
  }, [cleanupListeners, resetThroughput]);

  /** 关闭弹窗时清空一次性路径选择 */
  const clearPaths = useCallback(() => {
    setSourceDir("");
    setTargetDirs([]);
  }, []);

  const chooseSourceDir = useCallback(async () => {
    const selected = await open({ multiple: false, directory: true });
    if (selected) setSourceDir(selected as string);
  }, []);

  const addTargetDir = useCallback(async () => {
    const selected = await open({ multiple: true, directory: true });
    if (!selected) return;
    const list = Array.isArray(selected) ? selected : [selected];
    const next = [...targetDirsRef.current];
    for (const p of list) {
      if (!next.includes(p)) next.push(p);
    }
    setTargetDirs(next);
  }, []);

  const removeTargetDir = useCallback((path: string) => {
    setTargetDirs(targetDirsRef.current.filter((p) => p !== path));
  }, []);

  const planSync = useCallback(async () => {
    if (!sourceDir || !targetDirs.length) {
      setError("请先选择源目录和至少一个备份目录");
      return;
    }
    setError("");
    setPhase("planning");
    setPlans([]);
    try {
      const summaries = await invoke<SyncPlanSummary[]>("plan_folder_sync", {
        sourceDir,
        targetDirs,
      });
      setPlans(summaries);
      setPhase("review");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }, [sourceDir, targetDirs]);

  const startSync = useCallback(async () => {
    if (!sourceDir || !targetDirs.length) return;
    setError("");
    setFinished(null);
    setProgress(null);
    resetThroughput();
    setPhase("syncing");

    await cleanupListeners();
    const unProgress = await listen<SyncProgressEvent>(
      "sync-progress",
      (ev) => {
        setProgress(ev.payload);
        if (ev.payload.phase === "copying") {
          recordThroughput(ev.payload.bytesCopied, ev.payload.totalCopyBytes);
        }
      },
    );
    const unFinished = await listen<SyncFinishedEvent>(
      "sync-finished",
      (ev) => {
        setFinished(ev.payload);
        setPhase("done");
        void cleanupListeners();
      },
    );
    unlistenRef.current = [unProgress, unFinished];

    try {
      await invoke("start_folder_sync", { sourceDir, targetDirs });
    } catch (e) {
      setError(String(e));
      setPhase("review");
      await cleanupListeners();
    }
  }, [
    cleanupListeners,
    recordThroughput,
    resetThroughput,
    sourceDir,
    targetDirs,
  ]);

  const cancelSync = useCallback(async () => {
    try {
      await invoke("cancel_folder_sync");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return {
    sourceDir,
    targetDirs,
    phase,
    error,
    plans,
    progress,
    finished,
    throughput,
    chooseSourceDir,
    addTargetDir,
    removeTargetDir,
    planSync,
    startSync,
    cancelSync,
    resetSession,
    clearPaths,
  };
}
