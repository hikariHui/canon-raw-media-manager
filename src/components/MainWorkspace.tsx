import { useRef, useEffect } from "react";
import VideoList from "./VideoList";
import ProxyPreview from "./ProxyPreview";
import VideoInfo from "./VideoInfo";
import { useAppContext } from "../context/AppContext";
import "./MainWorkspace.css";

export default function MainWorkspace() {
  const { curCrmFile, curProxyFilePath } = useAppContext();
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [curCrmFile]);

  return (
    <div className="main-workspace">
      <aside className="sidebar">
        <VideoList />
      </aside>

      <div className="content" ref={contentRef}>
        <div className="preview-section">
          <ProxyPreview />
        </div>

        <div className="info-section">
          <div className="info-card">
            <h4 className="info-card-title">Raw 文件信息</h4>
            <VideoInfo videoPath={curCrmFile} />
          </div>
          <div className="info-card">
            <h4 className="info-card-title">Proxy 文件信息</h4>
            <VideoInfo videoPath={curProxyFilePath} />
          </div>
        </div>
      </div>
    </div>
  );
}
