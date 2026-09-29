//! 文件夹镜像同步（A → B）：识别 B 内移动、跨盘复制、多余文件进回收站
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

const COPY_BUFFER_SIZE: usize = 8 * 1024 * 1024;
const PROGRESS_EMIT_EVERY: u64 = 4 * 1024 * 1024;
const PREVIEW_LIMIT: usize = 30;

pub struct SyncManager {
    cancelled: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

struct FileIndex {
    by_path: HashMap<String, u64>,
    by_name_size: HashMap<String, Vec<String>>,
}

impl FileIndex {
    fn new() -> Self {
        Self {
            by_path: HashMap::new(),
            by_name_size: HashMap::new(),
        }
    }

    fn insert(&mut self, rel_path: String, size: u64) {
        let bn = Path::new(&rel_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let key = format!("{}:{}", bn, size);
        self.by_name_size
            .entry(key)
            .or_default()
            .push(rel_path.clone());
        self.by_path.insert(rel_path, size);
    }
}

struct SyncPlan {
    moves: Vec<(String, String)>,
    copies: Vec<String>,
    trashes: Vec<String>,
    skip_count: usize,
    total_copy_bytes: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMoveItem {
    pub from: String,
    pub to: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCopyItem {
    pub path: String,
    pub size: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlanSummary {
    pub source_dir: String,
    pub target_dir: String,
    pub source_file_count: usize,
    pub target_file_count: usize,
    pub move_count: usize,
    pub copy_count: usize,
    pub trash_count: usize,
    pub skip_count: usize,
    pub total_copy_bytes: u64,
    pub timestamp: String,
    pub move_preview: Vec<SyncMoveItem>,
    pub copy_preview: Vec<SyncCopyItem>,
    pub trash_preview: Vec<String>,
    pub already_synced: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressEvent {
    pub phase: String,
    pub message: String,
    pub current_path: String,
    pub target_dir: String,
    pub target_index: usize,
    pub target_total: usize,
    pub files_done: u64,
    pub files_total: u64,
    pub bytes_copied: u64,
    pub total_copy_bytes: u64,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTargetResult {
    pub target_dir: String,
    pub moved: usize,
    pub copied: usize,
    pub trashed: usize,
    pub skipped: usize,
    pub failed: Vec<String>,
    pub trash_dir: Option<String>,
    pub total_copy_bytes: u64,
    pub already_synced: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFinishedEvent {
    pub source_dir: String,
    pub results: Vec<SyncTargetResult>,
    pub cancelled: bool,
}

fn is_trash_component(name: &str) -> bool {
    name.starts_with("_trash_")
}

fn scan_dir(root: &Path) -> Result<FileIndex, String> {
    let mut index = FileIndex::new();
    let root_canon = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|n| !is_trash_component(n))
                .unwrap_or(true)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let abs = entry.path();
        let rel = abs
            .strip_prefix(&root_canon)
            .or_else(|_| abs.strip_prefix(root))
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| abs.to_string_lossy().to_string());

        if rel.split('/').any(is_trash_component) {
            continue;
        }

        let size = entry
            .metadata()
            .map_err(|e| format!("读取文件元数据失败 {}: {}", abs.display(), e))?
            .len();
        index.insert(rel, size);
    }

    Ok(index)
}

fn build_plan(a_idx: &FileIndex, b_idx: &FileIndex) -> SyncPlan {
    let mut candidate_copies: Vec<String> = Vec::new();
    let mut candidate_trashes: Vec<String> = Vec::new();
    let mut trash_set: HashSet<String> = HashSet::new();
    let mut skip_count = 0usize;

    for (rel, &a_size) in &a_idx.by_path {
        match b_idx.by_path.get(rel) {
            Some(&b_size) if b_size == a_size => {
                skip_count += 1;
            }
            Some(_) => {
                candidate_copies.push(rel.clone());
                candidate_trashes.push(rel.clone());
                trash_set.insert(rel.clone());
            }
            None => {
                candidate_copies.push(rel.clone());
            }
        }
    }

    for rel in b_idx.by_path.keys() {
        if !a_idx.by_path.contains_key(rel) && !trash_set.contains(rel) {
            candidate_trashes.push(rel.clone());
        }
    }

    candidate_copies.sort();
    let mut b_consumed: HashSet<String> = HashSet::new();
    let mut moves: Vec<(String, String)> = Vec::new();
    let mut new_copies: Vec<String> = Vec::new();

    for copy_path in &candidate_copies {
        let a_size = a_idx.by_path[copy_path];
        let bn = Path::new(copy_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let key = format!("{}:{}", bn, a_size);

        let matched = b_idx
            .by_name_size
            .get(&key)
            .and_then(|candidates| candidates.iter().find(|c| !b_consumed.contains(*c)))
            .cloned();

        if let Some(src_b) = matched {
            b_consumed.insert(src_b.clone());
            moves.push((src_b, copy_path.clone()));
        } else {
            new_copies.push(copy_path.clone());
        }
    }

    let trashes: Vec<String> = candidate_trashes
        .into_iter()
        .filter(|p| !b_consumed.contains(p))
        .collect();

    let total_copy_bytes: u64 = new_copies
        .iter()
        .map(|p| a_idx.by_path.get(p).copied().unwrap_or(0))
        .sum();

    SyncPlan {
        moves,
        copies: new_copies,
        trashes,
        skip_count,
        total_copy_bytes,
    }
}

fn make_timestamp() -> String {
    Local::now().format("%Y%m%d_%H%M%S").to_string()
}

fn validate_dirs(source: &str, target: &str) -> Result<(PathBuf, PathBuf), String> {
    let a_root = PathBuf::from(source);
    let b_root = PathBuf::from(target);

    if !a_root.is_dir() {
        return Err(format!("源目录不存在：{}", a_root.display()));
    }
    if !b_root.is_dir() {
        return Err(format!("目标目录不存在：{}", b_root.display()));
    }

    let real_a = fs::canonicalize(&a_root).unwrap_or_else(|_| a_root.clone());
    let real_b = fs::canonicalize(&b_root).unwrap_or_else(|_| b_root.clone());
    if real_a == real_b {
        return Err("源目录和目标目录不能是同一个目录".to_string());
    }

    // 禁止互为父子目录，避免递归灾难
    if real_b.starts_with(&real_a) || real_a.starts_with(&real_b) {
        return Err("源目录与目标目录不能互为父子关系".to_string());
    }

    Ok((a_root, b_root))
}

fn plan_to_summary(
    plan: &SyncPlan,
    a_idx: &FileIndex,
    source_dir: &str,
    target_dir: &str,
    timestamp: &str,
    source_file_count: usize,
    target_file_count: usize,
) -> SyncPlanSummary {
    let move_preview = plan
        .moves
        .iter()
        .take(PREVIEW_LIMIT)
        .map(|(from, to)| SyncMoveItem {
            from: from.clone(),
            to: to.clone(),
        })
        .collect();
    let copy_preview = plan
        .copies
        .iter()
        .take(PREVIEW_LIMIT)
        .map(|p| SyncCopyItem {
            path: p.clone(),
            size: a_idx.by_path.get(p).copied().unwrap_or(0),
        })
        .collect();
    let trash_preview = plan.trashes.iter().take(PREVIEW_LIMIT).cloned().collect();

    SyncPlanSummary {
        source_dir: source_dir.to_string(),
        target_dir: target_dir.to_string(),
        source_file_count,
        target_file_count,
        move_count: plan.moves.len(),
        copy_count: plan.copies.len(),
        trash_count: plan.trashes.len(),
        skip_count: plan.skip_count,
        total_copy_bytes: plan.total_copy_bytes,
        timestamp: timestamp.to_string(),
        move_preview,
        copy_preview,
        trash_preview,
        already_synced: plan.moves.is_empty() && plan.copies.is_empty() && plan.trashes.is_empty(),
    }
}

struct ProgressCtx<'a> {
    app: &'a AppHandle,
    target_dir: &'a str,
    target_index: usize,
    target_total: usize,
}

fn emit_progress(
    ctx: &ProgressCtx,
    phase: &str,
    message: &str,
    current_path: &str,
    files_done: u64,
    files_total: u64,
    bytes_copied: u64,
    total_copy_bytes: u64,
    status: &str,
) {
    let _ = ctx.app.emit(
        "sync-progress",
        SyncProgressEvent {
            phase: phase.to_string(),
            message: message.to_string(),
            current_path: current_path.to_string(),
            target_dir: ctx.target_dir.to_string(),
            target_index: ctx.target_index,
            target_total: ctx.target_total,
            files_done,
            files_total,
            bytes_copied,
            total_copy_bytes,
            status: status.to_string(),
        },
    );
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
            drop(dst);
            let _ = fs::remove_file(dest);
            return Err("同步已取消".to_string());
        }
        let n = match src.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                drop(dst);
                let _ = fs::remove_file(dest);
                return Err(format!("读取源文件失败: {}", e));
            }
        };
        if let Err(e) = dst.write_all(&buffer[..n]) {
            drop(dst);
            let _ = fs::remove_file(dest);
            return Err(format!("写入目标文件失败: {}", e));
        }
        written += n as u64;
        since_emit += n as u64;
        if since_emit >= PROGRESS_EMIT_EVERY {
            on_progress(written);
            since_emit = 0;
        }
    }

