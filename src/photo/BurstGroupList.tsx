import { useEffect, useRef } from "react";
import { Tag } from "animal-island-ui";
import { MdBurstMode, MdPhoto } from "react-icons/md";
import { usePhotoContext } from "./PhotoContext";
import LazyThumb from "./LazyThumb";
import "./BurstGroupList.css";

export default function BurstGroupList() {
  const {
    groups,
    loading,
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
    if (!scrollRef.current) return;
    // 跟随锚点/当前选中滚动，与预览一致
    if (path === lastScrolledPath.current) return;
    lastScrolledPath.current = path;

    const container = scrollRef.current;
    const nodes = container.querySelectorAll<HTMLElement>("[data-photo-path]");
    const el = [...nodes].find((n) => n.dataset.photoPath === path);
    if (!el) return;

    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const pad = 8;
    if (eRect.top < cRect.top + pad) {
      container.scrollTop -= cRect.top + pad - eRect.top;
    } else if (eRect.bottom > cRect.bottom - pad) {
      container.scrollTop += eRect.bottom - (cRect.bottom - pad);
    }
  }, [selectedPaths, selectionAnchor]);

  if (loading && !groups.length) {
    return <div className="burst-list-empty">正在扫描 CR3…</div>;
  }

  if (!groups.length) {
    return <div className="burst-list-empty">目录中没有 CR3 文件</div>;
  }

  return (
    <div className="burst-list">
      <div className="burst-list-header">
        <span>连拍组</span>
        <span className="burst-list-count">{groups.length} 组</span>
      </div>
      <div className="burst-list-scroll" ref={scrollRef}>
        {groups.map((group) => {
          const isActive = group.id === activeGroupId;
          const isBurst = group.photos.length > 1;
          return (
            <div
              key={group.id}
              className={`burst-group ${isActive ? "is-active" : ""}`}
              onClick={() => {
                // 切组同时聚焦组内第一张，避免高亮组与预览/选中脱节
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
                      selected={selectedPaths.has(photo.path)}
                      comparing={comparePaths.includes(photo.path)}
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
                        // 加入对比时只选中当前这张，避免累加多选误删
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
  );
}
