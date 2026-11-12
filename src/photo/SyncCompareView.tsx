import { useCallback, useEffect, useRef } from "react";
import { Skeleton } from "animal-island-ui";
import { MdStar } from "react-icons/md";
import { MAX_COMPARE, usePhotoContext } from "./PhotoContext";
import { useCr3Preview } from "./useCr3Preview";
import "./SyncCompareView.css";

function ComparePane({
  path,
  onToggleKeep,
  allowKeep,
}: {
  path: string;
  onToggleKeep: (path: string) => void;
  /** 仅正式对比（comparePaths 非空）允许勾选保留 */
  allowKeep: boolean;
}) {
  const { syncViewport, setSyncViewport, keepPaths } = usePhotoContext();
  const { url, loading, error } = useCr3Preview(path, "preview", true);
  const name = path.split(/[/\\]/).pop() ?? path;
  const kept = allowKeep && keepPaths.has(path);
  const gestureRef = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);

  return (
    <div
      className={`compare-pane ${kept ? "is-keep" : ""}`}
      title={
        allowKeep
          ? "点击勾选/取消保留"
          : "预览中，双击缩略图加入对比后再勾选保留"
      }
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        gestureRef.current = {
          x: e.clientX,
          y: e.clientY,
          vx: syncViewport.x,
          vy: syncViewport.y,
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const g = gestureRef.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (!g.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
          g.moved = true;
        }
        if (g.moved) {
          setSyncViewport((v) => ({
            ...v,
            x: g.vx + dx,
            y: g.vy + dy,
          }));
        }
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const g = gestureRef.current;
        gestureRef.current = null;
        if (!g || g.moved || e.button !== 0 || !allowKeep) return;
        onToggleKeep(path);
      }}
    >
      <div className="compare-pane-label">
        <span className="compare-pane-name">{name}</span>
        {kept && (
          <span className="compare-pane-keep-badge">
            <MdStar /> 保留
          </span>
        )}
      </div>
      <div className="compare-pane-viewport">
        {url ? (
          <div
            className="compare-pane-stage"
            style={{
              transform: `translate(${syncViewport.x}px, ${syncViewport.y}px) scale(${syncViewport.scale})`,
            }}
          >
            <img src={url} alt={name} draggable={false} />
          </div>
        ) : error ? (
          <div className="compare-pane-empty">无法加载预览</div>
        ) : (
          <Skeleton
            variant="rect"
            active={loading}
            width="100%"
            heightValue="100%"
          />
        )}
      </div>
    </div>
  );
}

export default function SyncCompareView() {
  const {
    comparePaths,
    activeGroup,
    selectedPaths,
    selectionAnchor,
    syncViewport,
    setSyncViewport,
    resetSyncViewport,
    toggleKeep,
  } = usePhotoContext();
  const dragRef = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
  } | null>(null);

  // 特性：comparePaths 为空时回退预览（不算正式对比；预览态禁用 keep）。
  // 有选中时优先锚点/任一选中；否则组内第一张。
  const isFormalCompare = comparePaths.length > 0;
  const paths = (() => {
    if (isFormalCompare) return comparePaths;
    if (selectedPaths.size > 0) {
      if (selectionAnchor && selectedPaths.has(selectionAnchor)) {
        return [selectionAnchor];
      }
      return [[...selectedPaths][0]];
    }
    if (activeGroup?.photos.length) {
      return activeGroup.photos.slice(0, 1).map((p) => p.path);
    }
    return [];
  })();

  const viewRef = useRef<HTMLDivElement | null>(null);

  // React 合成 wheel 默认 passive，需原生监听才能 preventDefault
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setSyncViewport((v) => ({
        ...v,
        scale: Math.min(8, Math.max(0.2, v.scale * delta)),
      }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setSyncViewport, paths.length]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // 点在 pane 上由 pane 自己处理勾选；空白处才拖拽平移
      if ((e.target as HTMLElement).closest(".compare-pane")) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        vx: syncViewport.x,
        vy: syncViewport.y,
      };
    },
    [syncViewport.x, syncViewport.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      const { vx, vy } = dragRef.current;
      setSyncViewport((v) => ({
        ...v,
        x: vx + dx,
        y: vy + dy,
      }));
    },
    [setSyncViewport],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (!paths.length) {
    return (
      <div className="compare-empty">
        {`双击缩略图加入对比（最多 ${MAX_COMPARE} 张）。正式对比后可点击勾选保留；左边多选用于批量删除。`}
      </div>
    );
  }

  const cols =
    paths.length <= 1 ? 1 : paths.length <= 4 ? 2 : paths.length <= 6 ? 3 : 3;

  return (
    <div
      ref={viewRef}
      className="compare-view"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={resetSyncViewport}
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
      }}
    >
      {paths.map((path) => (
        <ComparePane
          key={path}
          path={path}
          onToggleKeep={toggleKeep}
          allowKeep={isFormalCompare}
        />
      ))}
    </div>
  );
}