    dst.flush()
        .map_err(|e| format!("刷新目标文件失败: {}", e))?;
    if let Ok(meta) = fs::metadata(source) {
        if let Ok(mtime) = meta.modified() {
            let _ = dst.set_modified(mtime);
        }
    }
    on_progress(written);
    Ok(written)
}

fn remove_empty_dirs(root: &Path) -> Result<(), String> {
    fn walk(root: &Path, current: &Path) -> Result<(), String> {
        let entries = fs::read_dir(current).map_err(|e| format!("读取目录失败: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(is_trash_component)
                .unwrap_or(false)
            {
                continue;
            }
            walk(root, &path)?;
            if fs::read_dir(&path)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false)
            {
                let _ = fs::remove_dir(&path);
            }
        }
        Ok(())
    }
    walk(root, root)
}

/// 返回 (结果, 是否因取消中断)
fn execute_sync(
    ctx: &ProgressCtx,
    a_root: &Path,
    b_root: &Path,
    plan: &SyncPlan,
    timestamp: &str,
    cancelled: &AtomicBool,
) -> (SyncTargetResult, bool) {
    let mut failed: Vec<String> = Vec::new();
    let mut moved = 0usize;
    let mut copied = 0usize;
    let mut trashed = 0usize;
    let mut inline_trashed: HashSet<String> = HashSet::new();
    let trash_dir = b_root.join(format!("_trash_{}", timestamp));
    let mut trash_used = false;

    let total_ops = (plan.moves.len() + plan.trashes.len() + plan.copies.len()) as u64;
    let mut ops_done = 0u64;
    let mut bytes_copied = 0u64;

    let make_result = |moved: usize,
                       copied: usize,
                       trashed: usize,
                       failed: Vec<String>,
                       trash_used: bool|
     -> SyncTargetResult {
        SyncTargetResult {
            target_dir: b_root.display().to_string(),
            moved,
            copied,
            trashed,
            skipped: plan.skip_count,
            failed,
            trash_dir: if trash_used {
                Some(trash_dir.display().to_string())
            } else {
                None
            },
            total_copy_bytes: plan.total_copy_bytes,
            already_synced: false,
        }
    };

    // 1) B 内部移动
    emit_progress(
        ctx,
        "moving",
        &format!("正在执行 B 内部移动（{} 个）…", plan.moves.len()),
        "",
        ops_done,
        total_ops,
        bytes_copied,
        plan.total_copy_bytes,
        "running",
    );

    for (src_rel, dst_rel) in &plan.moves {
        if cancelled.load(Ordering::Relaxed) {
            return (
                make_result(moved, copied, trashed, failed, trash_used),
                true,
            );
        }

        let src = b_root.join(src_rel);
        let dst = b_root.join(dst_rel);

        if dst.exists() && !inline_trashed.contains(dst_rel) {
            let trash_dst = trash_dir.join(dst_rel);
            if let Some(parent) = trash_dst.parent() {
                let _ = fs::create_dir_all(parent);
            }
            match fs::rename(&dst, &trash_dst) {
                Ok(()) => {
                    trash_used = true;
                    inline_trashed.insert(dst_rel.clone());
                }
                Err(e) => {
                    failed.push(format!("移动前 trash 失败 {}: {}", dst_rel, e));
                    ops_done += 1;
                    continue;
                }
            }
        }

        if let Some(parent) = dst.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                failed.push(format!("创建目录失败 {}: {}", dst_rel, e));
                ops_done += 1;
                continue;
            }
        }

