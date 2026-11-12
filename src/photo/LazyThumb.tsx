import { useEffect, useRef, useState } from "react";
import { Skeleton } from "animal-island-ui";
import { useCr3Preview } from "./useCr3Preview";

interface LazyThumbProps {
  path: string;
  alt?: string;
  className?: string;
  selected?: boolean;
  comparing?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}

export default function LazyThumb({
  path,
  alt,
  className,
  selected,
  comparing,
  onClick,
  onDoubleClick,
}: LazyThumbProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const { url, loading, error } = useCr3Preview(path, "thumb", visible);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={alt}
    >
      {url ? (
        <img src={url} alt={alt ?? ""} draggable={false} />
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
