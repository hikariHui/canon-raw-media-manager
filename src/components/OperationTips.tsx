import { useState, useEffect } from "react";
import { MdWarning } from "react-icons/md";
import { useAppMode } from "../context/ModeContext";
import { useAppContext } from "../context/AppContext";
import { usePhotoContext } from "../photo/PhotoContext";
import {
  readShortcutFocusGate,
  type ShortcutFocusGate,
} from "../utils/shortcutFocusGate";
import "./OperationTips.css";

function TipTag({
  active,
  title,
  children,
}: {
  active: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={active ? "tip-tag" : "tip-tag tip-tag-disabled"}
      aria-disabled={!active}
      title={active ? undefined : title}
    >
      {children}
    </span>
  );
}

function useShortcutFocusGate() {
  const [gate, setGate] = useState<ShortcutFocusGate>(readShortcutFocusGate);

  useEffect(() => {
    let raf = 0;
    const sync = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setGate((prev) => {
          const next = readShortcutFocusGate();
          if (
            prev.dialog === next.dialog &&
            prev.typing === next.typing &&
            prev.nonThumbButton === next.nonThumbButton
          ) {
            return prev;
          }
          return next;
        });
      });
    };
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    const mo = new MutationObserver(sync);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-modal", "class", "style", "hidden"],
    });
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return gate;
}

export default function OperationTips() {
  const { mode } = useAppMode();
  const { curCrmFile, curProxyFileUrl } = useAppContext();
  const { selectedPaths, keepPaths, comparePaths, photos } = usePhotoContext();
  const [isFocused, setIsFocused] = useState(document.hasFocus());
  const gate = useShortcutFocusGate();

  useEffect(() => {
    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const photoBlocked = gate.dialog || gate.typing;
  const photoNavOk = !photoBlocked && !gate.nonThumbButton && photos.length > 0;
  const photoEnterOk =
    !photoBlocked &&
    !gate.nonThumbButton &&
    (keepPaths.size > 0 || selectedPaths.size === 1);
  const photoDeleteOk = !photoBlocked && selectedPaths.size > 0;
  const photoEscOk =
    !photoBlocked &&
    (selectedPaths.size > 0 || comparePaths.length > 0 || keepPaths.size > 0);

  const navOffReason = gate.dialog
    ? "弹窗打开时不可用"
    : gate.typing
      ? "输入中不可用"
      : gate.nonThumbButton
        ? "焦点在按钮上时不可用"
        : "暂无照片";
  const blockedReason = gate.dialog ? "弹窗打开时不可用" : "输入中不可用";

  const videoDeleteOk = !gate.dialog && !gate.typing && !!curCrmFile;
  const videoEnterOk =
    !gate.dialog && !gate.typing && !gate.nonThumbButton && !!curCrmFile;
  const videoSeekOk = !gate.dialog && !gate.typing && !!curProxyFileUrl;
  const photoInteractOk = !photoBlocked && photos.length > 0;
  const photoDblOk = photoInteractOk;
  const photoZoomOk = photoInteractOk;
  const photoKeepClickOk = !photoBlocked && comparePaths.length > 0;

  if (!isFocused) {
    return (
      <div className="focus-alert">
        <MdWarning className="alert-icon" />
        <span>应用未聚焦，快捷键不可用</span>
      </div>
    );
  }

  if (mode === "photo") {
    return (
      <div className="tips-content tips-content-dense">
        <span className="tips-label">快捷键</span>
        <div className="tips-tags">
          <TipTag active={photoNavOk} title={navOffReason}>
            <kbd>←</kbd>
            <kbd>→</kbd> 切张
          </TipTag>
          <TipTag active={photoNavOk} title={navOffReason}>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 切组
          </TipTag>
          <TipTag
            active={photoDeleteOk}
            title={photoBlocked ? blockedReason : "先多选左侧缩略图"}
          >
            <kbd>⇧</kbd>/<kbd>⌘</kbd>多选 · <kbd>⌫</kbd> 删除
          </TipTag>
          <TipTag
            active={photoDblOk}
            title={photoBlocked ? blockedReason : "暂无照片"}
          >
            <kbd>双击</kbd> 对比
          </TipTag>
          <TipTag
            active={photoKeepClickOk}
            title={
              photoBlocked
                ? blockedReason
                : "需先进入正式对比（双击加入对比区）"
            }
          >
            对比区点选保留
          </TipTag>
          <TipTag
            active={photoZoomOk}
            title={photoBlocked ? blockedReason : "暂无照片"}
          >
            滚轮缩放 · 拖移
          </TipTag>
          <TipTag
            active={photoEscOk}
            title={photoBlocked ? blockedReason : "当前无勾选/对比"}
          >
            <kbd>Esc</kbd> 清除
          </TipTag>
          <TipTag
            active={photoEnterOk}
            title={
              gate.dialog
                ? "弹窗打开时不可用"
                : gate.typing
                  ? "输入中不可用"
                  : gate.nonThumbButton
                    ? "焦点在按钮上时不可用"
                    : "需对比区勾选保留，或左侧单选"
            }
          >
            <kbd>Enter</kbd> starred
          </TipTag>
        </div>
      </div>
    );
  }

  return (
    <div className="tips-content">
      <span className="tips-label">快捷键</span>
      <div className="tips-tags">
        <TipTag
          active={videoSeekOk}
          title={
            gate.dialog
              ? "弹窗打开时不可用"
              : gate.typing
                ? "输入中不可用"
                : "无可用预览"
          }
        >
          <kbd>空格</kbd> 播放/暂停
        </TipTag>
        <TipTag
          active={videoSeekOk}
          title={
            gate.dialog
              ? "弹窗打开时不可用"
              : gate.typing
                ? "输入中不可用"
                : "无可用预览"
          }
        >
          <kbd>←</kbd> 后退 5s
        </TipTag>
        <TipTag
          active={videoSeekOk}
          title={
            gate.dialog
              ? "弹窗打开时不可用"
              : gate.typing
                ? "输入中不可用"
                : "无可用预览"
          }
        >
          <kbd>→</kbd> 快进 5s
        </TipTag>
        <TipTag
          active={videoDeleteOk}
          title={
            gate.dialog
              ? "弹窗打开时不可用"
              : gate.typing
                ? "输入中不可用"
                : "未选中文件"
          }
        >
          <kbd>⌫</kbd> 删除
        </TipTag>
        <TipTag
          active={videoEnterOk}
          title={
            gate.dialog
              ? "弹窗打开时不可用"
              : gate.typing
                ? "输入中不可用"
                : gate.nonThumbButton
                  ? "焦点在按钮上时不可用"
                  : "未选中文件"
          }
        >
          <kbd>Enter</kbd> 星标
        </TipTag>
      </div>
    </div>
  );
}
