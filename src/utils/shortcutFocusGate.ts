import { isAppDialogOpen } from "./isAppDialogOpen";

/** 与全局 keydown 拦截对齐的焦点/弹窗门控（不含 e.repeat，瞬时态不反映到提示栏） */
export type ShortcutFocusGate = {
  dialog: boolean;
  typing: boolean;
  /** 非 .photo-thumb 的 BUTTON：照片模式拦方向键/Enter */
  nonThumbButton: boolean;
};

export function readShortcutFocusGate(): ShortcutFocusGate {
  const dialog = isAppDialogOpen();
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) {
    return { dialog, typing: false, nonThumbButton: false };
  }
  const tag = el.tagName;
  const typing =
    tag === "INPUT" || tag === "TEXTAREA" || !!el.isContentEditable;
  const nonThumbButton = tag === "BUTTON" && !el.closest(".photo-thumb");
  return { dialog, typing, nonThumbButton };
}
