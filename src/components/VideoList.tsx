import { useState, useEffect, useRef } from "react";
import { Button } from "animal-island-ui";
import { MdVideocam, MdMyLocation } from "react-icons/md";
import { useAppContext } from "../context/AppContext";
import { deleteVideo, starVideo } from "../hooks/useMoveVideo";
import "./VideoList.css";

const getFileName = (path: string) => path.split(/[/\\]/).pop() || path;

const formatDuration = (seconds?: number): string => {
  if (seconds === undefined) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0)
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

export default function VideoList() {
  const { filesList, curCrmFile, setCurCrmFile, proxyDir } = useAppContext();
  const [curIndex, setCurIndex] = useState(-1);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const curIndexRef = useRef(curIndex);
  const filesListRef = useRef(filesList);
  const curCrmFileRef = useRef(curCrmFile);
  const proxyDirRef = useRef(proxyDir);

  useEffect(() => {
    curIndexRef.current = curIndex;
  }, [curIndex]);
  useEffect(() => {
    filesListRef.current = filesList;
  }, [filesList]);
  useEffect(() => {
    curCrmFileRef.current = curCrmFile;
  }, [curCrmFile]);
  useEffect(() => {
    proxyDirRef.current = proxyDir;
  }, [proxyDir]);

  // Sync curIndex → scroll into view
  useEffect(() => {
    if (curIndex === -1 || !listContainerRef.current) return;
    const items = listContainerRef.current.querySelectorAll(".list-item");
    const item = items[curIndex] as HTMLElement;
    if (item) item.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [curIndex]);

  // Sync curIndex → update curCrmFile
  useEffect(() => {
    const file = filesList[curIndex];
    setCurCrmFile(file?.path ?? "");
  }, [curIndex, filesList, setCurCrmFile]);

  // Sync filesList → update curIndex
  useEffect(() => {
    if (!filesList.length) {
      setCurIndex(-1);
      return;
    }
    const found = filesList.findIndex((f) => f.path === curCrmFileRef.current);
    if (found !== -1) {
      setCurIndex(found);
      return;
    }
    const idx = curIndexRef.current;
    if (idx < filesList.length) {
      setCurCrmFile(filesList[idx]?.path ?? "");
    } else {
      setCurIndex(filesList.length - 1);
    }
  }, [filesList, setCurCrmFile]);

  // Keyboard listeners
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        setCurIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "ArrowDown") {
        setCurIndex((i) => Math.min(i + 1, filesListRef.current.length - 1));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (curCrmFileRef.current) {
          await deleteVideo(curCrmFileRef.current, proxyDirRef.current);
        }
      } else if (e.key === "Enter") {
        if (curCrmFileRef.current) {
          await starVideo(curCrmFileRef.current, proxyDirRef.current);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const scrollToCurrent = () => {
    if (curIndex === -1 || !listContainerRef.current) return;
    const items = listContainerRef.current.querySelectorAll(".list-item");
    const item = items[curIndex] as HTMLElement;
    if (item) item.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="video-list-container">
      <div className="list-header">
        <h3 className="list-title">
          <MdVideocam size={18} />
          视频列表
        </h3>
        <span className="list-count">{filesList.length}</span>
      </div>

      {!filesList.length ? (
        <div className="empty-state">暂无视频文件</div>
      ) : (
        <div ref={listContainerRef} className="list-scroll">
          {filesList.map((file, index) => (
            <div
              key={file.path}
              className={`list-item${curIndex === index ? " active" : ""}`}
              onClick={() => setCurIndex(index)}
            >
              <div className="file-info">
                <div className="file-header">
                  <span className="file-name">{getFileName(file.path)}</span>
                  <div className="file-meta">
                    {file.loading ? (
                      <span className="loading-dot">···</span>
                    ) : file.duration ? (
                      <span className="file-duration">
                        {formatDuration(file.duration)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="file-index">#{index + 1}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {curIndex !== -1 && (
        <Button
          type="primary"
          className="scroll-btn"
          onClick={scrollToCurrent}
          title="定位到当前选中的视频"
        >
          <MdMyLocation size={16} />
        </Button>
      )}
    </div>
  );
}
