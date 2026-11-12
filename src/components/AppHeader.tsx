import { open } from "@tauri-apps/plugin-dialog";
import { Button, Card } from "animal-island-ui";
import { MdFolderOpen, MdVideocam, MdPhotoCamera } from "react-icons/md";
import { useAppContext } from "../context/AppContext";
import { useAppMode } from "../context/ModeContext";
import { usePhotoContext } from "../photo/PhotoContext";
import "./AppHeader.css";

export default function AppHeader() {
  const { mode, setMode } = useAppMode();
  const { rawDir, setRawDir, proxyDir, setProxyDir } = useAppContext();
  const { photoDir, setPhotoDir } = usePhotoContext();

  const chooseDir = async (target: "raw" | "proxy" | "photo") => {
    const selected = await open({ multiple: false, directory: true });
    if (!selected) return;
    if (target === "raw") await setRawDir(selected as string);
    else if (target === "proxy") await setProxyDir(selected as string);
    else await setPhotoDir(selected as string);
  };

  return (
    <header className="header">
      <div className="header-triangles" aria-hidden="true">
        {[...Array(8)].map((_, i) => (
          <span key={i} className={`tri tri-${i % 3}`} />
        ))}
      </div>

      <div className="header-content">
        <div className="header-brand">
          {mode === "photo" ? (
            <MdPhotoCamera className="brand-icon" />
          ) : (
            <MdVideocam className="brand-icon" />
          )}
          <div>
            <h1 className="app-title">Canon 媒体管理器</h1>
            <p className="app-subtitle">
              {mode === "photo"
                ? "RAW 照片连拍筛图"
                : "RAW 视频与代理文件管理工具"}
            </p>
          </div>
        </div>

        <div className="mode-switch" role="tablist" aria-label="工作区模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "video"}
            className={`mode-btn ${mode === "video" ? "is-active" : ""}`}
            onClick={() => setMode("video")}
          >
            <MdVideocam />
            视频
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "photo"}
            className={`mode-btn ${mode === "photo" ? "is-active" : ""}`}
            onClick={() => setMode("photo")}
          >
            <MdPhotoCamera />
            照片
          </button>
        </div>

        <div className="dir-cards">
          {mode === "video" ? (
            <>
              <Card className="dir-card">
                <div className="dir-card-label">Raw 目录</div>
                <div className="dir-card-row">
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => chooseDir("raw")}
                  >
                    <MdFolderOpen style={{ marginRight: 4 }} />
                    选择
                  </Button>
                  <span className="dir-path" title={rawDir}>
                    {rawDir || "未选择目录"}
                  </span>
                </div>
              </Card>

              <Card className="dir-card">
                <div className="dir-card-label">Proxy 目录</div>
                <div className="dir-card-row">
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => chooseDir("proxy")}
                  >
                    <MdFolderOpen style={{ marginRight: 4 }} />
                    选择
                  </Button>
                  <span className="dir-path" title={proxyDir}>
                    {proxyDir || "未选择目录"}
                  </span>
                </div>
              </Card>
            </>
          ) : (
            <Card className="dir-card">
              <div className="dir-card-label">照片 Raw 目录</div>
              <div className="dir-card-row">
                <Button
                  type="primary"
                  size="small"
                  onClick={() => chooseDir("photo")}
                >
                  <MdFolderOpen style={{ marginRight: 4 }} />
                  选择
                </Button>
                <span className="dir-path" title={photoDir}>
                  {photoDir || "未选择目录"}
                </span>
              </div>
            </Card>
          )}
        </div>
      </div>
    </header>
  );
}
