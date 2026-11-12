import { useCallback, useEffect, useRef } from "react";
import { Button, notificationOpen } from "animal-island-ui";
import {
  MdDelete,
  MdStar,
  MdSelectAll,
  MdDeselect,
  MdZoomOutMap,
  MdCompare,
} from "react-icons/md";
import { isAppDialogOpen } from "../utils/isAppDialogOpen";
import { MAX_COMPARE, usePhotoContext } from "./PhotoContext";
import { deletePhotos, starPhotos, PartialMoveError } from "./useMovePhoto";
import "./PhotoToolbar.css";

const tipMoveFailed = (err: unknown) => {
  notificationOpen({
    type: "error",
    message: "操作未全部完成",
    description: err instanceof Error ? err.message : String(err),
    duration: 4,
    key: "photo-move-failed",
  });
};

export default function PhotoToolbar() {
  const {
    selectedPaths,
    clearSelection,
    selectPaths,
    selectAllInGroup,
    activeGroup,
    comparePaths,
    clearCompare,
    setComparePaths,
    updateComparePaths,
    keepPaths,
    clearKeep,
    toggleKeep,
    resetSyncViewport,
    refresh,
    navigatePhoto,
    navigateGroup,
  } = usePhotoContext();

  const movingRef = useRef(false);
  const selected = [...selectedPaths];
  const keepList = [...keepPaths];
  const multiSelect = selected.length > 1;
  const canKeep = keepList.length > 0 || selected.length === 1;
  const compareRejects = comparePaths.filter((p) => !keepPaths.has(p));
  const canDeleteCompareRejects =
    keepList.length > 0 && compareRejects.length > 0;

  const onKeep = useCallback(async () => {
    // 对比区勾选优先；否则保留左边当前单张（移到 starred）
    const fromKeep = keepList.length > 0;
    const targets = fromKeep ? keepList : selected.length === 1 ? selected : [];
    if (!targets.length || movingRef.current) return;
    movingRef.current = true;
    try {
      await starPhotos(targets);
      const gone = new Set(targets);
      updateComparePaths((prev) => prev.filter((p) => !gone.has(p)));
      clearKeep();
      clearSelection();
    } catch (e) {
      tipMoveFailed(e);
      if (e instanceof PartialMoveError) {
        const failed = new Set(e.failed);
        updateComparePaths((prev) =>
          prev.filter((p) => !targets.includes(p) || failed.has(p)),
        );
        if (fromKeep) {
          clearKeep();
          for (const p of e.failed) toggleKeep(p);
        } else {
          selectPaths(e.failed);
        }
      }
    } finally {
      movingRef.current = false;
      refresh();
    }
  }, [
    keepList,
    selected,
    updateComparePaths,
    clearKeep,
    clearSelection,
    selectPaths,
    toggleKeep,
    refresh,
  ]);

  const onDelete = useCallback(async () => {
    if (!selected.length || movingRef.current) return;
    movingRef.current = true;
    try {
      await deletePhotos(selected);
      const gone = new Set(selected);
      updateComparePaths((prev) => prev.filter((p) => !gone.has(p)));
      clearSelection();
    } catch (e) {
      tipMoveFailed(e);
      // 部分失败：只保留失败项；其它意外错误保留原选中便于重试
      if (e instanceof PartialMoveError) {
        const failed = new Set(e.failed);
        updateComparePaths((prev) =>
          prev.filter((p) => !selected.includes(p) || failed.has(p)),
        );
        selectPaths(e.failed);
      }
    } finally {
      movingRef.current = false;
      refresh();
    }
  }, [selected, updateComparePaths, clearSelection, selectPaths, refresh]);

  /** 删除对比区未勾选的图；勾选的留在原位，不进 starred */
  const onDeleteCompareRejects = useCallback(async () => {
    if (!canDeleteCompareRejects || movingRef.current) return;
    const toDelete = comparePaths.filter((p) => !keepPaths.has(p));
    if (!toDelete.length) return;
    movingRef.current = true;
    try {
      await deletePhotos(toDelete);
      // 对比区只留下勾选要留的；保留 keep，便于立刻 Enter /「移到 starred」
      setComparePaths(keepList);
    } catch (e) {
      tipMoveFailed(e);
      if (e instanceof PartialMoveError) {
        const failed = new Set(e.failed);
        setComparePaths([
          ...keepList,
          ...toDelete.filter((p) => failed.has(p)),
        ]);
      }
    } finally {
      movingRef.current = false;
      refresh();
    }
  }, [
    canDeleteCompareRejects,
    comparePaths,
    keepPaths,
    keepList,
    setComparePaths,
    refresh,
  ]);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) {
        return;
      }
      // LazyThumb 也是 <button>：点选后焦点常在缩略图上，全局 ←→/Enter 仍须可用。
      // 其它 BUTTON（工具栏 / Header 等）：Enter/空格/方向键走原生，勿抢全局导航。
      if (tag === "BUTTON" && el) {
        const isThumb = !!el.closest(".photo-thumb");
        if (isThumb && e.key === " ") {
          e.preventDefault();
          return;
        }
        if (
          !isThumb &&
          (e.key === "Enter" ||
            e.key === " " ||
            e.key === "ArrowLeft" ||
            e.key === "ArrowRight" ||
            e.key === "ArrowUp" ||
            e.key === "ArrowDown")
        ) {
          return;
        }
      }
      if (isAppDialogOpen()) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigatePhoto(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigatePhoto(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateGroup(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateGroup(1);
      } else if (e.key === "Escape") {
        if (selectedPaths.size || comparePaths.length || keepPaths.size) {
          e.preventDefault();
          clearSelection();
          clearKeep();
          clearCompare();
        }
      } else if (
        e.key === "Enter" &&
        (keepPaths.size > 0 || selectedPaths.size === 1)
      ) {
        e.preventDefault();
        await onKeep();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedPaths.size
      ) {
        e.preventDefault();
        await onDelete();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "a" &&
        activeGroup
      ) {
        e.preventDefault();
        selectAllInGroup();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    selectedPaths,
    comparePaths.length,
    keepPaths,
    clearSelection,
    clearKeep,
    clearCompare,
    onKeep,
    onDelete,
    activeGroup,
    selectAllInGroup,
    navigatePhoto,
    navigateGroup,
  ]);

  return (
    <div className="photo-toolbar">
      <div className="photo-toolbar-info">
        左侧选中 <strong>{selected.length}</strong>
        {multiSelect && (
          <span className="photo-toolbar-compare">（可批量删除）</span>
        )}
        <span className="photo-toolbar-compare">
          · 对比区勾选保留 <strong>{keepList.length}</strong>
        </span>
        <span className="photo-toolbar-compare">
          · 对比中 {comparePaths.length}/{MAX_COMPARE}
          {comparePaths.length >= MAX_COMPARE ? "（已满）" : ""}
        </span>
      </div>
      <div className="photo-toolbar-actions">
        <Button size="small" onClick={selectAllInGroup} disabled={!activeGroup}>
          <MdSelectAll style={{ marginRight: 4 }} />
          全选组
        </Button>
        <Button
          size="small"
          onClick={() => {
            clearSelection();
            clearKeep();
          }}
          disabled={!selected.length && !keepList.length}
        >
          <MdDeselect style={{ marginRight: 4 }} />
          清除勾选
        </Button>
        <Button
          size="small"
          onClick={() => setComparePaths(selected)}
          disabled={!selected.length}
          title="用左侧选中重建对比区"
        >
          <MdCompare style={{ marginRight: 4 }} />
          左侧设为对比
        </Button>
        <Button
          size="small"
          onClick={clearCompare}
          disabled={!comparePaths.length}
        >
          清除对比
        </Button>
        <Button size="small" onClick={resetSyncViewport}>
          <MdZoomOutMap style={{ marginRight: 4 }} />
          重置缩放
        </Button>
        <Button
          size="small"
          className="btn-danger"
          onClick={onDeleteCompareRejects}
          disabled={!canDeleteCompareRejects}
          title="删除对比区里未勾选的照片；已勾选的留在原文件夹，不会移到 starred"
        >
          <MdDelete style={{ marginRight: 4 }} />
          删除对比未选
          {canDeleteCompareRejects ? ` (${compareRejects.length})` : ""}
        </Button>
        <Button
          type="primary"
          size="small"
          onClick={onKeep}
          disabled={!canKeep}
          title={
            keepList.length
              ? "把对比区勾选的照片移到 starred"
              : "把当前左侧单张移到 starred"
          }
        >
          <MdStar style={{ marginRight: 4 }} />
          {keepList.length > 0
            ? `移到 starred (${keepList.length})`
            : "移到 starred"}
        </Button>
        <Button
          size="small"
          className="btn-danger"
          onClick={onDelete}
          disabled={!selected.length}
          title="删除的是左侧列表里选中的照片，不是对比区勾选"
        >
          <MdDelete style={{ marginRight: 4 }} />
          删除左侧选中
        </Button>
      </div>
    </div>
  );
}
