//! 自动搜索与 Raw 目录匹配的 Proxy 目录
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;
use walkdir::WalkDir;

const MAX_UP: usize = 2;
const FALLBACK_DEPTH: usize = 3;
const MAX_STEMS: usize = 64;

/// 自动搜索 Proxy 目录的取消状态
pub struct FindProxyManager {
    cancelled: Arc<AtomicBool>,
}

impl FindProxyManager {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindProxyResult {
    pub path: Option<String>,
    pub cancelled: bool,
}

/// 目录名是否以 yyyy.mm.dd 开头（兼容「2026.09.01 开学」）
fn is_date_folder_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.len() < 10 {
        return false;
    }
    bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[2].is_ascii_digit()
        && bytes[3].is_ascii_digit()
        && bytes[4] == b'.'
        && bytes[5].is_ascii_digit()
        && bytes[6].is_ascii_digit()
        && bytes[7] == b'.'
        && bytes[8].is_ascii_digit()
        && bytes[9].is_ascii_digit()
}

fn resolve_search_root(raw_dir: &Path) -> PathBuf {
    let mut cursor = raw_dir.to_path_buf();
    if cursor
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(is_date_folder_name)
    {
        return cursor;
    }

    let mut climbed = 0usize;
    while climbed < MAX_UP {
        let Some(parent) = cursor.parent() else {
            break;
        };
        if parent
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(is_date_folder_name)
        {
            return parent.to_path_buf();
        }
        cursor = parent.to_path_buf();
        climbed += 1;
    }
    cursor
}

fn collect_raw_stems(raw_dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(raw_dir) else {
        return vec![];
    };
    let mut stems = Vec::new();
    for entry in entries.flatten() {
        if stems.len() >= MAX_STEMS {
            break;
        }
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if ext != "crm" && ext != "mp4" {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            let stem_lower = stem.to_ascii_lowercase();
            // 跳过已是代理命名的文件，避免自匹配干扰
            if stem_lower.ends_with("_proxy") {
                continue;
            }
            stems.push(stem_lower);
        }
    }
    stems
}

/// 列出目录下文件名（小写），用于大小写不敏感匹配
fn list_file_names_lower(dir: &Path) -> Option<Vec<String>> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            names.push(name.to_ascii_lowercase());
        }
    }
    Some(names)
}

fn score_candidate(dir: &Path, stems: &[String], cancelled: &AtomicBool) -> Option<usize> {
    if cancelled.load(Ordering::Relaxed) {
        return None;
    }
    if !dir.is_dir() {
        return Some(0);
    }
    let Some(file_names) = list_file_names_lower(dir) else {
        return Some(0);
    };
    let mut score = 0usize;
    for stem in stems {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        // stems 已是小写；代理名统一按小写比较
        let proxy_name = format!("{}_proxy.mp4", stem);
        if file_names.iter().any(|n| n == &proxy_name) {
            score += 1;
        }
    }
    Some(score)
}

fn find_named_child(parent: &Path, name: &str) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case(name))
        {
            return Some(path);
        }
    }
    None
}

/// 收集容器目录下的候选 Proxy 目录：
/// - 所有直接子目录（常见为 REEL_*）
/// - 若容器自身直接含 `_proxy.mp4`，也纳入自身
fn collect_container_candidates(
    container: &Path,
    cancelled: &AtomicBool,
) -> Option<Vec<PathBuf>> {
    if cancelled.load(Ordering::Relaxed) {
        return None;
    }
    let mut candidates = Vec::new();
    let Ok(entries) = std::fs::read_dir(container) else {
        return Some(candidates);
    };
    let mut has_direct_proxy = false;
    for entry in entries.flatten() {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        let path = entry.path();
        if path.is_dir() {
            candidates.push(path);
        } else if path.is_file() {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if name.ends_with("_proxy.mp4") {
                has_direct_proxy = true;
            }
        }
    }
    if has_direct_proxy {
        candidates.push(container.to_path_buf());
    }
    Some(candidates)
}

fn is_reel_folder_name(name: &str) -> bool {
    name.len() >= 5 && name[..5].eq_ignore_ascii_case("reel_")
}

