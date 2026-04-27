import { useState, useEffect } from "react";
import {
  MdPlayArrow,
  MdArrowBack,
  MdArrowForward,
  MdDelete,
  MdStar,
  MdWarning,
} from "react-icons/md";
import "./OperationTips.css";

export default function OperationTips() {
  const [isFocused, setIsFocused] = useState(document.hasFocus());

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

  if (!isFocused) {
    return (
      <div className="focus-alert">
        <MdWarning className="alert-icon" />
        <span>应用未聚焦，快捷键不可用</span>
      </div>
    );
  }

  return (
    <div className="tips-content">
      <span className="tips-label">快捷键：</span>
      <div className="tips-tags">
        <span className="tip-tag">
          <MdPlayArrow className="tip-icon" />
          <kbd>空格</kbd> 播放/暂停
        </span>
        <span className="tip-tag">
          <MdArrowBack className="tip-icon" />
          <kbd>←</kbd> 后退5秒
        </span>
        <span className="tip-tag">
          <MdArrowForward className="tip-icon" />
          <kbd>→</kbd> 快进5秒
        </span>
        <span className="tip-tag">
          <MdDelete className="tip-icon" />
          <kbd>Backspace</kbd> 删除
        </span>
        <span className="tip-tag">
          <MdStar className="tip-icon" />
          <kbd>Enter</kbd> 星标
        </span>
      </div>
    </div>
  );
}
