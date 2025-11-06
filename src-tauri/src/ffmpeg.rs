use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn convert_proxy_to_4ch(
    app_handle: AppHandle,
    input_path: String,
    output_path: String,
) -> Result<String, String> {
    // 获取 ffmpeg sidecar 命令
    let sidecar_command = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create ffmpeg command: {}", e))?;

    // 构建 ffmpeg 参数
    let output = sidecar_command
        .args([
            "-i", &input_path,
            "-c:v", "copy",
            "-ac", "4",
            "-c:a", "aac",
            "-y",  // 覆盖已存在的文件
            &output_path,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if output.status.success() {
        Ok(format!("Successfully created proxy: {}", output_path))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("FFmpeg error: {}", stderr))
    }
}
