import { message } from "@tauri-apps/plugin-dialog";
import { store, ALLOWED_MANAGED_DIRS_KEY } from "./store";

/** 去掉末尾多余分隔符，便于前缀比较 */
export function normalizeDirPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  // Windows 盘符根路径保留尾部反斜杠，例如 C:\
  if (/^[a-zA-Z]:[/\\]?$/.test(trimmed)) {
    return trimmed.replace(/\//g, "\\").replace(/\\?$/, "\\");
  }
  return trimmed.replace(/[/\\]+$/, "") || "/";
}

function pathForCompare(path: string): string {
  return normalizeDirPath(path).toLowerCase().replace(/\\/g, "/");
}

/**
 * 判断 path 是否位于某个允许根目录之下（含根目录本身）。
 * allowed 为空时一律不允许。
 */
export function isPathUnderAllowedDirs(
  path: string,
  allowed: string[],
): boolean {
  if (!path || allowed.length === 0) return false;
  const target = pathForCompare(path);
  if (!target) return false;
  return allowed.some((root) => {
    const r = pathForCompare(root);
    if (!r) return false;
    return target === r || target.startsWith(`${r}/`);
  });
}

export async function loadAllowedManagedDirs(): Promise<string[]> {
  const saved = await store.get<string[]>(ALLOWED_MANAGED_DIRS_KEY);
  return Array.isArray(saved) ? saved : [];
}

/**
 * 校验目录是否在白名单内；失败时弹出提示并返回 false。
 * silent=true 时不弹窗（用于自动搜索 Proxy）。
 */
export async function ensureAllowedManagedDir(
  path: string,
  kind: "Raw" | "Proxy",
  options?: { silent?: boolean },
): Promise<boolean> {
  const allowed = await loadAllowedManagedDirs();
  if (isPathUnderAllowedDirs(path, allowed)) return true;

  if (!options?.silent) {
    if (allowed.length === 0) {
      await message(
        `尚未配置允许管理的文件目录，无法选择 ${kind} 目录。\n\n请先在菜单「设置…」中添加备份盘根目录。`,
        { title: "请先配置允许目录", kind: "warning" },
      );
    } else {
      await message(
        `${kind} 目录不在允许管理的文件目录内，请确认没有选到其它备份盘。\n\n已选：\n${path}\n\n当前允许的根目录：\n${allowed.map((p) => `· ${p}`).join("\n")}\n\n可在菜单「设置…」中添加对应根目录。`,
        { title: "目录未授权", kind: "warning" },
      );
    }
  }
  return false;
}
