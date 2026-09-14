//! 从佳能存储卡导出媒体文件到本地硬盘
use chrono::Local;
use fs2::available_space;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

const MEDIA_ROOTS: &[&str] = &["DCIM", "CRM", "XFVC"];
const MEDIA_EXTS: &[&str] = &["crm", "mp4", "cr3", "jpg", "jpeg", "hif", "heif"];
const COPY_BUFFER_SIZE: usize = 8 * 1024 * 1024;
const SPACE_MARGIN: u64 = 100 * 1024 * 1024;
const MTIME_TOLERANCE_SECS: u64 = 2;
const PROGRESS_EMIT_EVERY: u64 = 4 * 1024 * 1024;

pub struct ExportManager {
    cancelled: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

impl ExportManager {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFileInfo {
    pub relative_path: String,
    pub absolute_path: String,
    pub size: u64,
    pub mtime_secs: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardScanResult {
    pub card_path: String,
    pub files: Vec<MediaFileInfo>,
    pub total_bytes: u64,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceCheckItem {
    pub path: String,
    pub available: u64,
    pub required: u64,
    pub sufficient: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceCheckResult {
    pub items: Vec<SpaceCheckItem>,
    pub all_sufficient: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictItem {
    pub key: String,
    pub card_path: String,
    pub relative_path: String,
    pub export_path: String,
    pub dest_path: String,
    pub source_size: u64,
    pub dest_size: u64,
    pub source_mtime_secs: u64,
    pub dest_mtime_secs: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdenticalItem {
    pub key: String,
    pub card_path: String,
    pub relative_path: String,
    pub export_path: String,
    pub dest_path: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDetectResult {
    pub identical: Vec<IdenticalItem>,
    pub conflicts: Vec<ConflictItem>,
    pub date_folder: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgressEvent {
    pub card_path: String,
    pub export_path: String,
    pub file_name: String,
    pub relative_path: String,
    pub bytes_copied: u64,
    pub total_bytes: u64,
    pub files_done: u64,
    pub files_total: u64,
    pub card_bytes_copied: u64,
    pub card_total_bytes: u64,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResultItem {
    pub card_path: String,
    pub relative_path: String,
    pub export_path: String,
    pub dest_path: String,
    pub reason: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFinishedEvent {
    pub succeeded: Vec<ExportResultItem>,
    pub skipped_identical: Vec<ExportResultItem>,
    pub skipped_conflict: Vec<ExportResultItem>,
    pub failed: Vec<ExportResultItem>,
    pub cancelled: bool,
    pub date_folder: String,
}

fn is_media_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            MEDIA_EXTS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

fn mtime_secs(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn files_match(source_size: u64, source_mtime: u64, dest_size: u64, dest_mtime: u64) -> bool {
    if source_size != dest_size {
        return false;
    }
    source_mtime.abs_diff(dest_mtime) <= MTIME_TOLERANCE_SECS
}

fn conflict_key(export_path: &str, relative_path: &str) -> String {
    format!("{}::{}", export_path, relative_path)
}

fn today_date_folder() -> String {
    Local::now().format("%Y.%m.%d").to_string()
}

fn dest_path(export_root: &str, date_folder: &str, relative: &str) -> PathBuf {
    let mut p = PathBuf::from(export_root);
    p.push(date_folder);
    for part in relative.split(['/', '\\']) {
        if !part.is_empty() {
            p.push(part);
        }
    }
    p
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.2} MB", b / MB)
    } else if b >= KB {
        format!("{:.2} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

pub fn scan_card(card_path: &str) -> CardScanResult {
    let root = Path::new(card_path);
    if !root.exists() {
        return CardScanResult {
            card_path: card_path.to_string(),
            files: vec![],
            total_bytes: 0,
            error: Some(format!("路径不存在: {}", card_path)),
        };
    }

    let mut files = Vec::new();
    let mut total_bytes = 0u64;

    for folder in MEDIA_ROOTS {
        let dir = root.join(folder);
        if !dir.is_dir() {
            continue;
        }
        for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() || !is_media_file(path) {
                continue;
            }
            let meta = match fs::metadata(path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let relative = match path.strip_prefix(root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            let size = meta.len();
            total_bytes += size;
            files.push(MediaFileInfo {
                relative_path: relative,
                absolute_path: path.to_string_lossy().to_string(),
                size,
                mtime_secs: mtime_secs(&meta),
            });
        }
    }

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    CardScanResult {
        card_path: card_path.to_string(),
        files,
        total_bytes,
        error: None,
    }
}

/// 估算单个导出盘还需要写入的字节数
fn estimate_required_bytes(
    scans: &[CardScanResult],
    export_path: &str,
    date_folder: &str,
    overwrite: &HashSet<String>,
) -> u64 {
    let mut required = 0u64;
    for scan in scans {
        for file in &scan.files {
            let dest = dest_path(export_path, date_folder, &file.relative_path);
            let key = conflict_key(export_path, &file.relative_path);
            if !dest.exists() {
                required += file.size;
                continue;
            }
            if let Ok(meta) = fs::metadata(&dest) {
                let dest_mtime = mtime_secs(&meta);
                if files_match(file.size, file.mtime_secs, meta.len(), dest_mtime) {
                    continue;
                }
                if overwrite.contains(&key) {
                    if file.size > meta.len() {
                        required += file.size - meta.len();
                    }
                    // 覆盖更小或等大文件时几乎不额外占空间；保留 margin 兜底
                }
            }
        }
    }
    required
}

#[tauri::command]
pub fn scan_card_media(card_paths: Vec<String>) -> Result<Vec<CardScanResult>, String> {
    if card_paths.is_empty() {
        return Err("请至少选择一张存储卡".to_string());
    }
    Ok(card_paths.iter().map(|p| scan_card(p)).collect())
}

#[tauri::command]
pub fn check_export_space(
    export_paths: Vec<String>,
    required_bytes_per_path: Vec<u64>,
) -> Result<SpaceCheckResult, String> {
    if export_paths.is_empty() {
        return Err("请至少选择一个导出路径".to_string());
    }
    if export_paths.len() != required_bytes_per_path.len() {
        return Err("导出路径与所需空间数量不匹配".to_string());
    }

    let mut items = Vec::new();
    let mut all_sufficient = true;

    for (path, required_bytes) in export_paths.iter().zip(required_bytes_per_path.iter()) {
        let required_with_margin = required_bytes.saturating_add(SPACE_MARGIN);
        let p = Path::new(path);
        if !p.exists() {
            items.push(SpaceCheckItem {
                path: path.clone(),
                available: 0,
                required: required_with_margin,
                sufficient: false,
            });
            all_sufficient = false;
            continue;
        }
        let available =
            available_space(p).map_err(|e| format!("读取可用空间失败 ({}): {}", path, e))?;
        let sufficient = available >= required_with_margin;
        if !sufficient {
            all_sufficient = false;
        }
        items.push(SpaceCheckItem {
            path: path.clone(),
            available,
            required: required_with_margin,
            sufficient,
        });
    }

    Ok(SpaceCheckResult {
        items,
        all_sufficient,
    })
}

/// 前端便捷：各盘所需相同字节数时使用
#[tauri::command]
pub fn check_export_space_uniform(
    export_paths: Vec<String>,
    required_bytes: u64,
) -> Result<SpaceCheckResult, String> {
    let required = vec![required_bytes; export_paths.len()];
    check_export_space(export_paths, required)
}

#[tauri::command]
pub fn detect_export_conflicts(
    card_paths: Vec<String>,
    export_paths: Vec<String>,
    date_folder: Option<String>,
) -> Result<ConflictDetectResult, String> {
    if card_paths.is_empty() {
        return Err("请至少选择一张存储卡".to_string());
    }
    if export_paths.is_empty() {
        return Err("请至少选择一个导出路径".to_string());
    }

    let date_folder = date_folder.unwrap_or_else(today_date_folder);
    let mut identical = Vec::new();
    let mut conflicts = Vec::new();

    for card in &card_paths {
        let scan = scan_card(card);
        if let Some(err) = &scan.error {
            return Err(err.clone());
        }
        for file in &scan.files {
            for export in &export_paths {
                let dest = dest_path(export, &date_folder, &file.relative_path);
                if !dest.exists() {
                    continue;
                }
                let dest_meta = fs::metadata(&dest)
                    .map_err(|e| format!("读取目标文件失败: {}: {}", dest.display(), e))?;
                let dest_size = dest_meta.len();
                let dest_mtime = mtime_secs(&dest_meta);
                let key = conflict_key(export, &file.relative_path);
                if files_match(file.size, file.mtime_secs, dest_size, dest_mtime) {
                    identical.push(IdenticalItem {
                        key: key.clone(),
                        card_path: card.clone(),
                        relative_path: file.relative_path.clone(),
                        export_path: export.clone(),
                        dest_path: dest.to_string_lossy().to_string(),
                    });
                } else {
                    conflicts.push(ConflictItem {
                        key,
                        card_path: card.clone(),
                        relative_path: file.relative_path.clone(),
                        export_path: export.clone(),
                        dest_path: dest.to_string_lossy().to_string(),
                        source_size: file.size,
                        dest_size,
                        source_mtime_secs: file.mtime_secs,
                        dest_mtime_secs: dest_mtime,
                    });
                }
            }
        }
    }

    Ok(ConflictDetectResult {
        identical,
        conflicts,
        date_folder,
    })
}

fn copy_file_with_progress<F>(
    source: &Path,
    dest: &Path,
    cancelled: &AtomicBool,
    mut on_progress: F,
) -> Result<u64, String>
where
    F: FnMut(u64),
{
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let mut src = File::open(source).map_err(|e| format!("打开源文件失败: {}", e))?;
    let mut dst = File::create(dest).map_err(|e| format!("创建目标文件失败: {}", e))?;
    let mut buffer = vec![0u8; COPY_BUFFER_SIZE];
    let mut written = 0u64;
    let mut since_emit = 0u64;

    loop {
        if cancelled.load(Ordering::Relaxed) {
            let _ = fs::remove_file(dest);
            return Err("导出已取消".to_string());
        }
        let n = src
            .read(&mut buffer)
            .map_err(|e| format!("读取源文件失败: {}", e))?;
        if n == 0 {
            break;
        }
        dst.write_all(&buffer[..n])
            .map_err(|e| format!("写入目标文件失败: {}", e))?;
        written += n as u64;
        since_emit += n as u64;
        if since_emit >= PROGRESS_EMIT_EVERY {
            on_progress(written);
            since_emit = 0;
        }
    }
    dst.flush().map_err(|e| format!("刷新目标文件失败: {}", e))?;

    if let Ok(meta) = fs::metadata(source) {
        if let Ok(mtime) = meta.modified() {
            let _ = dst.set_modified(mtime);
        }
    }

    on_progress(written);
    Ok(written)
}

#[tauri::command]
pub fn cancel_export(manager: State<ExportManager>) -> Result<(), String> {
    manager.cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn get_today_date_folder() -> String {
    today_date_folder()
}

#[tauri::command]
pub fn start_export(
    app: AppHandle,
    manager: State<ExportManager>,
    card_paths: Vec<String>,
    export_paths: Vec<String>,
    date_folder: Option<String>,
    overwrite_keys: Vec<String>,
) -> Result<String, String> {
    if manager.running.swap(true, Ordering::SeqCst) {
        return Err("已有导出任务在进行中".to_string());
    }

    if card_paths.is_empty() {
        manager.running.store(false, Ordering::SeqCst);
        return Err("请至少选择一张存储卡".to_string());
    }
    if export_paths.is_empty() {
        manager.running.store(false, Ordering::SeqCst);
        return Err("请至少选择一个导出路径".to_string());
    }

    manager.cancelled.store(false, Ordering::SeqCst);
    let date_folder = date_folder.unwrap_or_else(today_date_folder);
    let overwrite: HashSet<String> = overwrite_keys.into_iter().collect();

    let scans: Vec<CardScanResult> = card_paths.iter().map(|p| scan_card(p)).collect();
    for s in &scans {
        if let Some(err) = &s.error {
            manager.running.store(false, Ordering::SeqCst);
            return Err(err.clone());
        }
    }

    let required_list: Vec<u64> = export_paths
        .iter()
        .map(|ep| estimate_required_bytes(&scans, ep, &date_folder, &overwrite))
        .collect();

    match check_export_space(export_paths.clone(), required_list) {
        Ok(space) if !space.all_sufficient => {
            manager.running.store(false, Ordering::SeqCst);
            let detail = space
                .items
                .iter()
                .filter(|i| !i.sufficient)
                .map(|i| {
                    format!(
                        "{}: 可用 {} / 需要 {}",
                        i.path,
                        format_bytes(i.available),
                        format_bytes(i.required)
                    )
                })
                .collect::<Vec<_>>()
                .join("; ");
            return Err(format!("磁盘空间不足: {}", detail));
        }
        Ok(_) => {}
        Err(e) => {
            manager.running.store(false, Ordering::SeqCst);
            return Err(e);
        }
    }

    let cancelled = Arc::clone(&manager.cancelled);
    let running = Arc::clone(&manager.running);
    let app_clone = app.clone();
    let date_folder_clone = date_folder.clone();
    let export_paths_clone = export_paths.clone();
    let overwrite_clone = overwrite;
    let scans_clone = scans;

    std::thread::spawn(move || {
        run_export_job(
            app_clone,
            scans_clone,
            export_paths_clone,
            date_folder_clone,
            overwrite_clone,
            cancelled,
        );
        running.store(false, Ordering::SeqCst);
    });

    Ok(format!("开始导出到 {}", date_folder))
}

fn run_export_job(
    app: AppHandle,
    scans: Vec<CardScanResult>,
    export_paths: Vec<String>,
    date_folder: String,
    overwrite: HashSet<String>,
    cancelled: Arc<AtomicBool>,
) {
    let export_count = export_paths.len().max(1) as u64;

    // 总进度：所有「源文件 × 导出盘」的字节（含将跳过的，便于进度分母稳定）
    let mut grand_total_bytes = 0u64;
    let mut grand_files_total = 0u64;
    for scan in &scans {
        grand_total_bytes += scan.total_bytes.saturating_mul(export_count);
        grand_files_total += (scan.files.len() as u64).saturating_mul(export_count);
    }

    let global_bytes = Arc::new(Mutex::new(0u64));
    let global_files_done = Arc::new(Mutex::new(0u64));
    let succeeded = Arc::new(Mutex::new(Vec::new()));
    let skipped_identical = Arc::new(Mutex::new(Vec::new()));
    let skipped_conflict = Arc::new(Mutex::new(Vec::new()));
    let failed = Arc::new(Mutex::new(Vec::new()));

    let mut handles = Vec::new();

    for scan in scans {
        let app = app.clone();
        let export_paths = export_paths.clone();
        let date_folder = date_folder.clone();
        let overwrite = overwrite.clone();
        let cancelled = Arc::clone(&cancelled);
        let global_bytes = Arc::clone(&global_bytes);
        let global_files_done = Arc::clone(&global_files_done);
        let succeeded = Arc::clone(&succeeded);
        let skipped_identical = Arc::clone(&skipped_identical);
        let skipped_conflict = Arc::clone(&skipped_conflict);
        let failed = Arc::clone(&failed);
        let card_total_bytes = scan.total_bytes.saturating_mul(export_count);

        handles.push(std::thread::spawn(move || {
            let mut card_bytes_copied = 0u64;

            for file in &scan.files {
                for export in &export_paths {
                    if cancelled.load(Ordering::Relaxed) {
                        return;
                    }

                    let dest = dest_path(export, &date_folder, &file.relative_path);
                    let key = conflict_key(export, &file.relative_path);
                    let file_name = Path::new(&file.relative_path)
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| file.relative_path.clone());

                    let emit_progress = |status: &str,
                                         card_bytes: u64,
                                         bytes_copied: u64,
                                         files_done: u64| {
                        let _ = app.emit(
                            "export-progress",
                            ExportProgressEvent {
                                card_path: scan.card_path.clone(),
                                export_path: export.clone(),
                                file_name: file_name.clone(),
                                relative_path: file.relative_path.clone(),
                                bytes_copied,
                                total_bytes: grand_total_bytes,
                                files_done,
                                files_total: grand_files_total,
                                card_bytes_copied: card_bytes,
                                card_total_bytes,
                                status: status.to_string(),
                            },
                        );
                    };

                    // 已存在：比对
                    if dest.exists() {
                        if let Ok(meta) = fs::metadata(&dest) {
                            let dest_mtime = mtime_secs(&meta);
                            if files_match(file.size, file.mtime_secs, meta.len(), dest_mtime) {
                                card_bytes_copied += file.size;
                                {
                                    let mut b = global_bytes.lock().unwrap();
                                    *b += file.size;
                                    let mut f = global_files_done.lock().unwrap();
                                    *f += 1;
                                    emit_progress("skipped_identical", card_bytes_copied, *b, *f);
                                }
                                skipped_identical.lock().unwrap().push(ExportResultItem {
                                    card_path: scan.card_path.clone(),
                                    relative_path: file.relative_path.clone(),
                                    export_path: export.clone(),
                                    dest_path: dest.to_string_lossy().to_string(),
                                    reason: Some("identical".into()),
                                    error: None,
                                });
                                continue;
                            }
                            if !overwrite.contains(&key) {
                                card_bytes_copied += file.size;
                                {
                                    let mut b = global_bytes.lock().unwrap();
                                    *b += file.size;
                                    let mut f = global_files_done.lock().unwrap();
                                    *f += 1;
                                    emit_progress("skipped_conflict", card_bytes_copied, *b, *f);
                                }
                                skipped_conflict.lock().unwrap().push(ExportResultItem {
                                    card_path: scan.card_path.clone(),
                                    relative_path: file.relative_path.clone(),
                                    export_path: export.clone(),
                                    dest_path: dest.to_string_lossy().to_string(),
                                    reason: Some("conflict_skipped".into()),
                                    error: None,
                                });
                                continue;
                            }
                        }
                    }

                    let base_card_bytes = card_bytes_copied;
                    let result = copy_file_with_progress(
                        Path::new(&file.absolute_path),
                        &dest,
                        &cancelled,
                        |written| {
                            let card_now = base_card_bytes + written;
                            // 已完成字节 + 本文件当前写入；多卡并行时前端会按卡相加
                            let global_now = *global_bytes.lock().unwrap() + written;
                            let files_done = *global_files_done.lock().unwrap();
                            emit_progress("copying", card_now, global_now, files_done);
                        },
                    );

                    match result {
                        Ok(written) => {
                            card_bytes_copied += written;
                            {
                                // 必须 +=，不能用快照覆盖，否则多卡并行会互相冲掉进度
                                let mut b = global_bytes.lock().unwrap();
                                *b += written;
                                let mut f = global_files_done.lock().unwrap();
                                *f += 1;
                                emit_progress("copied", card_bytes_copied, *b, *f);
                            }
                            succeeded.lock().unwrap().push(ExportResultItem {
                                card_path: scan.card_path.clone(),
                                relative_path: file.relative_path.clone(),
                                export_path: export.clone(),
                                dest_path: dest.to_string_lossy().to_string(),
                                reason: None,
                                error: None,
                            });
                        }
                        Err(e) => {
                            // 取消时不把该文件记为失败重复；取消后直接返回
                            if cancelled.load(Ordering::Relaxed) || e.contains("取消") {
                                return;
                            }
                            card_bytes_copied += file.size;
                            {
                                let mut b = global_bytes.lock().unwrap();
                                *b += file.size;
                                let mut f = global_files_done.lock().unwrap();
                                *f += 1;
                                emit_progress("failed", card_bytes_copied, *b, *f);
                            }
                            failed.lock().unwrap().push(ExportResultItem {
                                card_path: scan.card_path.clone(),
                                relative_path: file.relative_path.clone(),
                                export_path: export.clone(),
                                dest_path: dest.to_string_lossy().to_string(),
                                reason: None,
                                error: Some(e),
                            });
                        }
                    }
                }
            }
        }));
    }

    for h in handles {
        let _ = h.join();
    }

    let finished = ExportFinishedEvent {
        succeeded: succeeded.lock().unwrap().clone(),
        skipped_identical: skipped_identical.lock().unwrap().clone(),
        skipped_conflict: skipped_conflict.lock().unwrap().clone(),
        failed: failed.lock().unwrap().clone(),
        cancelled: cancelled.load(Ordering::Relaxed),
        date_folder,
    };
    let _ = app.emit("export-finished", finished);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_ext_detection() {
        assert!(is_media_file(Path::new("/x/A.CRM")));
        assert!(is_media_file(Path::new("/x/a.mp4")));
        assert!(is_media_file(Path::new("/x/IMG.CR3")));
        assert!(!is_media_file(Path::new("/x/meta.XML")));
        assert!(!is_media_file(Path::new("/x/readme.txt")));
    }

    #[test]
    fn match_by_size_and_mtime() {
        assert!(files_match(100, 1000, 100, 1001));
        assert!(!files_match(100, 1000, 99, 1000));
        assert!(!files_match(100, 1000, 100, 1010));
    }

    #[test]
    fn conflict_key_format() {
        assert_eq!(
            conflict_key("/Volumes/A", "DCIM/100EOSR5/a.CR3"),
            "/Volumes/A::DCIM/100EOSR5/a.CR3"
        );
    }

    #[test]
    fn scan_filters_non_media_and_keeps_structure() {
        let dir = std::env::temp_dir().join(format!(
            "canon_export_scan_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("DCIM/100EOSR5")).unwrap();
        fs::create_dir_all(dir.join("CRM/REEL_0001")).unwrap();
        fs::create_dir_all(dir.join("XFVC/REEL_0001")).unwrap();
        fs::create_dir_all(dir.join("MISC")).unwrap();
        fs::write(dir.join("DCIM/100EOSR5/IMG_0001.CR3"), b"photo").unwrap();
        fs::write(dir.join("CRM/REEL_0001/A001.CRM"), b"rawvideo").unwrap();
        fs::write(dir.join("XFVC/REEL_0001/A001.MP4"), b"proxy").unwrap();
        fs::write(dir.join("CRM/REEL_0001/meta.XML"), b"<xml/>").unwrap();
        fs::write(dir.join("MISC/config.bin"), b"cfg").unwrap();

        let result = scan_card(dir.to_str().unwrap());
        assert!(result.error.is_none());
        assert_eq!(result.files.len(), 3);
        let rels: Vec<_> = result.files.iter().map(|f| f.relative_path.as_str()).collect();
        assert!(rels.contains(&"DCIM/100EOSR5/IMG_0001.CR3"));
        assert!(rels.contains(&"CRM/REEL_0001/A001.CRM"));
        assert!(rels.contains(&"XFVC/REEL_0001/A001.MP4"));
        assert!(!rels.iter().any(|r| r.ends_with(".XML")));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detect_conflict_when_size_differs() {
        let root = std::env::temp_dir().join(format!(
            "canon_export_conflict_{}",
            std::process::id()
        ));
        let card = root.join("card");
        let export = root.join("disk");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(card.join("CRM/REEL_0001")).unwrap();
        fs::write(card.join("CRM/REEL_0001/A001.CRM"), b"full-content-here").unwrap();
        let date = "2026.09.11";
        let dest = dest_path(
            export.to_str().unwrap(),
            date,
            "CRM/REEL_0001/A001.CRM",
        );
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(&dest, b"partial").unwrap(); // 模拟中断残留

        let result = detect_export_conflicts(
            vec![card.to_string_lossy().to_string()],
            vec![export.to_string_lossy().to_string()],
            Some(date.to_string()),
        )
        .unwrap();
        assert_eq!(result.conflicts.len(), 1);
        assert!(result.identical.is_empty());
        assert_eq!(result.conflicts[0].source_size, 17);
        assert_eq!(result.conflicts[0].dest_size, 7);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_preserves_relative_layout() {
        let root = std::env::temp_dir().join(format!(
            "canon_export_copy_{}",
            std::process::id()
        ));
        let card = root.join("card");
        let export = root.join("export");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(card.join("DCIM/100EOSR6")).unwrap();
        fs::write(card.join("DCIM/100EOSR6/MVI_0001.MP4"), b"movie-bytes").unwrap();
        fs::create_dir_all(&export).unwrap();

        let scan = scan_card(card.to_str().unwrap());
        assert_eq!(scan.files.len(), 1);
        let date = "2026.09.11";
        let dest = dest_path(export.to_str().unwrap(), date, &scan.files[0].relative_path);
        let cancelled = AtomicBool::new(false);
        let written = copy_file_with_progress(
            Path::new(&scan.files[0].absolute_path),
            &dest,
            &cancelled,
            |_| {},
        )
        .unwrap();
        assert_eq!(written, 11);
        assert!(dest.exists());
        assert_eq!(
            dest.strip_prefix(&export).unwrap().to_string_lossy().replace('\\', "/"),
            "2026.09.11/DCIM/100EOSR6/MVI_0001.MP4"
        );

        let _ = fs::remove_dir_all(&root);
    }
}
