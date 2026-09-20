import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { store, ALLOWED_MANAGED_DIRS_KEY } from "../utils/store";
import { normalizeDirPath } from "../utils/allowedDirs";

export function useAllowedDirs() {
  const [dirs, setDirs] = useState<string[]>([]);
  const dirsRef = useRef(dirs);

  useEffect(() => {
    dirsRef.current = dirs;
  }, [dirs]);

  useEffect(() => {
    const init = async () => {
      const saved = await store.get<string[]>(ALLOWED_MANAGED_DIRS_KEY);
      if (Array.isArray(saved)) setDirs(saved);
    };
    void init();
  }, []);

  const persist = useCallback(async (paths: string[]) => {
    setDirs(paths);
    await store.set(ALLOWED_MANAGED_DIRS_KEY, paths);
  }, []);

  const addDir = useCallback(async () => {
    const selected = await open({ multiple: true, directory: true });
    if (!selected) return;
    const list = Array.isArray(selected) ? selected : [selected];
    const next = [...dirsRef.current];
    for (const p of list) {
      const normalized = normalizeDirPath(p);
      if (normalized && !next.some((x) => normalizeDirPath(x) === normalized)) {
        next.push(normalized);
      }
    }
    await persist(next);
  }, [persist]);

  const removeDir = useCallback(
    async (path: string) => {
      await persist(dirsRef.current.filter((p) => p !== path));
    },
    [persist],
  );

  return { dirs, addDir, removeDir };
}