        match fs::rename(&src, &dst) {
            Ok(()) => {
                moved += 1;
                emit_progress(
                    ctx,
                    "moving",
                    "B 内部移动",
                    &format!("{} → {}", src_rel, dst_rel),
                    ops_done + 1,
                    total_ops,
                    bytes_copied,
                    plan.total_copy_bytes,
                    "running",
                );
            }
            Err(e) => failed.push(format!("移动失败 {} → {}: {}", src_rel, dst_rel, e)),
        }
        ops_done += 1;
    }

    // 2) Trash
    emit_progress(
        ctx,
        "trashing",
        &format!("正在移到回收站（{} 个）…", plan.trashes.len()),
        "",
        ops_done,
        total_ops,
        bytes_copied,
        plan.total_copy_bytes,
        "running",
    );

    for rel in &plan.trashes {
        if cancelled.load(Ordering::Relaxed) {
            return (
                make_result(moved, copied, trashed, failed, trash_used),
                true,
            );
        }

        if inline_trashed.contains(rel) {
            ops_done += 1;
            continue;
        }

        let src = b_root.join(rel);
        if !src.exists() {
            ops_done += 1;
            continue;
        }

        let dst = trash_dir.join(rel);
        if let Some(parent) = dst.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match fs::rename(&src, &dst) {
            Ok(()) => {
                trash_used = true;
                trashed += 1;
                emit_progress(
                    ctx,
                    "trashing",
                    "移到回收站",
                    rel,
                    ops_done + 1,
                    total_ops,
                    bytes_copied,
                    plan.total_copy_bytes,
                    "running",
                );
            }
            Err(e) => failed.push(format!("Trash 失败 {}: {}", rel, e)),
        }
        ops_done += 1;
    }

    if let Err(e) = remove_empty_dirs(b_root) {
        failed.push(format!("清理空目录失败: {}", e));
    }

    // 3) Copy
    emit_progress(
        ctx,
        "copying",
        &format!("正在从 A 复制到 B（{} 个文件）…", plan.copies.len()),
        "",
        ops_done,
        total_ops,
        bytes_copied,
        plan.total_copy_bytes,
        "running",
    );

    for rel in &plan.copies {
        if cancelled.load(Ordering::Relaxed) {
            return (
                make_result(moved, copied, trashed, failed, trash_used),
                true,
            );
        }

        let src = a_root.join(rel);
        let dst = b_root.join(rel);
        let file_base_bytes = bytes_copied;

        match copy_file_with_progress(&src, &dst, cancelled, |written| {
            emit_progress(
                ctx,
                "copying",
                "正在复制",
                rel,
                ops_done,
                total_ops,
                file_base_bytes + written,
                plan.total_copy_bytes,
                "running",
            );
        }) {
            Ok(n) => {
                copied += 1;
                bytes_copied += n;
                emit_progress(
                    ctx,
                    "copying",
                    "复制完成",
                    rel,
                    ops_done + 1,
                    total_ops,
                    bytes_copied,
                    plan.total_copy_bytes,
                    "running",
                );
            }
            Err(e) => {
                if e.contains("已取消") {
                    return (
                        make_result(moved, copied, trashed, failed, trash_used),
                        true,
                    );
                }
                failed.push(format!("复制失败 {}: {}", rel, e));
            }
        }
        ops_done += 1;
    }

    (
        make_result(moved, copied, trashed, failed, trash_used),
        false,
    )
}

