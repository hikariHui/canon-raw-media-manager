import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import AppHeader from "./components/AppHeader";
import ExportModal from "./components/ExportModal";
import MainWorkspace from "./components/MainWorkspace";
import OperationTips from "./components/OperationTips";
import ProxySearchModal from "./components/ProxySearchModal";
import SettingsModal from "./components/SettingsModal";
import SyncModal from "./components/SyncModal";
import UpdateModal from "./components/UpdateModal";
import { undo } from "./utils/oprationHistory";
import "./App.css";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const unlisteners = Promise.all([
      listen("open-settings", () => setSettingsOpen(true)),
      listen("open-export", () => setExportOpen(true)),
      listen("open-sync", () => setSyncOpen(true)),
    ]);
    return () => {
      unlisteners.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  return (
    <div className="app-container">
      <AppHeader />
      <MainWorkspace />
      <footer className="footer">
        <OperationTips />
      </footer>
      <ProxySearchModal />
      <UpdateModal />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} />
    </div>
  );
}
