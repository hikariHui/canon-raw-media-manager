import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "animal-island-ui";
import { MdStar } from "react-icons/md";
import { MAX_COMPARE, usePhotoContext } from "./PhotoContext";
import {
  forgetPreviewCache,
  setRawPreviewPriority,
  useCr3Preview,
} from "./useCr3Preview";
import { orientationCss, orientationSwapsAxes } from "./orientationCss";
import "./SyncCompareView.css";

/** 相对物理像素达到 100% 即开始 RAW */
const RAW_NATIVE_ZOOM = 1;
const MAX_SCALE = 32;
const MIN_SCALE = 0.05;

function ComparePane({
  path,
  orientation,
  onToggleKeep,
  allowKeep,
  useRaw,
  onReportFit,
  onReportWantRaw,
}: {
  path: string;
  orientation: number | null;
  onToggleKeep: (path: string) => void;
  allowKeep: boolean;
  useRaw: boolean;
  /** 上报本格适应倍率；卸载时传 null 移除 */
  onReportFit: (path: string, fit: number | null) => void;
  /** 上报是否仍要拉 RAW（切 JPG 时为 false，便于踢出优先级） */
  onReportWantRaw: (path: string, want: boolean) => void;
}) {
  const {
    syncViewport,
    setSyncViewport,
    keepPaths,
    fitNativeZoom,
    resetSyncViewport,
  } = usePhotoContext();
  const jpeg = useCr3Preview(path, "preview", true);
  /** RAW 就绪后默认用 RAW；点标签可切回 JPG（切 JPG 时不占 RAW 槽） */
  const [preferRaw, setPreferRaw] = useState(true);
  /** asset URL 404/解码失败：挡裂图；每种源最多自动重抽一次 */
  const [imgBroken, setImgBroken] = useState(false);
  /** 同 asset URL 重抽成功后强制 remount <img>，否则浏览器不重新请求 */
  const [imgEpoch, setImgEpoch] = useState(0);
  const imgRetryUsedRef = useRef(false);
  /** onError 已发起 retry，等 loading 结束后再决定是否恢复显示 */
  const pendingImgRecoverRef = useRef(false);
  useEffect(() => {
    if (useRaw) setPreferRaw(true);
  }, [useRaw, path]);
  const wantRaw = useRaw && preferRaw;
  useEffect(() => {
    onReportWantRaw(path, wantRaw);
    return () => onReportWantRaw(path, false);
  }, [path, wantRaw, onReportWantRaw]);
  const raw = useCr3Preview(path, "raw", wantRaw);
  const showingRaw = Boolean(wantRaw && raw.url);
  const sourceUrl = showingRaw ? raw.url! : jpeg.url;
  const url = sourceUrl && !imgBroken ? sourceUrl : null;
  const pendingRaw = wantRaw && raw.loading && !raw.url;
  const loading = !url && (jpeg.loading || pendingRaw || raw.loading);
  const error =
    !url && !loading && (jpeg.error || (wantRaw && raw.error) || imgBroken);

  useEffect(() => {
    setImgBroken(false);
    setImgEpoch(0);
    imgRetryUsedRef.current = false;
    pendingImgRecoverRef.current = false;
  }, [path, showingRaw]);

  // 已卡在 broken 时若 hook 又开始加载（invalidate / file-change），接入 recover，并重置 onError 预算
  useEffect(() => {
    if (!imgBroken) return;
    const loadingNow = showingRaw ? raw.loading : jpeg.loading;
    if (!loadingNow) return;
    if (pendingImgRecoverRef.current) return; // 已在 onError→retry 周期内
    pendingImgRecoverRef.current = true;
    imgRetryUsedRef.current = false;
  }, [imgBroken, jpeg.loading, raw.loading, showingRaw]);

  // pending 拉取结束：即使 URL 字符串不变也清 broken + bump epoch
  useEffect(() => {
    if (!pendingImgRecoverRef.current) return;
    const loadingNow = showingRaw ? raw.loading : jpeg.loading;
    if (loadingNow) return;
    pendingImgRecoverRef.current = false;
    const activeUrl = showingRaw ? raw.url : jpeg.url;
    if (activeUrl) {
      setImgBroken(false);
      setImgEpoch((n) => n + 1);
    }
  }, [jpeg.loading, raw.loading, jpeg.url, raw.url, showingRaw]);
  const name = path.split(/[/\\]/).pop() ?? path;
  const kept = allowKeep && keepPaths.has(path);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const gestureRef = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  // 与父级 nativeZoom 一致：适应未就绪时为 0，不用假 1
  const effectiveScale =
    syncViewport.scale > 0 ? syncViewport.scale : (fitNativeZoom ?? 0);
  const fitReady = effectiveScale > 0;

  const measureFit = useCallback(() => {
    const img = imgRef.current;
    if (!img?.naturalWidth || !img.naturalHeight) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    setNatural({ w: nw, h: nh });

    const viewport = img.closest(
      ".compare-pane-viewport",
    ) as HTMLElement | null;
    const box = viewport ?? img.parentElement;
    if (!box) return;
    const pw = box.clientWidth;
    const ph = box.clientHeight;
    if (pw <= 0 || ph <= 0) return;

    const swap = orientationSwapsAxes(orientation);
    const cssW = (swap ? nh : nw) / dpr;
    const cssH = (swap ? nw : nh) / dpr;
    const fit = Math.min(pw / cssW, ph / cssH);
    if (!(fit > 0)) return;
    onReportFit(path, fit);
  }, [dpr, orientation, onReportFit, path]);

  useEffect(() => {
    measureFit();
    const onResize = () => measureFit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      onReportFit(path, null);
    };
  }, [measureFit, url, onReportFit, path]);

  const imgLayoutStyle: React.CSSProperties = natural
    ? {
        ...orientationCss(orientation),
        width: natural.w / dpr,
        height: natural.h / dpr,
        maxWidth: "none",
        maxHeight: "none",
      }
    : { ...orientationCss(orientation) };

  return (
    <div
      className={`compare-pane ${kept ? "is-keep" : ""}`}
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
        // fit 未就绪时不平移
        if (g.moved && (syncViewport.scale > 0 || (fitNativeZoom ?? 0) > 0)) {
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
      onDoubleClick={(e) => {
        e.stopPropagation();
        resetSyncViewport();
      }}
      onPointerCancel={() => {
        gestureRef.current = null;
      }}
    >
      <div className="compare-pane-label">
        <span className="compare-pane-name">{name}</span>
        <span className="compare-pane-badges">
          {useRaw && raw.url && (
            <button
              type="button"
              className={`compare-pane-raw-badge is-toggle ${showingRaw ? "" : "is-jpg"}`}
              title={
                showingRaw
                  ? "当前 RAW 细节，点击切回 JPG 预览"
                  : "当前 JPG 预览，点击切回 RAW 细节"
              }
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPreferRaw((v) => !v);
              }}
            >
              {showingRaw ? "RAW 细节" : "JPG 预览"}
            </button>
          )}
          {wantRaw && raw.loading && !raw.url && (
            <span
              className="compare-pane-raw-badge is-loading"
              title="正在显影 RAW"
            >
              RAW 解析中…
            </span>
          )}
          {wantRaw && raw.error && !raw.url && (
            <span
              className="compare-pane-raw-badge is-error"
              title={raw.errorMessage ?? ""}
            >
              RAW 失败
            </span>
          )}
          {kept && (
            <span className="compare-pane-keep-badge">
              <MdStar /> 保留
            </span>
          )}
        </span>
      </div>
      <div className="compare-pane-viewport">
        {url ? (
          <div
            className="compare-pane-stage"
            style={{
              // fit 未就绪前透明，避免用 scale(1) 造成「已放大」错觉
              opacity: fitReady ? 1 : 0,
              transform: `translate(${syncViewport.x}px, ${syncViewport.y}px) scale(${fitReady ? effectiveScale : 1})`,
            }}
          >
            <img
              key={`${showingRaw ? "raw" : "jpg"}-${imgEpoch}`}
              ref={imgRef}
              src={url}
              alt={name}
              draggable={false}
              style={imgLayoutStyle}
              onLoad={measureFit}
              onError={() => {
                setImgBroken(true);
                if (showingRaw) {
                  forgetPreviewCache(path, "raw");
                } else {
                  forgetPreviewCache(path, "preview");
                }
                if (imgRetryUsedRef.current) return;
                imgRetryUsedRef.current = true;
                pendingImgRecoverRef.current = true;
                if (showingRaw) raw.retry();
                else jpeg.retry();
              }}
            />
          </div>
        ) : loading ? (
          <Skeleton variant="rect" active width="100%" heightValue="100%" />
        ) : error ? (
          <div className="compare-pane-empty">无法加载预览</div>
        ) : (
          <Skeleton variant="rect" active width="100%" heightValue="100%" />
        )}
      </div>
    </div>
  );
}

