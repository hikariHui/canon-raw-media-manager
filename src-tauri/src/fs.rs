// 文件系统相关操作
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn read_directory_files(dir_path: String) -> Result<Vec<String>, String> {
    // 检查路径是否为空
    if dir_path.is_empty() {
        return Err("路径不能为空".to_string());
    }

    // 检查路径是否存在
    let path = std::path::Path::new(&dir_path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", dir_path));
    }

    let files: Vec<String> = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("读取目录失败: {}", e))?
        .filter_map(|entry| entry.ok().map(|e| e.path().display().to_string()))
        .collect();

    Ok(files)
}

#[tauri::command]
pub fn is_file_exists(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    Ok(path.exists())
}

#[derive(Clone, Serialize)]
struct FileChangeEvent {
    /// 事件类型
    kind: String,
    /// 目录路径
    dir_path: String,
    /// 文件路径
    paths: Vec<String>,
}

// 用于管理所有活动的监听器
pub struct WatcherManager {
    // key: 目录路径, value: 停止信号发送器
    watchers: Arc<Mutex<HashMap<String, Sender<()>>>>,
}
impl WatcherManager {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub fn watch_directory(
    app_handle: AppHandle,
    watcher_manager: State<WatcherManager>,
    dir_path: String,
) -> Result<String, String> {
    let path = Path::new(&dir_path);

    if !path.exists() {
        return Err("目录不存在".to_string());
    }

    // 检查是否已经在监听这个目录
    {
        let watchers = watcher_manager.watchers.lock().unwrap();
        if watchers.contains_key(&dir_path) {
            return Err("该目录已经在监听中".to_string());
        }
    }

    // 创建文件系统事件通道
    let (event_tx, event_rx) = channel();
    // 创建停止信号通道
    let (stop_tx, stop_rx) = channel::<()>();

    // 创建监听器
    let mut watcher =
        RecommendedWatcher::new(event_tx, Config::default()).map_err(|e| e.to_string())?;

    // 开始监听目录
    watcher
        .watch(path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // 保存停止信号发送器
    {
        let mut watchers = watcher_manager.watchers.lock().unwrap();
        watchers.insert(dir_path.clone(), stop_tx);
    }

    let dir_path_clone = dir_path.clone();
    let watchers_clone = watcher_manager.watchers.clone();

    // 在后台线程中处理文件系统事件
    std::thread::spawn(move || {
        let _watcher = watcher; // 保持 watcher 存活

        loop {
            // 使用 recv_timeout 来定期检查停止信号
            match event_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(res) => match res {
                    Ok(event) => {
                        let file_event = FileChangeEvent {
                            kind: format!("{:?}", event.kind),
                            dir_path: dir_path_clone.clone(),
                            paths: event
                                .paths
                                .iter()
                                .map(|p| p.display().to_string())
                                .collect(),
                        };
                        println!(
                            "文件事件: kind={}, paths={:?}",
                            file_event.kind, file_event.paths
                        );
                        let _ = app_handle.emit("file-change", file_event);
                    }
                    Err(e) => {
                        eprintln!("监听错误: {:?}", e);
                    }
                },
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // 超时，检查是否收到停止信号
                    if stop_rx.try_recv().is_ok() {
                        println!("停止监听目录: {}", dir_path_clone);
                        // 清理 watcher 记录
                        let mut watchers = watchers_clone.lock().unwrap();
                        watchers.remove(&dir_path_clone);
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    // 通道断开，退出循环
                    println!("事件通道断开，停止监听: {}", dir_path_clone);
                    let mut watchers = watchers_clone.lock().unwrap();
                    watchers.remove(&dir_path_clone);
                    break;
                }
            }
        }
    });

    Ok(format!("开始监听目录: {}", dir_path))
}

#[tauri::command]
pub fn unwatch_directory(
    watcher_manager: State<WatcherManager>,
    dir_path: String,
) -> Result<String, String> {
    let mut watchers = watcher_manager.watchers.lock().unwrap();

    if let Some(stop_tx) = watchers.remove(&dir_path) {
        // 发送停止信号
        stop_tx.send(()).map_err(|e| e.to_string())?;
        Ok(format!("已停止监听目录: {}", dir_path))
    } else {
        Err("该目录没有在监听中".to_string())
    }
}

#[tauri::command]
pub fn list_watching_directories(watcher_manager: State<WatcherManager>) -> Vec<String> {
    let watchers = watcher_manager.watchers.lock().unwrap();
    watchers.keys().cloned().collect()
}

/// 移动文件到目标位置
#[tauri::command]
pub fn move_file(
    source_path: String,
    destination_path: String,
    overwrite: bool,
) -> Result<String, String> {
    let source = Path::new(&source_path);
    let destination = Path::new(&destination_path);

    // 检查源文件是否存在
    if !source.exists() {
        return Err(format!("源文件不存在: {}", source_path));
    }

    // 检查源路径是否是文件（不是目录）
    if !source.is_file() {
        return Err(format!("源路径不是文件: {}", source_path));
    }

    // 如果目标文件已存在且不允许覆盖
    if destination.exists() && !overwrite {
        return Err(format!("目标文件已存在: {}", destination_path));
    }

    // 确保目标目录存在
    if let Some(parent) = destination.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {}", e))?;
        }
    }

    // 尝试使用 rename（快速，但可能跨文件系统失败）
    match std::fs::rename(&source, &destination) {
        Ok(_) => Ok(format!(
            "文件移动成功: {} -> {}",
            source_path, destination_path
        )),
        Err(e) => {
            // 如果 rename 失败（通常是跨文件系统），使用 copy + remove
            if e.raw_os_error() == Some(18) || e.kind() == std::io::ErrorKind::CrossesDevices {
                std::fs::copy(&source, &destination).map_err(|e| format!("复制文件失败: {}", e))?;
                std::fs::remove_file(&source).map_err(|e| format!("删除源文件失败: {}", e))?;
                Ok(format!(
                    "文件移动成功（跨文件系统）: {} -> {}",
                    source_path, destination_path
                ))
            } else {
                Err(format!("移动文件失败: {}", e))
            }
        }
    }
}