fn collect_fallback_candidates(search_root: &Path, cancelled: &AtomicBool) -> Option<Vec<PathBuf>> {
    let mut candidates = Vec::new();
    for entry in WalkDir::new(search_root)
        .max_depth(FALLBACK_DEPTH)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        let path = entry.path();
        if !path.is_dir() || path == search_root {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        // 目录名含 proxy，或为 REEL_*（如日期根下直接放代理卷）
        if name.contains("proxy") || is_reel_folder_name(&name) {
            candidates.push(path.to_path_buf());
        }
    }
    Some(candidates)
}

fn pick_best_candidate(
    candidates: &[PathBuf],
    stems: &[String],
    cancelled: &AtomicBool,
) -> Option<Option<PathBuf>> {
    // Outer Option: None = cancelled; Inner: best path
    let mut best: Option<(usize, PathBuf)> = None;
    for candidate in candidates {
        let Some(score) = score_candidate(candidate, stems, cancelled) else {
            return None;
        };
        if score == 0 {
            continue;
        }
        match &best {
            None => best = Some((score, candidate.clone())),
            Some((best_score, _)) if score > *best_score => {
                best = Some((score, candidate.clone()));
            }
            _ => {}
        }
    }
    Some(best.map(|(_, path)| path))
}

fn do_find_proxy_directory(raw_dir: &str, cancelled: &AtomicBool) -> FindProxyResult {
    if cancelled.load(Ordering::Relaxed) {
        return FindProxyResult {
            path: None,
            cancelled: true,
        };
    }

    let raw_path = Path::new(raw_dir);
    if !raw_path.is_dir() {
        return FindProxyResult {
            path: None,
            cancelled: false,
        };
    }

    let stems = collect_raw_stems(raw_path);
    if stems.is_empty() {
        return FindProxyResult {
            path: None,
            cancelled: cancelled.load(Ordering::Relaxed),
        };
    }

    let search_root = resolve_search_root(raw_path);

    // 主路径：XFVC 下各子目录（及 XFVC 自身若直接含 _proxy.mp4）
    if let Some(xfvc) = find_named_child(&search_root, "XFVC") {
        let Some(candidates) = collect_container_candidates(&xfvc, cancelled) else {
            return FindProxyResult {
                path: None,
                cancelled: true,
            };
        };
        match pick_best_candidate(&candidates, &stems, cancelled) {
            None => {
                return FindProxyResult {
                    path: None,
                    cancelled: true,
                };
            }
            Some(Some(path)) => {
                return FindProxyResult {
                    path: Some(path.display().to_string()),
                    cancelled: false,
                };
            }
            Some(None) => {}
        }
    }

    if cancelled.load(Ordering::Relaxed) {
        return FindProxyResult {
            path: None,
            cancelled: true,
        };
    }

    // 次路径：日期根下直接子目录（如 2026.09.21/REEL_0002，无 XFVC 包装）
    {
        let Some(candidates) = collect_container_candidates(&search_root, cancelled) else {
            return FindProxyResult {
                path: None,
                cancelled: true,
            };
        };
        match pick_best_candidate(&candidates, &stems, cancelled) {
            None => {
                return FindProxyResult {
                    path: None,
                    cancelled: true,
                };
            }
            Some(Some(path)) => {
                return FindProxyResult {
                    path: Some(path.display().to_string()),
                    cancelled: false,
                };
            }
            Some(None) => {}
        }
    }

    if cancelled.load(Ordering::Relaxed) {
        return FindProxyResult {
            path: None,
            cancelled: true,
        };
    }

    // 弱兜底：目录名含 proxy，或为 REEL_*
    let Some(fallback) = collect_fallback_candidates(&search_root, cancelled) else {
        return FindProxyResult {
            path: None,
            cancelled: true,
        };
    };
    match pick_best_candidate(&fallback, &stems, cancelled) {
        None => FindProxyResult {
            path: None,
            cancelled: true,
        },
        Some(Some(path)) => FindProxyResult {
            path: Some(path.display().to_string()),
            cancelled: false,
        },
        Some(None) => FindProxyResult {
            path: None,
            cancelled: cancelled.load(Ordering::Relaxed),
        },
    }
}