export default function SyncCompareView() {
  const {
    photos,
    comparePaths,
    activeGroup,
    selectedPaths,
    selectionAnchor,
    syncViewport,
    setSyncViewport,
    resetSyncViewport,
    fitNativeZoom,
    setFitNativeZoom,
    toggleKeep,
  } = usePhotoContext();
  const dragRef = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
  } | null>(null);
  const [rawUnlocked, setRawUnlocked] = useState<Set<string>>(() => new Set());
  const [wantRawPaths, setWantRawPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const fitByPathRef = useRef<Map<string, number>>(new Map());

  const isFormalCompare = comparePaths.length > 0;
  const paths = useMemo(() => {
    if (isFormalCompare) return comparePaths;
    if (selectedPaths.size > 0) {
      if (selectionAnchor && selectedPaths.has(selectionAnchor)) {
        return [selectionAnchor];
      }
      const first = selectedPaths.values().next().value;
      return first ? [first] : [];
    }
    if (activeGroup?.photos.length) {
      return [activeGroup.photos[0].path];
    }
    return [] as string[];
  }, [
    isFormalCompare,
    comparePaths,
    selectedPaths,
    selectionAnchor,
    activeGroup,
  ]);

  const pathsKey = paths.join("\0");
  const wantRawKey = useMemo(
    () => [...wantRawPaths].sort().join("\0"),
    [wantRawPaths],
  );

  const orientationByPath = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of photos) m.set(p.path, p.orientation);
    return m;
  }, [photos]);

  const applyMinFit = useCallback(() => {
    const values = [...fitByPathRef.current.values()].filter((v) => v > 0);
    if (!values.length) {
      setFitNativeZoom(null);
      return;
    }
    const minFit = Math.min(...values);
    setFitNativeZoom(minFit);
    setSyncViewport((v) => (v.scale > 0 ? v : { scale: minFit, x: 0, y: 0 }));
  }, [setFitNativeZoom, setSyncViewport]);

  const onReportFit = useCallback(
    (path: string, fit: number | null) => {
      if (fit == null || !(fit > 0)) {
        fitByPathRef.current.delete(path);
      } else {
        fitByPathRef.current.set(path, fit);
      }
      applyMinFit();
    },
    [applyMinFit],
  );

  const onReportWantRaw = useCallback((path: string, want: boolean) => {
    setWantRawPaths((prev) => {
      const has = prev.has(path);
      if (want && has) return prev;
      if (!want && !has) return prev;
      const next = new Set(prev);
      if (want) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  useEffect(() => {
    fitByPathRef.current.clear();
    setFitNativeZoom(null);
    setSyncViewport({ scale: 0, x: 0, y: 0 });
  }, [pathsKey, setFitNativeZoom, setSyncViewport]);

  // rawUnlocked / wantRawPaths 只保留仍在当前 paths 里的项
  useEffect(() => {
    const alive = new Set(paths);
    setRawUnlocked((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (alive.has(p)) next.add(p);
        else changed = true;
      }
      return changed || next.size !== prev.size ? next : prev;
    });
    setWantRawPaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (alive.has(p)) next.add(p);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [paths]);

  // 单点 resize：按已上报的 natural 无法重算格子尺寸，触发子 pane 靠 window 不够；
  // 子级仍各自 measure；此处仅保证窗口变化时再聚合一次（子级 window resize 已测）
  useEffect(() => {
    const onResize = () => applyMinFit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyMinFit]);

  const nativeZoom =
    syncViewport.scale > 0 ? syncViewport.scale : (fitNativeZoom ?? 0);

  useEffect(() => {
    if (nativeZoom < RAW_NATIVE_ZOOM) return;
    setRawUnlocked((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const p of paths) {
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [nativeZoom, paths]);

  useEffect(() => {
    // 仅「仍想看 RAW」的格子进优先级（切 JPG 的不占队）
    // 注意：依赖变化时直接用新列表覆盖，勿在 cleanup 里先 []——
    // 否则中间会把仍需要的第二张从队列踢掉，且 useCr3Preview 不会自动重试。
    const needRaw = paths.filter((p) => wantRawPaths.has(p));
    setRawPreviewPriority(needRaw);
  }, [paths, wantRawKey, wantRawPaths]);

  // 整页卸载时才清空 RAW 优先级
  useEffect(() => {
    return () => setRawPreviewPriority([]);
  }, []);

  const viewRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef(syncViewport);
  const fitZoomRef = useRef(fitNativeZoom);
  viewportRef.current = syncViewport;
  fitZoomRef.current = fitNativeZoom;

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;

    const resolveBase = (scale: number) => {
      if (scale > 0) return scale;
      const fit = fitZoomRef.current;
      return fit && fit > 0 ? fit : 0;
    };

    const anchorOffset = (
      clientX: number,
      clientY: number,
      target: EventTarget | null,
    ) => {
      const anchorEl =
        (target as HTMLElement | null)?.closest?.(".compare-pane-viewport") ??
        el;
      const rect = anchorEl.getBoundingClientRect();
      return {
        ox: clientX - (rect.left + rect.width / 2),
        oy: clientY - (rect.top + rect.height / 2),
      };
    };

    // Safari/WKWebView 捏合走 GestureEvent；若同时冒出 ctrl+wheel，用此标记避免双倍缩放
    let pinching = false;
    /** gestureend 后短暂屏蔽 ctrl+wheel，避免 WKWebView 合成残留再跳一档 */
    let wheelZoomCooldownUntil = 0;
    let cooldownTimer = 0;
    const PINCH_WHEEL_COOLDOWN_MS = 120;
    const pinch = {
      startScale: 0,
      startX: 0,
      startY: 0,
      ox: 0,
      oy: 0,
    };

    const pointInView = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    };

    const eventInView = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      return el === target || el.contains(target);
    };

    const endPinch = () => {
      if (!pinching) return;
      pinching = false;
      pinch.startScale = 0;
      wheelZoomCooldownUntil = performance.now() + PINCH_WHEEL_COOLDOWN_MS;
      window.clearTimeout(cooldownTimer);
      cooldownTimer = window.setTimeout(() => {
        wheelZoomCooldownUntil = 0;
      }, PINCH_WHEEL_COOLDOWN_MS);
    };

    const onWheel = (e: WheelEvent) => {
      if (!eventInView(e.target) && !pointInView(e.clientX, e.clientY)) return;
      e.preventDefault();

      const zoomBlocked =
        pinching || performance.now() < wheelZoomCooldownUntil;

      // Chrome 捏合 / Ctrl·Cmd+滚轮（Safari 触控板捏合优先走 gesture*）
      if (e.ctrlKey || e.metaKey) {
        if (zoomBlocked) return;
        const clamped = Math.max(-10, Math.min(10, e.deltaY));
        const factor = Math.pow(2, -clamped * 0.01);
        const { ox, oy } = anchorOffset(e.clientX, e.clientY, e.target);
        setSyncViewport((v) => {
          const base = resolveBase(v.scale);
          if (!(base > 0)) return v;
          const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, base * factor));
          const ratio = next / base;
          return {
            scale: next,
            x: ox - (ox - v.x) * ratio,
            y: oy - (oy - v.y) * ratio,
          };
        });
        return;
      }

      // fit 未就绪时不平移，避免图片出现后偏移
      if (!(resolveBase(viewportRef.current.scale) > 0)) return;

      setSyncViewport((v) => ({
        ...v,
        x: v.x - e.deltaX,
        y: v.y - e.deltaY,
      }));
    };

    // 挂 window：WKWebView 上 GestureEvent 挂元素时常收不到（Tauri 惯例）
    const onGestureStart = (e: Event) => {
      const ge = e as UIEvent & { clientX: number; clientY: number };
      // WKWebView 上 target 常为 document，不能只靠 contains
      if (!eventInView(e.target) && !pointInView(ge.clientX, ge.clientY)) {
        return;
      }
      // 始终挡住 WebView 整页捏合；fit 未就绪则不进 pinching（不挡 Ctrl/Cmd+滚轮）
      e.preventDefault();
      const v = viewportRef.current;
      const base = resolveBase(v.scale);
      if (!(base > 0)) {
        pinch.startScale = 0;
        return;
      }
      pinching = true;
      const { ox, oy } = anchorOffset(ge.clientX, ge.clientY, e.target);
      pinch.startScale = base;
      pinch.startX = v.x;
      pinch.startY = v.y;
      pinch.ox = ox;
      pinch.oy = oy;
    };

    const onGestureChange = (e: Event) => {
      if (!pinching) return;
      e.preventDefault();
      const ge = e as UIEvent & { scale: number };
      if (!(pinch.startScale > 0) || !(ge.scale > 0)) return;
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinch.startScale * ge.scale),
      );
      const ratio = next / pinch.startScale;
      setSyncViewport({
        scale: next,
        x: pinch.ox - (pinch.ox - pinch.startX) * ratio,
        y: pinch.oy - (pinch.oy - pinch.startY) * ratio,
      });
    };

    const onGestureEnd = (e: Event) => {
      if (!pinching) return;
      e.preventDefault();
      endPinch();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("gesturestart", onGestureStart, {
      passive: false,
    });
    window.addEventListener("gesturechange", onGestureChange, {
      passive: false,
    });
    window.addEventListener("gestureend", onGestureEnd, { passive: false });
    window.addEventListener("gesturecancel", onGestureEnd, { passive: false });
    return () => {
      window.clearTimeout(cooldownTimer);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("gesturestart", onGestureStart);
      window.removeEventListener("gesturechange", onGestureChange);
      window.removeEventListener("gestureend", onGestureEnd);
      window.removeEventListener("gesturecancel", onGestureEnd);
    };
  }, [setSyncViewport, pathsKey]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
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
      if (!(syncViewport.scale > 0 || (fitNativeZoom ?? 0) > 0)) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      const { vx, vy } = dragRef.current;
      setSyncViewport((v) => ({
        ...v,
        x: vx + dx,
        y: vy + dy,
      }));
    },
    [setSyncViewport, syncViewport.scale, fitNativeZoom],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onPointerCancel = useCallback(() => {
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
    paths.length <= 1 ? 1 : paths.length <= 4 ? 2 : paths.length <= 9 ? 3 : 4;

  return (
    <div
      ref={viewRef}
      className="compare-view"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={resetSyncViewport}
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
      }}
    >
      {paths.map((path) => (
        <ComparePane
          key={path}
          path={path}
          orientation={orientationByPath.get(path) ?? null}
          onToggleKeep={toggleKeep}
          allowKeep={isFormalCompare}
          useRaw={rawUnlocked.has(path) && nativeZoom >= RAW_NATIVE_ZOOM}
          onReportFit={onReportFit}
          onReportWantRaw={onReportWantRaw}
        />
      ))}
    </div>
  );
}
