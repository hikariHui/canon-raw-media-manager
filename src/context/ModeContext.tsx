import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { APP_MODE_KEY, store } from "../utils/store";

export type AppMode = "video" | "photo";

interface ModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<AppMode>("video");

  useEffect(() => {
    store.get<AppMode>(APP_MODE_KEY).then((saved) => {
      if (saved === "video" || saved === "photo") setModeState(saved);
    });
  }, []);

  const setMode = useCallback((next: AppMode) => {
    setModeState(next);
    void store.set(APP_MODE_KEY, next);
  }, []);

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useAppMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useAppMode must be used within ModeProvider");
  return ctx;
}
