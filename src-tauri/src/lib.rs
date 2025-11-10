mod ffmpeg;
mod fs;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(fs::WatcherManager::new())
        .invoke_handler(tauri::generate_handler![
            fs::read_directory_files,
            fs::is_file_exists,
            fs::watch_directory,
            fs::unwatch_directory,
            fs::list_watching_directories,
            fs::move_file,
            ffmpeg::convert_proxy_to_4ch,
            ffmpeg::get_video_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
