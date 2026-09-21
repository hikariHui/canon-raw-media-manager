import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, Modal } from "animal-island-ui";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "error";

export default function UpdateModal() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const checkingRef = useRef(false);

  const runCheck = async (manual: boolean) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    if (manual) {
      setPhase("checking");
      setUpdate(null);
      setError("");
    }
    try {
      const result = await check();
      if (result) {
        setUpdate(result);
        setPhase("available");
      } else if (manual) {
        setPhase("up-to-date");
      }
    } catch (e) {
      if (manual) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
      // 启动时静默检查失败（开发模式/无网络）忽略
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    void runCheck(false);
  }, []);

  useEffect(() => {
    const unlisten = listen("check-update", () => {
      void runCheck(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const dismiss = () => {
    if (phase === "downloading" || phase === "checking") return;
    setPhase("idle");
    setUpdate(null);
    setError("");
  };

  const install = async () => {
    if (!update) return;
    setPhase("downloading");
    setProgress(0);
    setError("");
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setProgress(Math.min(100, (downloaded / total) * 100));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  if (phase === "idle") return null;

  const titleMap: Record<Exclude<Phase, "idle">, string> = {
    checking: "检查更新",
    "up-to-date": "检查更新",
    available: "发现新版本",
    downloading: "发现新版本",
    error: "更新失败",
  };

  const busy = phase === "downloading" || phase === "checking";

  const footer =
    phase === "available" ? (
      <>
        <Button onClick={dismiss}>稍后</Button>
        <Button type="primary" onClick={install}>
          立即更新
        </Button>
      </>
    ) : phase === "downloading" || phase === "checking" ? (
      <Button type="primary" disabled>
        {phase === "checking" ? "检查中…" : "下载中…"}
      </Button>
    ) : (
      <Button type="primary" onClick={dismiss}>
        知道了
      </Button>
    );

  return (
    <Modal
      open
      title={titleMap[phase]}
      width={420}
      typewriter={false}
      maskClosable={!busy}
      closable={!busy}
      onClose={dismiss}
      footer={footer}
    >
      {phase === "checking" ? (
        <p
          style={{ margin: 0, color: "#794f27", fontSize: 14, lineHeight: 1.6 }}
        >
          正在检查更新，请稍候…
        </p>
      ) : null}
      {phase === "up-to-date" ? (
        <p
          style={{ margin: 0, color: "#794f27", fontSize: 14, lineHeight: 1.6 }}
        >
          当前已是最新版本。
        </p>
      ) : null}
      {phase === "available" && update ? (
        <p
          style={{ margin: 0, color: "#794f27", fontSize: 14, lineHeight: 1.6 }}
        >
          新版本 <strong>v{update.version}</strong> 可用。
          {update.body ? (
            <>
              <br />
              {update.body}
            </>
          ) : null}
        </p>
      ) : null}
      {phase === "downloading" ? (
        <div>
          <p
            style={{
              margin: "0 0 12px",
              color: "#794f27",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            正在下载并安装更新，完成后将自动重启…
          </p>
          <div
            style={{
              height: 8,
              borderRadius: 4,
              background: "rgb(121 79 39 / 15%)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                background: "#7dc395",
                transition: "width 0.2s ease",
              }}
            />
          </div>
          <p
            style={{
              margin: "8px 0 0",
              color: "#794f27",
              fontSize: 12,
              textAlign: "right",
            }}
          >
            {progress.toFixed(0)}%
          </p>
        </div>
      ) : null}
      {phase === "error" ? (
        <p
          style={{ margin: 0, color: "#794f27", fontSize: 14, lineHeight: 1.6 }}
        >
          {error || "更新失败，请稍后重试或手动下载新版本。"}
        </p>
      ) : null}
    </Modal>
  );
}
