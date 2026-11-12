/**
 * 设置/导出/同步等 Modal 打开时，全局快捷键应让路。
 * 依赖 animal-island-ui Modal 自带的 role="dialog" / aria-modal="true"。
 * 搁置：Tauri 原生目录选择框不在 DOM，选目录期间仍可能触发快捷键；
 * 若需覆盖，在 open() 前后加 pickingDir 全局锁。
 */
export function isAppDialogOpen() {
  return !!document.querySelector('[role="dialog"], [aria-modal="true"]');
}
