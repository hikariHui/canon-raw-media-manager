import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppContext } from "../context/AppContext";
import "./VideoInfo.css";

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  codec: string;
  bit_rate: string;
  frame_rate: string;
  audio_codec: string | null;
  audio_channels: number | null;
  file_size: number;
  modified_time: number;
}

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0)
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

const formatBitrate = (bitrate: string) => {
  const rate = parseInt(bitrate);
  if (rate > 1000000) return `${(rate / 1000000).toFixed(2)} Mbps`;
  return `${(rate / 1000).toFixed(2)} Kbps`;
};

const formatFrameRate = (frameRate: string) => {
  if (frameRate.includes("/")) {
    const [n, d] = frameRate.split("/").map(Number);
    if (d) {
      const fps = n / d;
      return fps % 1 === 0 ? fps.toString() : fps.toFixed(2);
    }
  }
  return frameRate;
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatModifiedTime = (timestamp: number) => {
  return new Date(timestamp * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

export default function VideoInfo({ videoPath }: { videoPath: string }) {
  const { updateFileDuration } = useAppContext();
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fileName = videoPath ? videoPath.split(/[/\\]/).pop() || videoPath : "";

  useEffect(() => {
    if (!videoPath) {
      setVideoInfo(null);
      setErrMsg(null);
      return;
    }
    setLoading(true);
    invoke<VideoInfo>("get_video_info", { videoPath })
      .then((info) => {
        setVideoInfo(info);
        setErrMsg(null);
        updateFileDuration(videoPath);
      })
      .catch((err) => {
        setErrMsg(err as string);
        setVideoInfo(null);
      })
      .finally(() => setLoading(false));
  }, [videoPath, updateFileDuration]);

  if (!videoPath) {
    return (
      <div className="video-info-empty">
        <span>未选择文件</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="video-info-loading">
        <span>加载中...</span>
      </div>
    );
  }

  if (errMsg) {
    return (
      <div className="video-info-error">
        <span>{errMsg}</span>
      </div>
    );
  }

  if (!videoInfo) return null;

  return (
    <div className="video-info-content">
      <span className="file-path" title={videoPath}>
        {fileName}
      </span>
      <dl className="info-list">
        <div className="info-row">
          <dt>分辨率</dt>
          <dd>
            <span className="info-tag">
              {videoInfo.width} × {videoInfo.height}
            </span>
          </dd>
        </div>
        <div className="info-row">
          <dt>文件大小</dt>
          <dd>{formatFileSize(videoInfo.file_size)}</dd>
        </div>
        <div className="info-row">
          <dt>修改时间</dt>
          <dd>{formatModifiedTime(videoInfo.modified_time)}</dd>
        </div>
        <div className="info-row">
          <dt>时长</dt>
          <dd>{formatDuration(videoInfo.duration)}</dd>
        </div>
        <div className="info-row">
          <dt>视频编码</dt>
          <dd>
            <span className="info-tag info-tag-green">{videoInfo.codec}</span>
          </dd>
        </div>
        <div className="info-row">
          <dt>比特率</dt>
          <dd>{formatBitrate(videoInfo.bit_rate)}</dd>
        </div>
        <div className="info-row">
          <dt>帧率</dt>
          <dd>{formatFrameRate(videoInfo.frame_rate)} fps</dd>
        </div>
        {videoInfo.audio_codec && (
          <div className="info-row">
            <dt>音频编码</dt>
            <dd>
              <span className="info-tag info-tag-orange">
                {videoInfo.audio_codec}
              </span>
            </dd>
          </div>
        )}
        {videoInfo.audio_channels && (
          <div className="info-row">
            <dt>音频声道</dt>
            <dd>{videoInfo.audio_channels} 声道</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
