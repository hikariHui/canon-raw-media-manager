import { useEffect } from "react";
import AppHeader from "./components/AppHeader";
import MainWorkspace from "./components/MainWorkspace";
import OperationTips from "./components/OperationTips";
import ProxySearchModal from "./components/ProxySearchModal";
import UpdateModal from "./components/UpdateModal";
import { undo } from "./utils/oprationHistory";
import "./App.css";

export default function App() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
    </div>
  );
}
