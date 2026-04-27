import { useRef, useState, useEffect } from "react";
import { MdVideocamOff } from "react-icons/md";
import { useAppContext } from "../context/AppContext";
import "./ProxyPreview.css";

export default function ProxyPreview() {
  const { curProxyFileUrl } = useAppContext();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        if (videoRef.current) {
          if (videoRef.current.paused) {
            videoRef.current.play();
            setIsPlaying(true);
          } else {
            videoRef.current.pause();
            setIsPlaying(false);
          }
        }
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime += 5;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime -= 5;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auto-continue playing when source changes
  useEffect(() => {
    if (!curProxyFileUrl) return;
    const timer = setTimeout(() => {
      if (isPlaying && videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [curProxyFileUrl, isPlaying]);

  if (!curProxyFileUrl) {
    return (
      <div className="preview-empty">
        <MdVideocamOff className="preview-empty-icon" />
        <span>暂无预览文件</span>
      </div>
    );
  }

  return (
    <div className="preview-container">
      <video
        ref={videoRef}
        src={curProxyFileUrl}
        controls
        className="video-player"
      />
    </div>
  );
}
