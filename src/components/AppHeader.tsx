import { open } from "@tauri-apps/plugin-dialog";
import { Button, Card } from "animal-island-ui";
import { MdFolderOpen, MdVideocam } from "react-icons/md";
import { useAppContext } from "../context/AppContext";
import "./AppHeader.css";

export default function AppHeader() {
  const { rawDir, setRawDir, proxyDir, setProxyDir } = useAppContext();

  const chooseDir = async (target: "raw" | "proxy") => {
    const selected = await open({ multiple: false, directory: true });
    if (!selected) return;
    if (target === "raw") await setRawDir(selected as string);
    else await setProxyDir(selected as string);
  };

  return (
    <header className="header">
      {/* 三角形装饰 */}
      <div className="header-triangles" aria-hidden="true">
        {[...Array(8)].map((_, i) => (
          <span key={i} className={`tri tri-${i % 3}`} />
        ))}
      </div>

      <div className="header-content">
        {/* 左侧标题 */}
        <div className="header-brand">
          <MdVideocam className="brand-icon" />
          <div>
            <h1 className="app-title">Canon 媒体管理器</h1>
            <p className="app-subtitle">RAW 视频与代理文件管理工具</p>
          </div>
        </div>

        {/* 右侧目录选择 */}
        <div className="dir-cards">
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
        </div>
      </div>
    </header>
  );
}
