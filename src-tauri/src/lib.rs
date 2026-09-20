mod export;
mod ffmpeg;
mod find_proxy;
mod fs;
mod menu;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(fs::WatcherManager::new())
        .manage(find_proxy::FindProxyManager::new())
        .manage(export::ExportManager::new())
        .setup(|app| {
            menu::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs::read_directory_files,
            fs::is_file_exists,
            fs::watch_directory,
            fs::unwatch_directory,
            fs::list_watching_directories,
            fs::move_file,
            find_proxy::find_proxy_directory,
            find_proxy::cancel_find_proxy_directory,
            ffmpeg::convert_proxy_to_4ch,
            ffmpeg::get_video_info,
            export::scan_card_media,
            export::check_export_space,
            export::check_export_space_uniform,
            export::detect_export_conflicts,
            export::start_export,
            export::cancel_export,
            export::get_today_date_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
