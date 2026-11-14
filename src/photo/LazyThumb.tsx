import { useEffect, useRef, useState } from "react";
import { Skeleton } from "animal-island-ui";
import {
  abandonThumbQuality,
  forgetThumbCache,
  useCr3Preview,
  type ThumbQuality,
} from "./useCr3Preview";
import { orientationCss, orientationSwapsAxes } from "./orientationCss";

/** Canon 常见 CMOS 画幅 3:2；长边 64px */
const THUMB_LONG = 64;
const THUMB_SHORT = Math.round((THUMB_LONG * 2) / 3); // 43

/** 跨虚拟列表 remount 保留「已升 heavy」 */
const thumbHeavyPaths = new Set<string>();

/** 列表 prune 时清掉已不存在路径，避免同 path 新文件误走 heavy */
export function pruneThumbHeavyPaths(alivePaths: Set<string>) {
  for (const p of [...thumbHeavyPaths]) {
    if (!alivePaths.has(p)) thumbHeavyPaths.delete(p);
  }
}

const MAX_HEAVY_AUTO_RETRY = 2;

interface LazyThumbProps {
  path: string;
  alt?: string;
  className?: string;
  selected?: boolean;
  comparing?: boolean;
  orientation?: number | null;
  preferHeavy?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}

export default function LazyThumb({
  path,
  alt,
  className = "",
  selected,
  comparing,
  orientation,
  preferHeavy,
  onClick,
  onDoubleClick,
}: LazyThumbProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [escalated, setEscalated] = useState(() => thumbHeavyPaths.has(path));
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [heavyRetries, setHeavyRetries] = useState(0);
  /** 点击后立刻为 true，避免等 loading 才出现「重建中」 */
  const [forceRebuilding, setForceRebuilding] = useState(false);
  const retryingRef = useRef(false);
  /** decodeFailed 后若 hook 因 invalidate 重拉，等 loading 结束再决定是否清 broken */
  const pendingDecodeRecoverRef = useRef(false);

  const useHeavy = escalated || thumbHeavyPaths.has(path);
  const quality: ThumbQuality = useHeavy ? "heavy" : "fast";
  const enabled = visible || !!preferHeavy || forceRebuilding;

  const { url, loading, errorMessage, retry } = useCr3Preview(
    path,
    "thumb",
    enabled,
    quality,
  );

  const showUrl = url && !decodeFailed ? url : null;
  const settledEmpty = attempted && !loading && !showUrl;
  const failed = settledEmpty || decodeFailed;
  const giveUp =
    useHeavy &&
    !loading &&
    !showUrl &&
    !forceRebuilding &&
    attempted &&
    heavyRetries >= MAX_HEAVY_AUTO_RETRY;

  // 正在抽取或刚点了重建 → 「重建中」（勿用 useHeavy&&preferHeavy：重试间隙会误显）
  const rebuilding = !showUrl && !giveUp && (loading || forceRebuilding);

  const portrait = orientationSwapsAxes(orientation);

  const escalate = () => {
    thumbHeavyPaths.add(path);
    abandonThumbQuality(path, "fast");
    setDecodeFailed(false);
    setAttempted(false);
    setHeavyRetries(0);
    retryingRef.current = false;
    setForceRebuilding(true);
    setEscalated(true);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        setVisible(hit);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    setDecodeFailed(false);
    setAttempted(false);
    setHeavyRetries(0);
    setForceRebuilding(false);
    retryingRef.current = false;
    pendingDecodeRecoverRef.current = false;
    setEscalated(thumbHeavyPaths.has(path));
  }, [path]);

  useEffect(() => {
    if (loading) {
      setAttempted(true);
      retryingRef.current = false;
    }
  }, [loading]);

  useEffect(() => {
    if (showUrl) setForceRebuilding(false);
  }, [showUrl]);

  // file-change / invalidate 重拉开始：接入 recover（勿在 markBroken 当下清，否则旧 url 会立刻再挂裂图）
  useEffect(() => {
    if (!decodeFailed || !loading) return;
    pendingDecodeRecoverRef.current = true;
  }, [decodeFailed, loading]);

  // 重拉结束：有 url 则清 decodeFailed（同字符串也会重新挂载 <img>）
  useEffect(() => {
    if (!pendingDecodeRecoverRef.current) return;
    if (loading) return;
    pendingDecodeRecoverRef.current = false;
    if (url) setDecodeFailed(false);
  }, [loading, url]);

  const markBroken = () => {
    forgetThumbCache(path, quality);
    pendingDecodeRecoverRef.current = false;
    setDecodeFailed(true);
  };

  // 选中/对比 + 无可用图 → 升 heavy
  useEffect(() => {
    if (useHeavy || !preferHeavy) return;
    if (loading || showUrl) return;
    if (!attempted && !decodeFailed) return;
    escalate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferHeavy, useHeavy, loading, showUrl, attempted, decodeFailed, path]);

  // heavy 自动重试
  useEffect(() => {
    if (!preferHeavy || !useHeavy) return;
    if (showUrl || loading || giveUp) return;
    if (!attempted && !decodeFailed) return;
    if (retryingRef.current) return;
    if (heavyRetries >= MAX_HEAVY_AUTO_RETRY) return;
    retryingRef.current = true;
    setDecodeFailed(false);
    setForceRebuilding(true);
    setHeavyRetries((n) => n + 1);
    retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    preferHeavy,
    useHeavy,
    showUrl,
    loading,
    giveUp,
    attempted,
    decodeFailed,
    heavyRetries,
  ]);

  const handleClick = (e: React.MouseEvent) => {
    if (!showUrl) {
      // 加载中再点：保持重建中，不取消
      if (!useHeavy) {
        escalate();
      } else {
        forgetThumbCache(path, "heavy");
        setDecodeFailed(false);
        setAttempted(false);
        setHeavyRetries(0);
        retryingRef.current = false;
        setForceRebuilding(true);
        retry();
      }
    }
    onClick?.(e);
  };

  const title = rebuilding
    ? `${alt ?? ""} · 正在重建缩略图`.trim()
    : failed || giveUp
      ? `${alt ?? ""} · ${errorMessage ?? (decodeFailed ? "缓存失效/404" : "无可用缩略图")}`.trim()
      : alt;

  const imgStyle: React.CSSProperties = portrait
    ? {
        ...orientationCss(orientation),
        width: THUMB_LONG,
        height: THUMB_SHORT,
        maxWidth: "none",
        maxHeight: "none",
        objectFit: "cover",
      }
    : {
        ...orientationCss(orientation),
        width: "100%",
        height: "100%",
        objectFit: "cover",
      };

  return (
    <button
      type="button"
      ref={ref}
      className={[
        "photo-thumb",
        portrait ? "is-portrait" : "is-landscape",
        selected ? "is-selected" : "",
        comparing ? "is-comparing" : "",
        rebuilding ? "is-rebuilding" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      title={title}
      aria-busy={rebuilding || undefined}
    >
      {showUrl ? (
        <img
          src={showUrl}
          alt={alt ?? ""}
          draggable={false}
          style={imgStyle}
          onError={markBroken}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth < 2 || img.naturalHeight < 2) {
              markBroken();
            }
          }}
        />
      ) : rebuilding ? (
        <span className="photo-thumb-rebuilding">
          <span className="photo-thumb-rebuilding-dot" aria-hidden />
          重建中
        </span>
      ) : failed || giveUp ? (
        <span className="photo-thumb-fallback">无预览</span>
      ) : (
        <Skeleton
          variant="rect"
          active={loading || !visible}
          width="100%"
          heightValue="100%"
        />
      )}
    </button>
  );
}
