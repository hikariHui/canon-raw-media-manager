import { useEffect, useRef } from "react";
import BurstGroupList from "./BurstGroupList";
import PhotoToolbar from "./PhotoToolbar";
import SyncCompareView from "./SyncCompareView";
import "./PhotoWorkspace.css";

export default function PhotoWorkspace() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // WKWebView 下仅靠 CSS 仍可能拖出选区；在工作区拦截 selectstart
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const block = (e: Event) => e.preventDefault();
    el.addEventListener("selectstart", block);
    return () => el.removeEventListener("selectstart", block);
  }, []);

  return (
    <div className="photo-workspace" ref={rootRef}>
      <aside className="photo-sidebar">
        <BurstGroupList />
      </aside>
      <div className="photo-main">
        <PhotoToolbar />
        <div className="photo-compare-wrap">
          <SyncCompareView />
        </div>
      </div>
    </div>
  );
}
