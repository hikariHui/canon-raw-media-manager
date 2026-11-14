import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Tag } from "animal-island-ui";
import { MdBurstMode, MdPhoto } from "react-icons/md";
import { usePhotoContext } from "./PhotoContext";
import type { PhotoMeta } from "./groupBursts";
import { orientationSwapsAxes } from "./orientationCss";
import LazyThumb from "./LazyThumb";
import "./BurstGroupList.css";

const THUMB_SLOT = 70; // 横拍长边 64 + gap；竖拍宽 43 更省
const ROW_H_LANDSCAPE = 49; // 43 + gap 6
const ROW_H_PORTRAIT = 70; // 64 + gap 6

/** 估算单组高度：有竖图按高行估，纯横图用矮行减少滚动跳动 */
function estimateGroupHeight(photos: PhotoMeta[] | undefined, cols: number) {
  const list = photos ?? [];
  const c = Math.max(1, cols);
  const rows = Math.max(1, Math.ceil(Math.max(list.length, 1) / c));
  const hasPortrait = list.some((p) => orientationSwapsAxes(p.orientation));
  const rowH = hasPortrait ? ROW_H_PORTRAIT : ROW_H_LANDSCAPE;
  // 头 + padding(10*2) + 行高 + margin-bottom: 10
  return 44 + 20 + rows * rowH + 10;
}

export default function BurstGroupList() {
  const {
    groups,
    loading,
    enriching,
    activeGroupId,
    setActiveGroupId,
    selectedPaths,
    selectionAnchor,
    toggleSelect,
    selectOnly,
    selectRangeTo,
    comparePaths,
    toggleCompare,
  } = usePhotoContext();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledPath = useRef<string | null>(null);
  const [thumbCols, setThumbCols] = useState(4);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth - 20;
      setThumbCols(Math.max(1, Math.floor(w / THUMB_SLOT)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [groups.length]);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimateGroupHeight(groups[i]?.photos, thumbCols),
    overscan: 6,
  });

  // 列数 / enrich 合并后组结构变化时重测虚拟高度
  const structureKey = useMemo(
    () =>
      `${thumbCols}|${enriching ? 1 : 0}|` +
      groups.map((g) => `${g.id}:${g.photos.length}`).join("|"),
    [groups, enriching, thumbCols],
  );

  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: structureKey 已覆盖
  }, [structureKey]);

  const pathToGroupIndex = useMemo(() => {
    const map = new Map<string, number>();
    groups.forEach((g, i) => {
      for (const p of g.photos) map.set(p.path, i);
    });
    return map;
  }, [groups]);

  // enrich 结束后组 id/顺序突变，强制再对齐选中项
  useEffect(() => {
    if (!enriching) lastScrolledPath.current = null;
  }, [enriching]);

  useEffect(() => {
    const path =
      (selectionAnchor && selectedPaths.has(selectionAnchor)
        ? selectionAnchor
        : null) ??
      [...selectedPaths][0] ??
      null;
    if (!path) {
      lastScrolledPath.current = null;
      return;
    }
    if (path === lastScrolledPath.current) return;
    lastScrolledPath.current = path;

    const idx = pathToGroupIndex.get(path);
    if (idx == null) return;
    virtualizer.scrollToIndex(idx, { align: "auto" });

    // 组滚入后再微调缩略图位置
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const el = [
        ...container.querySelectorAll<HTMLElement>("[data-photo-path]"),
      ].find((n) => n.dataset.photoPath === path);
      if (!el) return;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const pad = 8;
      if (eRect.top < cRect.top + pad) {
        container.scrollTop -= cRect.top + pad - eRect.top;
      } else if (eRect.bottom > cRect.bottom - pad) {
        container.scrollTop += eRect.bottom - (cRect.bottom - pad);
      }
    });
  }, [
    selectedPaths,
    selectionAnchor,
    pathToGroupIndex,
    virtualizer,
    enriching,
  ]);

  if (loading && !groups.length) {
    return <div className="burst-list-empty">正在扫描 CR3…</div>;
  }

  if (!groups.length) {
    return <div className="burst-list-empty">目录中没有 CR3 文件</div>;
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div className="burst-list">
      <div className="burst-list-header">
        <span>连拍组</span>
        <span className="burst-list-count">
          {groups.length} 组{enriching ? " · 解析中…" : ""}
          {loading ? " · 刷新中…" : ""}
        </span>
      </div>
      <div className="burst-list-scroll" ref={scrollRef}>
        <div
          className="burst-list-virtual"
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {items.map((vi) => {
            const group = groups[vi.index];
            if (!group) return null;
            const isActive = group.id === activeGroupId;
            const isBurst = group.photos.length > 1;
            return (
              <div
                key={group.id}
                className={`burst-group ${isActive ? "is-active" : ""}`}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
                onClick={() => {
                  setActiveGroupId(group.id);
                  const first = group.photos[0];
                  if (first) selectOnly(first.path);
                }}
              >
                <div className="burst-group-head">
                  {isBurst ? (
                    <MdBurstMode className="burst-group-icon" />
                  ) : (
                    <MdPhoto className="burst-group-icon" />
                  )}
                  <span className="burst-group-title">
                    {isBurst ? `连拍 ${group.photos.length} 张` : "单张"}
                  </span>
                  <Tag size="small" color={isBurst ? "app-green" : "default"}>
                    {group.photos.length}
                  </Tag>
                </div>
                <div className="burst-group-thumbs">
                  {group.photos.map((photo) => (
                    <span key={photo.path} data-photo-path={photo.path}>
                      <LazyThumb
                        path={photo.path}
                        alt={photo.file_name}
                        orientation={photo.orientation}
                        selected={selectedPaths.has(photo.path)}
                        comparing={comparePaths.includes(photo.path)}
                        preferHeavy={
                          selectedPaths.has(photo.path) ||
                          comparePaths.includes(photo.path)
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveGroupId(group.id);
                          if (e.metaKey || e.ctrlKey) {
                            toggleSelect(photo.path);
                          } else if (e.shiftKey) {
                            selectRangeTo(photo.path);
                          } else {
                            selectOnly(photo.path);
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setActiveGroupId(group.id);
                          selectOnly(photo.path);
                          toggleCompare(photo.path);
                        }}
                      />
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