#[tauri::command]
pub async fn find_proxy_directory(
    manager: State<'_, FindProxyManager>,
    raw_dir: String,
) -> Result<FindProxyResult, String> {
    if raw_dir.is_empty() {
        return Err("路径不能为空".to_string());
    }

    manager.cancelled.store(false, Ordering::SeqCst);
    let cancelled = Arc::clone(&manager.cancelled);

    let result =
        tauri::async_runtime::spawn_blocking(move || do_find_proxy_directory(&raw_dir, &cancelled))
            .await
            .map_err(|e| format!("搜索任务失败: {}", e))?;

    Ok(result)
}

#[tauri::command]
pub fn cancel_find_proxy_directory(manager: State<FindProxyManager>) -> Result<(), String> {
    manager.cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_file(path: &Path, content: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn date_folder_prefix_match() {
        assert!(is_date_folder_name("2026.09.01"));
        assert!(is_date_folder_name("2026.09.01 开学"));
        assert!(!is_date_folder_name("开学 2026.09.01"));
        assert!(!is_date_folder_name("REEL_0001"));
    }

    #[test]
    fn finds_proxy_in_different_reel() {
        let root = std::env::temp_dir().join(format!(
            "find_proxy_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        write_file(root.join("CRM/REEL_0001/A001.CRM").as_path(), b"raw");
        write_file(
            root.join("XFVC/REEL_0002/A001_proxy.mp4").as_path(),
            b"proxy",
        );
        write_file(
            root.join("XFVC/REEL_0003/B001_proxy.mp4").as_path(),
            b"other",
        );

        let cancelled = AtomicBool::new(false);
        let raw = root.join("CRM/REEL_0001");
        let result = do_find_proxy_directory(raw.to_str().unwrap(), &cancelled);
        assert!(!result.cancelled);
        assert_eq!(
            result.path.as_deref(),
            Some(root.join("XFVC/REEL_0002").to_str().unwrap())
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn stops_at_custom_date_folder() {
        let root = std::env::temp_dir().join(format!(
            "find_proxy_date_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        let date = root.join("2026.09.01 开学");
        write_file(date.join("CRM/REEL_0001/A001.CRM").as_path(), b"raw");
        write_file(
            date.join("XFVC/REEL_0002/A001_proxy.mp4").as_path(),
            b"proxy",
        );
        // 日期目录外的干扰项不应被搜到作为唯一结果（搜索根应停在日期目录）
        write_file(
            root.join("XFVC/REEL_9999/A001_proxy.mp4").as_path(),
            b"noise",
        );

        let cancelled = AtomicBool::new(false);
        let raw = date.join("CRM/REEL_0001");
        let result = do_find_proxy_directory(raw.to_str().unwrap(), &cancelled);
        assert_eq!(
            result.path.as_deref(),
            Some(date.join("XFVC/REEL_0002").to_str().unwrap())
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finds_proxy_reel_directly_under_date() {
        // 用户场景：源在 日期/CRM/REEL_0001，代理在 日期/REEL_0002（无 XFVC）
        let root = std::env::temp_dir().join(format!(
            "find_proxy_date_reel_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        let date = root.join("2026.09.21");
        write_file(date.join("CRM/REEL_0001/A001.CRM").as_path(), b"raw");
        write_file(
            date.join("REEL_0002/A001_proxy.mp4").as_path(),
            b"proxy",
        );

        let cancelled = AtomicBool::new(false);
        let raw = date.join("CRM/REEL_0001");
        let result = do_find_proxy_directory(raw.to_str().unwrap(), &cancelled);
        assert!(!result.cancelled);
        assert_eq!(
            result.path.as_deref(),
            Some(date.join("REEL_0002").to_str().unwrap())
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn matches_mp4_source_to_proxy() {
        let root = std::env::temp_dir().join(format!(
            "find_proxy_mp4_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        write_file(root.join("CRM/REEL_0001/a.mp4").as_path(), b"raw");
        write_file(root.join("XFVC/REEL_0002/a_proxy.mp4").as_path(), b"proxy");

        let cancelled = AtomicBool::new(false);
        let raw = root.join("CRM/REEL_0001");
        let result = do_find_proxy_directory(raw.to_str().unwrap(), &cancelled);
        assert!(!result.cancelled);
        assert_eq!(
            result.path.as_deref(),
            Some(root.join("XFVC/REEL_0002").to_str().unwrap())
        );

        let _ = fs::remove_dir_all(&root);
    }
}