fn dedupe_targets(targets: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for t in targets {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
        }
    }
    out
}

#[tauri::command]
pub fn plan_folder_sync(
    source_dir: String,
    target_dirs: Vec<String>,
) -> Result<Vec<SyncPlanSummary>, String> {
    let targets = dedupe_targets(&target_dirs);
    if targets.is_empty() {
        return Err("请至少选择一个备份目录".to_string());
    }

    let a_root = PathBuf::from(&source_dir);
    if !a_root.is_dir() {
        return Err(format!("源目录不存在：{}", a_root.display()));
    }

    let a_idx = scan_dir(&a_root)?;
    let timestamp = make_timestamp();
    let mut summaries = Vec::with_capacity(targets.len());

    for target in &targets {
        let (_a, b_root) = validate_dirs(&source_dir, target)?;
        let b_idx = scan_dir(&b_root)?;
        let plan = build_plan(&a_idx, &b_idx);
        summaries.push(plan_to_summary(
            &plan,
            &a_idx,
            &source_dir,
            target,
            &timestamp,
            a_idx.by_path.len(),
            b_idx.by_path.len(),
        ));
    }

    Ok(summaries)
}

#[tauri::command]
pub fn cancel_folder_sync(manager: State<SyncManager>) -> Result<(), String> {
    manager.cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn start_folder_sync(
    app: AppHandle,
    manager: State<SyncManager>,
    source_dir: String,
    target_dirs: Vec<String>,
) -> Result<String, String> {
    if manager.running.swap(true, Ordering::SeqCst) {
        return Err("已有同步任务在进行中".to_string());
    }

    let targets = dedupe_targets(&target_dirs);
    if targets.is_empty() {
        manager.running.store(false, Ordering::SeqCst);
        return Err("请至少选择一个备份目录".to_string());
    }

    let a_root = PathBuf::from(&source_dir);
    if !a_root.is_dir() {
        manager.running.store(false, Ordering::SeqCst);
        return Err(format!("源目录不存在：{}", a_root.display()));
    }

    for target in &targets {
        if let Err(e) = validate_dirs(&source_dir, target) {
            manager.running.store(false, Ordering::SeqCst);
            return Err(e);
        }
    }

    manager.cancelled.store(false, Ordering::SeqCst);
    let cancelled = Arc::clone(&manager.cancelled);
    let running = Arc::clone(&manager.running);
    let target_total = targets.len();

    thread::spawn(move || {
        let finish = |event: SyncFinishedEvent| {
            let _ = app.emit("sync-finished", event);
            running.store(false, Ordering::SeqCst);
        };

        let scan_ctx = ProgressCtx {
            app: &app,
            target_dir: "",
            target_index: 0,
            target_total,
        };

        emit_progress(
            &scan_ctx,
            "scanning",
            &format!("正在扫描源目录：{} …", a_root.display()),
            "",
            0,
            0,
            0,
            0,
            "running",
        );

        let a_idx = match scan_dir(&a_root) {
            Ok(idx) => idx,
            Err(e) => {
                finish(SyncFinishedEvent {
                    source_dir,
                    results: vec![SyncTargetResult {
                        target_dir: String::new(),
                        moved: 0,
                        copied: 0,
                        trashed: 0,
                        skipped: 0,
                        failed: vec![format!("扫描源目录失败: {}", e)],
                        trash_dir: None,
                        total_copy_bytes: 0,
                        already_synced: false,
                    }],
                    cancelled: false,
                });
                return;
            }
        };

        if cancelled.load(Ordering::Relaxed) {
            finish(SyncFinishedEvent {
                source_dir,
                results: vec![],
                cancelled: true,
            });
            return;
        }

        let mut results: Vec<SyncTargetResult> = Vec::with_capacity(targets.len());

        for (i, target) in targets.iter().enumerate() {
            if cancelled.load(Ordering::Relaxed) {
                finish(SyncFinishedEvent {
                    source_dir,
                    results,
                    cancelled: true,
                });
                return;
            }

            let b_root = PathBuf::from(target);
            let ctx = ProgressCtx {
                app: &app,
                target_dir: target,
                target_index: i,
                target_total,
            };

            emit_progress(
                &ctx,
                "scanning",
                &format!(
                    "正在扫描目标目录（{}/{}）：{} …",
                    i + 1,
                    target_total,
                    b_root.display()
                ),
                "",
                0,
                0,
                0,
                0,
                "running",
            );

            let b_idx = match scan_dir(&b_root) {
                Ok(idx) => idx,
                Err(e) => {
                    results.push(SyncTargetResult {
                        target_dir: target.clone(),
                        moved: 0,
                        copied: 0,
                        trashed: 0,
                        skipped: 0,
                        failed: vec![format!("扫描目标目录失败: {}", e)],
                        trash_dir: None,
                        total_copy_bytes: 0,
                        already_synced: false,
                    });
                    continue;
                }
            };

            let plan = build_plan(&a_idx, &b_idx);
            let timestamp = make_timestamp();

            if plan.moves.is_empty() && plan.copies.is_empty() && plan.trashes.is_empty() {
                results.push(SyncTargetResult {
                    target_dir: target.clone(),
                    moved: 0,
                    copied: 0,
                    trashed: 0,
                    skipped: plan.skip_count,
                    failed: vec![],
                    trash_dir: None,
                    total_copy_bytes: 0,
                    already_synced: true,
                });
                continue;
            }

            let (result, was_cancelled) =
                execute_sync(&ctx, &a_root, &b_root, &plan, &timestamp, &cancelled);
            results.push(result);
            if was_cancelled {
                finish(SyncFinishedEvent {
                    source_dir,
                    results,
                    cancelled: true,
                });
                return;
            }
        }

        finish(SyncFinishedEvent {
            source_dir,
            results,
            cancelled: false,
        });
    });

    Ok("started".to_string())
}
