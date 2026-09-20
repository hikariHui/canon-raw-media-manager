import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import AppHeader from "./components/AppHeader";
import MainWorkspace from "./components/MainWorkspace";
import OperationTips from "./components/OperationTips";
import ProxySearchModal from "./components/ProxySearchModal";
import SettingsModal from "./components/SettingsModal";
import UpdateModal from "./components/UpdateModal";
import { undo } from "./utils/oprationHistory";
import "./App.css";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    const unlisten = listen("open-settings", () => {
      setSettingsOpen(true);
    });
    return () => {
      unlisten.then((fn) => fn());
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
    </div>
  );
}
