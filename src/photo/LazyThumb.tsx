import { useEffect, useRef, useState } from "react";
import { Skeleton } from "animal-island-ui";
import { useCr3Preview, type ThumbQuality } from "./useCr3Preview";
import { orientationCss, orientationSwapsAxes } from "./orientationCss";

interface LazyThumbProps {
  path: string;
  alt?: string;
  className?: string;
  selected?: boolean;
  comparing?: boolean;
  orientation?: number | null;
  /** 选中且快路径失败时自动升 heavy */
  preferHeavy?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}

export default function LazyThumb({
  path,
  alt,
  className,
  selected,
  comparing,
  orientation,
  preferHeavy,
  onClick,
  onDoubleClick,
}: LazyThumbProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [quality, setQuality] = useState<ThumbQuality>("fast");
  const { url, loading, error, retry } = useCr3Preview(
    path,
    "thumb",
    visible,
    quality,
  );

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

  // 点选且快路径失败 → heavy 兜底
  useEffect(() => {
    if (preferHeavy && error && quality === "fast") {
      setQuality("heavy");
    }
  }, [preferHeavy, error, quality]);

  const handleClick = (e: React.MouseEvent) => {
    if (error) {
      if (quality === "fast") setQuality("heavy");
      else retry();
    }
    onClick?.(e);
  };

  return (
    <button
      type="button"
      ref={ref}
      className={[
        "photo-thumb",
        selected ? "is-selected" : "",
        comparing ? "is-comparing" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      title={alt}
    >
      {url ? (
        <img
          src={url}
          alt={alt ?? ""}
          draggable={false}
          style={{
            ...orientationCss(orientation),
            // 90/270：在 64×48 框内先按交换后的像素盒排，再旋转，减少 cover 裁切错位
            ...(orientationSwapsAxes(orientation)
              ? { width: "48px", height: "64px", maxWidth: "none" }
              : {}),
          }}
        />
      ) : error ? (
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
