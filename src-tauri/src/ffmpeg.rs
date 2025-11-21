use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// 视频信息结构体
#[derive(Debug, Serialize, Deserialize)]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub bit_rate: String,
    pub frame_rate: String,
    pub audio_codec: Option<String>,
    pub audio_channels: Option<u32>,
}

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
            "-i",
            &input_path,
            "-c:v",
            "copy",
            "-ac",
            "4",
            "-c:a",
            "aac",
            "-y", // 覆盖已存在的文件
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

/// 获取视频信息
#[tauri::command]
pub async fn get_video_info(
    app_handle: AppHandle,
    video_path: String,
) -> Result<VideoInfo, String> {
    // 使用 ffprobe 获取视频信息
    let sidecar_command = app_handle
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("Failed to create ffprobe command: {}", e))?;

    let output = sidecar_command
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &video_path,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFprobe error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // 解析 JSON 输出
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    // 提取视频流信息
    let video_stream = json["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"))
        .ok_or("No video stream found")?;

    // 提取音频流信息
    let audio_stream = json["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "audio"));

    let video_info = VideoInfo {
        duration: json["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0),
        width: video_stream["width"].as_u64().unwrap_or(0) as u32,
        height: video_stream["height"].as_u64().unwrap_or(0) as u32,
        codec: video_stream["codec_name"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        bit_rate: json["format"]["bit_rate"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        frame_rate: video_stream["r_frame_rate"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        audio_codec: audio_stream
            .and_then(|s| s["codec_name"].as_str())
            .map(|s| s.to_string()),
        audio_channels: audio_stream
            .and_then(|s| s["channels"].as_u64())
            .map(|c| c as u32),
    };

    Ok(video_info)
}
