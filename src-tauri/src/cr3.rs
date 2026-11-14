//! CR3 内嵌 JPEG 抽取、EXIF 元数据与预览磁盘缓存。
use image::ImageEncoder;
use rawler::decoders::RawDecodeParams;
use rawler::imgop::develop::RawDevelop;
use rawler::rawsource::RawSource;
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const CACHE_DIR_NAME: &str = "photo-preview-cache";
const INDEX_FILE: &str = "index.json";
const MAX_CACHE_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4GB
const TARGET_AFTER_EVICT: u64 = 3600 * 1024 * 1024; // 3.6GB
const TTL_SECS: u64 = 7 * 24 * 60 * 60; // 7 days

/// Canon metadata uuid (contains CMT1/CMT2/CMT3/THMB)
const UUID_CANON_META: [u8; 16] = [
    0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48,
];
/// Preview uuid (contains PRVW)
const UUID_PRVW: [u8; 16] = [
    0xea, 0xf4, 0x2b, 0x5e, 0x1c, 0x98, 0x4b, 0x88, 0xb9, 0xfb, 0xb7, 0xdc, 0x40, 0x6e, 0x4d, 0x16,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewKind {
    Thumb,
    Preview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoMeta {
    pub path: String,
    pub file_name: String,
    pub datetime_ms: Option<i64>,
    pub orientation: Option<u16>,
    pub continuous_drive: Option<i32>,
    pub burst_key: Option<String>,
}

#[derive(Clone, Serialize)]
struct PhotoScanMetaEvent {
    gen: u64,
    photos: Vec<PhotoMeta>,
}

#[derive(Clone, Serialize)]
struct PhotoScanDoneEvent {
    gen: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    key: String,
    kind: String,
    file_name: String,
    size: u64,
    last_access: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CacheIndex {
    entries: Vec<CacheEntry>,
}

struct CacheState {
    index: CacheIndex,
    dirty: bool,
}

static CACHE: OnceLock<Mutex<CacheState>> = OnceLock::new();
/// 同 key 预览抽取去重，避免并发 cache miss 重复 decode
static PREVIEW_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn cache_state() -> &'static Mutex<CacheState> {
    CACHE.get_or_init(|| {
        Mutex::new(CacheState {
            index: CacheIndex::default(),
            dirty: false,
        })
    })
}

fn preview_extract_lock(lock_key: &str) -> Arc<Mutex<()>> {
    let map = PREVIEW_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap();
    // 回收仅被 map 持有的空闲锁，避免长期增长
    if guard.len() > 128 {
        guard.retain(|_, v| Arc::strong_count(v) > 1);
    }
    guard
        .entry(lock_key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn release_preview_extract_lock(lock_key: &str) {
    let Some(map) = PREVIEW_LOCKS.get() else {
        return;
    };
    let mut guard = map.lock().unwrap();
    // 调用方已 drop clone；仅 map 持有时（strong_count==1）可安全移除
    if let Some(lock) = guard.get(lock_key) {
        if Arc::strong_count(lock) == 1 {
            guard.remove(lock_key);
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?
        .join(CACHE_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    Ok(dir)
}

fn load_index_from_disk(root: &Path) -> CacheIndex {
    let path = root.join(INDEX_FILE);
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => CacheIndex::default(),
    }
}

fn save_index(root: &Path, index: &CacheIndex) -> Result<(), String> {
    let path = root.join(INDEX_FILE);
    let json =
        serde_json::to_string_pretty(index).map_err(|e| format!("序列化缓存索引失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入缓存索引失败: {e}"))
}

fn ensure_index_loaded(root: &Path) {
    let mut guard = cache_state().lock().unwrap();
    if guard.index.entries.is_empty() && !guard.dirty {
        guard.index = load_index_from_disk(root);
    }
}

fn content_key(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("读取文件元数据失败: {e}"))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let size = meta.len();
    let raw = format!("{}|{}|{}", path.display(), mtime, size);
    Ok(simple_hash(&raw))
}

fn simple_hash(s: &str) -> String {
    // FNV-1a 64-bit → hex，无额外依赖
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn kind_str(kind: PreviewKind, quality: Option<&str>) -> &'static str {
    match kind {
        // fast/heavy 分缓存与锁，避免点选兜底被慢速 THMB 抽取堵住
        PreviewKind::Thumb => {
            if thumb_quality_heavy(quality) {
                // v2：PRVW/HQ 回退 + 更宽松的 THMB 声明长度校验
                "thumb_heavy_v2"
            } else {
                "thumb_fast_v2"
            }
        }
        // v3：优先 moov trak 全尺寸 JPEG，旧 preview 缓存自动失效
        PreviewKind::Preview => "preview_hq_v3",
    }
}

const RAW_PREVIEW_CACHE_KIND: &str = "preview_raw_v2";

fn read_u16_be(buf: &[u8], off: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*buf.get(off)?, *buf.get(off + 1)?]))
}

fn read_u32_be(buf: &[u8], off: usize) -> Option<u32> {
    Some(u32::from_be_bytes([
        *buf.get(off)?,
        *buf.get(off + 1)?,
        *buf.get(off + 2)?,
        *buf.get(off + 3)?,
    ]))
}

fn read_u16(buf: &[u8], off: usize, be: bool) -> Option<u16> {
    if be {
        read_u16_be(buf, off)
    } else {
        Some(u16::from_le_bytes([*buf.get(off)?, *buf.get(off + 1)?]))
    }
}

fn read_u64_be(buf: &[u8], off: usize) -> Option<u64> {
    Some(u64::from_be_bytes([
        *buf.get(off)?,
        *buf.get(off + 1)?,
        *buf.get(off + 2)?,
        *buf.get(off + 3)?,
        *buf.get(off + 4)?,
        *buf.get(off + 5)?,
        *buf.get(off + 6)?,
        *buf.get(off + 7)?,
    ]))
}

fn read_u32(buf: &[u8], off: usize, be: bool) -> Option<u32> {
    if be {
        read_u32_be(buf, off)
    } else {
        Some(u32::from_le_bytes([
            *buf.get(off)?,
            *buf.get(off + 1)?,
            *buf.get(off + 2)?,
            *buf.get(off + 3)?,
        ]))
    }
}

struct BoxHeader {
    /// Absolute file offset of box start
    start: u64,
    /// Absolute offset where box payload starts
    payload_start: u64,
    /// Payload length
    payload_len: u64,
    typ: [u8; 4],
    uuid: Option<[u8; 16]>,
}

fn read_box_header(file: &mut File, start: u64) -> Result<Option<BoxHeader>, String> {
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("seek 失败: {e}"))?;
    let mut hdr = [0u8; 8];
    if file
        .read(&mut hdr)
        .map_err(|e| format!("读 box 头失败: {e}"))?
        < 8
    {
        return Ok(None);
    }
    let size32 = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
    let typ = [hdr[4], hdr[5], hdr[6], hdr[7]];
    let (header_len, total_size) = if size32 == 1 {
        let mut ext = [0u8; 8];
        file.read_exact(&mut ext)
            .map_err(|e| format!("读扩展 size 失败: {e}"))?;
        let size64 = u64::from_be_bytes(ext);
        (16u64, size64)
    } else if size32 == 0 {
        // to EOF
        let end = file
            .seek(SeekFrom::End(0))
            .map_err(|e| format!("seek end 失败: {e}"))?;
        (8u64, end.saturating_sub(start))
    } else {
        (8u64, u64::from(size32))
    };

    if total_size < header_len {
        return Err(format!("非法 box size: {total_size}"));
    }

    let mut payload_start = start + header_len;
    let mut uuid = None;
    if &typ == b"uuid" {
        let mut u = [0u8; 16];
        file.seek(SeekFrom::Start(payload_start))
            .map_err(|e| format!("seek uuid 失败: {e}"))?;
        file.read_exact(&mut u)
            .map_err(|e| format!("读 uuid 失败: {e}"))?;
        uuid = Some(u);
        payload_start += 16;
    }

    let box_end = start + total_size;
    if payload_start > box_end {
        return Err("box payload 越界".into());
    }
    Ok(Some(BoxHeader {
        start,
        payload_start,
        payload_len: box_end - payload_start,
        typ,
        uuid,
    }))
}

fn walk_boxes(
    file: &mut File,
    start: u64,
    end: u64,
    depth: usize,
    on_box: &mut dyn FnMut(&mut File, &BoxHeader) -> Result<(), String>,
) -> Result<(), String> {
    walk_boxes_inner(file, start, end, depth, None, on_box)
}

fn walk_boxes_inner(
    file: &mut File,
    start: u64,
    end: u64,
    depth: usize,
    stop_top_level: Option<&Cell<bool>>,
    on_box: &mut dyn FnMut(&mut File, &BoxHeader) -> Result<(), String>,
) -> Result<(), String> {
    if depth > 12 {
        return Ok(());
    }
    let mut cursor = start;
    while cursor + 8 <= end {
        if depth == 0 && stop_top_level.is_some_and(|s| s.get()) {
            break;
        }
        let Some(hdr) = read_box_header(file, cursor)? else {
            break;
        };
        // recompute box end from header
        file.seek(SeekFrom::Start(hdr.start))
            .map_err(|e| format!("seek 失败: {e}"))?;
        let mut size_buf = [0u8; 4];
        file.read_exact(&mut size_buf)
            .map_err(|e| format!("读 size 失败: {e}"))?;
        let size32 = u32::from_be_bytes(size_buf);
        let total = if size32 == 1 {
            file.seek(SeekFrom::Start(hdr.start + 8))
                .map_err(|e| format!("seek 失败: {e}"))?;
            let mut ext = [0u8; 8];
            file.read_exact(&mut ext)
                .map_err(|e| format!("读扩展 size 失败: {e}"))?;
            u64::from_be_bytes(ext)
        } else if size32 == 0 {
            end.saturating_sub(hdr.start)
        } else {
            u64::from(size32)
        };
        let absolute_end = hdr.start.saturating_add(total).min(end);

        on_box(file, &hdr)?;

        // Containers to recurse into
        let is_container = matches!(
            &hdr.typ,
            b"moov" | b"trak" | b"mdia" | b"minf" | b"stbl" | b"udta"
        ) || (hdr.typ == *b"uuid"
            && (hdr.uuid == Some(UUID_CANON_META) || hdr.uuid == Some(UUID_PRVW)));

        let skip_recurse = depth == 0 && stop_top_level.is_some_and(|s| s.get());
        if is_container && !skip_recurse {
            walk_boxes_inner(
                file,
                hdr.payload_start,
                absolute_end,
                depth + 1,
                None,
                on_box,
            )?;
        }

        if total == 0 {
            break;
        }
        cursor = absolute_end;
        if cursor <= hdr.start {
            break;
        }
    }
    Ok(())
}

fn find_jpeg_in_slice(data: &[u8]) -> Option<&[u8]> {
    let mut i = 0;
    while i + 2 < data.len() {
        if data[i] == 0xff && data[i + 1] == 0xd8 && data[i + 2] == 0xff {
            // 必须找到 EOI，避免返回截断流写入缓存
            let mut j = i + 3;
            while j + 1 < data.len() {
                if data[j] == 0xff && data[j + 1] == 0xd9 {
                    return Some(&data[i..=j + 1]);
                }
                j += 1;
            }
            i += 1;
            continue;
        }
        i += 1;
    }
    None
}

/// 在缓冲区中找体积最大的完整 JPEG（用于 mdat 内嵌全尺寸预览）。
fn largest_jpeg_in_slice(data: &[u8]) -> Option<&[u8]> {
    let mut best: Option<&[u8]> = None;
    let mut i = 0usize;
    while i + 2 < data.len() {
        if data[i] == 0xff && data[i + 1] == 0xd8 && data[i + 2] == 0xff {
            let mut j = i + 3;
            let mut found_eoi = false;
            while j + 1 < data.len() {
                if data[j] == 0xff && data[j + 1] == 0xd9 {
                    let slice = &data[i..=j + 1];
                    if best.map(|b| slice.len() > b.len()).unwrap_or(true) {
                        best = Some(slice);
                    }
                    i = j + 2;
                    found_eoi = true;
                    break;
                }
                j += 1;
            }
            if !found_eoi {
                // 无 EOI：跳过该 SOI，继续找后续完整 JPEG
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    best
}

/// CR3 mdat 前部通常放全尺寸 JPEG；只读前 16MB，避免吞掉整段 RAW。
const MDAT_JPEG_SCAN_MAX: u64 = 16 * 1024 * 1024;
/// 小于该体积视为缩略图/PRVW，不当作高清预览
const HQ_JPEG_MIN_BYTES: usize = 200_000;

fn slice_child_box_payload<'a>(data: &'a [u8], fourcc: &[u8; 4]) -> Option<&'a [u8]> {
    let mut off = 0usize;
    while off + 8 <= data.len() {
        let size = read_u32_be(data, off)? as usize;
        if size < 8 || off.saturating_add(size) > data.len() {
            break;
        }
        if data.get(off + 4..off + 8)? == fourcc {
            return data.get(off + 8..off + size);
        }
        off += size;
    }
    None
}

fn find_box_payload_deep<'a>(data: &'a [u8], fourcc: &[u8; 4]) -> Option<&'a [u8]> {
    if let Some(inner) = slice_child_box_payload(data, fourcc) {
        return Some(inner);
    }
    let mut off = 0usize;
    while off + 8 <= data.len() {
        let size = read_u32_be(data, off).unwrap_or(0) as usize;
        if size < 8 || off.saturating_add(size) > data.len() {
            break;
        }
        let child = data.get(off + 8..off + size)?;
        if let Some(found) = find_box_payload_deep(child, fourcc) {
            return Some(found);
        }
        off += size;
    }
    None
}

fn moov_trak_payloads(moov_payload: &[u8]) -> Vec<&[u8]> {
    let mut traks = Vec::new();
    let mut off = 0usize;
    while off + 8 <= moov_payload.len() {
        let size = read_u32_be(moov_payload, off).unwrap_or(0) as usize;
        if size < 8 || off.saturating_add(size) > moov_payload.len() {
            break;
        }
        if moov_payload.get(off + 4..off + 8) == Some(b"trak") {
            if let Some(body) = moov_payload.get(off + 8..off + size) {
                traks.push(body);
            }
        }
        off += size;
    }
    traks
}

fn stsz_first_sample_size(stsz: &[u8]) -> Option<u32> {
    if stsz.len() < 12 {
        return None;
    }
    let sample_size = read_u32_be(stsz, 4)?;
    let count = read_u32_be(stsz, 8)?;
    if count == 0 {
        return None;
    }
    if sample_size != 0 {
        return Some(sample_size);
    }
    if stsz.len() >= 16 {
        read_u32_be(stsz, 12)
    } else {
        None
    }
}

fn stco_first_offset(stco: &[u8]) -> Option<u64> {
    if stco.len() < 12 {
        return None;
    }
    let count = read_u32_be(stco, 4)?;
    if count == 0 {
        return None;
    }
    let off = read_u32_be(stco, 8)?;
    Some(u64::from(off))
}

fn co64_first_offset(co64: &[u8]) -> Option<u64> {
    if co64.len() < 16 {
        return None;
    }
    let count = read_u32_be(co64, 4)?;
    if count == 0 {
        return None;
    }
    read_u64_be(co64, 8)
}

fn extract_jpeg_sample_from_trak(trak: &[u8]) -> Option<(u64, u64)> {
    let has_jpeg_marker = trak.windows(4).any(|w| w == b"JPEG" || w == b"jpeg");
    let stsz = find_box_payload_deep(trak, b"stsz")?;
    let sample_size = u64::from(stsz_first_sample_size(stsz)?);
    let offset = find_box_payload_deep(trak, b"co64")
        .and_then(co64_first_offset)
        .or_else(|| find_box_payload_deep(trak, b"stco").and_then(stco_first_offset))?;
    if !has_jpeg_marker {
        // 仍可能是 JPEG 轨：stsz+偏移即可
        let has_stsd = find_box_payload_deep(trak, b"stsd").is_some();
        if !has_stsd {
            return None;
        }
    }
    Some((offset, sample_size))
}

fn extract_hq_jpeg_from_moov_trak(file: &mut File, file_len: u64) -> Option<Vec<u8>> {
    let mut moov: Option<(u64, u64)> = None;
    let _ = walk_boxes(file, 0, file_len, 0, &mut |_, hdr| {
        if moov.is_none() && &hdr.typ == b"moov" {
            moov = Some((hdr.payload_start, hdr.payload_len));
        }
        Ok(())
    });
    let (start, len) = moov?;
    let moov_data = read_file_region(file, start, len).ok()?;
    let mut candidates: Vec<(u64, u64, bool)> = Vec::new();
    for trak in moov_trak_payloads(&moov_data) {
        let jpeg_marked = trak.windows(4).any(|w| w == b"JPEG");
        if let Some((off, size)) = extract_jpeg_sample_from_trak(trak) {
            candidates.push((off, size, jpeg_marked));
        }
    }
    candidates.sort_by(|a, b| b.2.cmp(&a.2));
    for (off, size, _) in candidates {
        if size == 0 || size > 64 * 1024 * 1024 {
            continue;
        }
        // Canon CR3 的 co64/stco 为文件绝对偏移（非相对 mdat）
        let buf = read_file_region(file, off, size).ok()?;
        if looks_like_complete_jpeg(&buf) {
            return Some(buf);
        }
    }
    None
}

fn looks_like_complete_jpeg(buf: &[u8]) -> bool {
    if buf.len() < 4 || buf[0] != 0xff || buf[1] != 0xd8 {
        return false;
    }
    // HQ sample 常带尾部 padding；THMB 声明长度也可能偏大，窗口放宽到 4KB
    let tail = buf.len().saturating_sub(4096);
    buf[tail..].windows(2).any(|w| w[0] == 0xff && w[1] == 0xd9)
}

/// 磁盘缓存命中校验：与 `looks_like_complete_jpeg` 一致（SOI + 末尾 64 字节窗口内 EOI）。
fn cached_jpeg_file_ok(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    let len = meta.len() as usize;
    if len < 4 {
        return false;
    }
    let Ok(mut f) = File::open(path) else {
        return false;
    };
    let mut head = [0u8; 2];
    if f.read_exact(&mut head).is_err() || head != [0xff, 0xd8] {
        return false;
    }
    let window = len.min(4096);
    let start = (len - window) as u64;
    if f.seek(SeekFrom::Start(start)).is_err() {
        return false;
    }
    let mut tail = vec![0u8; window];
    if f.read_exact(&mut tail).is_err() {
        return false;
    }
    // 拼 SOI + 尾窗，复用同一套完整 JPEG 判定
    let mut probe = Vec::with_capacity(2 + window);
    probe.extend_from_slice(&head);
    probe.extend_from_slice(&tail);
    looks_like_complete_jpeg(&probe)
}

fn extract_hq_jpeg_from_mdat(file: &mut File, file_len: u64) -> Option<Vec<u8>> {
    let mut mdat: Option<(u64, u64)> = None;
    let _ = walk_boxes(file, 0, file_len, 0, &mut |_, hdr| {
        if mdat.is_none() && &hdr.typ == b"mdat" {
            mdat = Some((hdr.payload_start, hdr.payload_len));
        }
        Ok(())
    });
    let (start, len) = mdat?;
    let read_len = len.min(MDAT_JPEG_SCAN_MAX);
    if read_len < 1024 {
        return None;
    }
    let buf = read_file_region(file, start, read_len).ok()?;
    let jpeg = largest_jpeg_in_slice(&buf)?;
    if jpeg.len() < HQ_JPEG_MIN_BYTES {
        return None;
    }
    Some(jpeg.to_vec())
}

/// 按声明长度切片；完整校验失败时再在声明区间内扫 EOI（兼容尾部 padding）。
fn take_declared_jpeg(body: &[u8], jpeg_off: usize, jpeg_size: usize) -> Option<Vec<u8>> {
    if jpeg_off + jpeg_size > body.len() {
        return None;
    }
    if body.get(jpeg_off)? != &0xff || body.get(jpeg_off + 1)? != &0xd8 {
        return None;
    }
    let slice = &body[jpeg_off..jpeg_off + jpeg_size];
    if looks_like_complete_jpeg(slice) {
        return Some(slice.to_vec());
    }
    find_jpeg_in_slice(slice).map(|j| j.to_vec())
}

fn extract_thmb_jpeg(data: &[u8]) -> Option<Vec<u8>> {
    let pos = data.windows(4).position(|w| w == b"THMB")?;
    let body = data.get(pos + 4..)?;
    if body.len() < 16 {
        return find_jpeg_in_slice(body).map(|j| j.to_vec());
    }
    let version = body[0];
    // version(1)+flags(3)+width(2)+height(2)+jpeg_size(4) → size at offset 8
    let jpeg_size = read_u32_be(body, 8)? as usize;
    // v0: extra 4 bytes before jpeg (offset 16); v1: jpeg often at 12 or 16
    for jpeg_off in [16usize, 12, 20] {
        if let Some(jpeg) = take_declared_jpeg(body, jpeg_off, jpeg_size) {
            return Some(jpeg);
        }
    }
    let _ = version;
    find_jpeg_in_slice(body).map(|j| j.to_vec())
}

fn extract_prvw_jpeg(payload: &[u8]) -> Option<Vec<u8>> {
    if let Some(pos) = payload.windows(4).position(|w| w == b"PRVW") {
        let body = &payload[pos + 4..];
        // unknown(4) + ?(2) + w(2) + h(2) + ?(2) + jpeg_size(4) + jpeg
        if body.len() >= 20 {
            let jpeg_size = read_u32_be(body, 16)? as usize;
            if let Some(jpeg) = take_declared_jpeg(body, 20, jpeg_size) {
                return Some(jpeg);
            }
        }
        return find_jpeg_in_slice(body).map(|j| j.to_vec());
    }
    find_jpeg_in_slice(payload).map(|j| j.to_vec())
}

fn read_file_region(file: &mut File, start: u64, len: u64) -> Result<Vec<u8>, String> {
    let mut buf = vec![0u8; len as usize];
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("seek 失败: {e}"))?;
    file.read_exact(&mut buf)
        .map_err(|e| format!("读取区域失败: {e}"))?;
    Ok(buf)
}

fn extract_named_preview(
    file: &mut File,
    file_len: u64,
    kind: PreviewKind,
) -> Result<Option<Vec<u8>>, String> {
    let target_uuid = match kind {
        PreviewKind::Thumb => UUID_CANON_META,
        PreviewKind::Preview => UUID_PRVW,
    };
    let fourcc = match kind {
        PreviewKind::Thumb => b"THMB",
        PreviewKind::Preview => b"PRVW",
    };
    let mut found: Option<Vec<u8>> = None;

    walk_boxes(file, 0, file_len, 0, &mut |f, hdr| {
        if found.is_some() {
            return Ok(());
        }
        if &hdr.typ == fourcc {
            let data = read_file_region(
                f,
                hdr.start,
                (hdr.payload_start - hdr.start) + hdr.payload_len,
            )?;
            let jpeg = match kind {
                PreviewKind::Thumb => extract_thmb_jpeg(&data),
                PreviewKind::Preview => extract_prvw_jpeg(&data),
            };
            // 解析失败不中断 walk，继续找其它 THMB/PRVW/uuid
            if jpeg.is_some() {
                found = jpeg;
            }
            return Ok(());
        }
        if hdr.typ == *b"uuid" && hdr.uuid == Some(target_uuid) {
            let data = read_file_region(f, hdr.payload_start, hdr.payload_len)?;
            let jpeg = match kind {
                PreviewKind::Thumb => {
                    if let Some(pos) = data.windows(4).position(|w| w == b"THMB") {
                        let start = if pos >= 4 { pos - 4 } else { pos };
                        extract_thmb_jpeg(&data[start..])
                    } else {
                        extract_thmb_jpeg(&data)
                    }
                }
                PreviewKind::Preview => extract_prvw_jpeg(&data),
            };
            if jpeg.is_some() {
                found = jpeg;
            }
        }
        Ok(())
    })?;

    Ok(found)
}

fn thumb_quality_heavy(quality: Option<&str>) -> bool {
    matches!(quality, Some("heavy"))
}

/// 把大图缩到缩略图量级，避免 heavy 回退 HQ 时写巨大缓存
fn jpeg_downscale_thumb(jpeg: &[u8], max_edge: u32) -> Option<Vec<u8>> {
    let img = image::load_from_memory(jpeg).ok()?;
    let (w, h) = (img.width(), img.height());
    let edge = w.max(h);
    let resized = if edge > max_edge {
        img.thumbnail(max_edge, max_edge)
    } else {
        img
    };
    let rgb = resized.to_rgb8();
    let mut out = Vec::new();
    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85);
    enc.write_image(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )
    .ok()?;
    Some(out)
}

fn extract_thumb_heavy(file: &mut File, file_len: u64) -> Result<Option<Vec<u8>>, String> {
    if let Some(thmb) = extract_named_preview(file, file_len, PreviewKind::Thumb)? {
        return Ok(Some(thmb));
    }
    if let Some(prvw) = extract_named_preview(file, file_len, PreviewKind::Preview)? {
        // PRVW 约 1600px，缩到列表尺寸
        return Ok(Some(jpeg_downscale_thumb(&prvw, 320).unwrap_or(prvw)));
    }
    let mut found: Option<Vec<u8>> = None;
    walk_boxes(file, 0, file_len, 0, &mut |f, hdr| {
        if found.is_some() {
            return Ok(());
        }
        if hdr.typ == *b"uuid" && hdr.uuid == Some(UUID_CANON_META) {
            let data = read_file_region(f, hdr.payload_start, hdr.payload_len)?;
            if let Some(jpeg) = find_jpeg_in_slice(&data) {
                found = Some(jpeg.to_vec());
            }
        }
        Ok(())
    })?;
    if found.is_some() {
        return Ok(found);
    }
    // 最后回退全尺寸嵌入 JPEG（再缩小），覆盖无 THMB/PRVW 的文件
    if let Some(hq) = extract_hq_jpeg_from_moov_trak(file, file_len)
        .or_else(|| extract_hq_jpeg_from_mdat(file, file_len))
    {
        return Ok(Some(jpeg_downscale_thumb(&hq, 320).unwrap_or(hq)));
    }
    Ok(None)
}

/// Extract embedded JPEG of given kind from CR3.
pub fn extract_preview_jpeg(
    path: &Path,
    kind: PreviewKind,
    quality: Option<&str>,
) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| format!("打开 CR3 失败: {e}"))?;
    let file_len = file
        .metadata()
        .map_err(|e| format!("metadata 失败: {e}"))?
        .len();

    if kind == PreviewKind::Preview {
        if let Some(hq) = extract_hq_jpeg_from_moov_trak(&mut file, file_len) {
            return Ok(hq);
        }
        if let Some(hq) = extract_hq_jpeg_from_mdat(&mut file, file_len) {
            return Ok(hq);
        }
        if let Some(prvw) = extract_named_preview(&mut file, file_len, PreviewKind::Preview)? {
            return Ok(prvw);
        }
        if let Ok(thumb) = extract_preview_jpeg(path, PreviewKind::Thumb, quality) {
            return Ok(thumb);
        }
        return Err("未在 CR3 中找到预览 JPEG".into());
    }

    if thumb_quality_heavy(quality) {
        extract_thumb_heavy(&mut file, file_len)?.ok_or_else(|| "未在 CR3 中找到 THMB JPEG".into())
    } else {
        extract_named_preview(&mut file, file_len, PreviewKind::Thumb)?
            .ok_or_else(|| "未在 CR3 中找到 THMB JPEG".into())
    }
}

fn extract_raw_developed_jpeg(path: &Path) -> Result<Vec<u8>, String> {
    let rawfile = RawSource::new(path).map_err(|e| format!("打开 RAW 失败: {e}"))?;
    let decoder = rawler::get_decoder(&rawfile).map_err(|e| format!("RAW 解码器失败: {e}"))?;
    let params = RawDecodeParams::default();
    let raw = decoder
        .raw_image(&rawfile, &params, false)
        .map_err(|e| format!("读取 RAW 图像失败: {e}"))?;
    let dyn_img = RawDevelop::default()
        .develop_intermediate(&raw)
        .map_err(|e| format!("RAW 显影失败: {e}"))?
        .to_dynamic_image()
        .ok_or_else(|| "无法转换为 RGB 图像".to_string())?;
    let rgb = dyn_img.to_rgb8();
    let mut jpeg_bytes: Vec<u8> = Vec::new();
    // 查焦用途尽量少压细节
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, 98);
    encoder
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG 编码失败: {e}"))?;
    Ok(jpeg_bytes)
}

#[derive(Default)]
struct ExifAccum {
    datetime_original: Option<String>,
    subsec: Option<String>,
    datetime: Option<String>,
    orientation: Option<u16>,
    continuous_drive: Option<i32>,
    image_unique_id: Option<String>,
}

fn orientation_from_exif(value_bytes: &[u8], be: bool) -> Option<u16> {
    if value_bytes.len() >= 2 {
        return read_u16(value_bytes, 0, be);
    }
    None
}

fn exif_meta_core_ready(accum: &ExifAccum) -> bool {
    let has_dt = accum.datetime_original.is_some() || accum.datetime.is_some();
    // ImageUniqueID 用于 burst_key；尽量在同一次 meta 扫描里收齐
    has_dt && accum.orientation.is_some() && accum.image_unique_id.is_some()
}

fn apply_cmt_blobs_to_accum(blobs: &[Vec<u8>], accum: &mut ExifAccum) {
    for blob in blobs {
        parse_tiff_ifds(blob, accum);
        if blob.len() >= 2 && !blob.starts_with(b"II") && !blob.starts_with(b"MM") {
            parse_canon_makernotes(blob, accum);
        }
    }
}

fn parse_tiff_ifds(data: &[u8], accum: &mut ExifAccum) {
    if data.len() < 8 {
        return;
    }
    let be = match &data[0..2] {
        b"MM" => true,
        b"II" => false,
        _ => return,
    };
    let magic = read_u16(data, 2, be).unwrap_or(0);
    if magic != 42 {
        return;
    }
    let mut ifd_offset = read_u32(data, 4, be).unwrap_or(0) as usize;
    let mut visited = 0;
    while ifd_offset > 0 && ifd_offset + 2 <= data.len() && visited < 8 {
        visited += 1;
        let count = read_u16(data, ifd_offset, be).unwrap_or(0) as usize;
        let mut exif_ifd: Option<usize> = None;
        let mut makernote_off: Option<usize> = None;
        let mut makernote_len: Option<usize> = None;

        for i in 0..count {
            let entry = ifd_offset + 2 + i * 12;
            if entry + 12 > data.len() {
                break;
            }
            let tag = read_u16(data, entry, be).unwrap_or(0);
            let typ = read_u16(data, entry + 2, be).unwrap_or(0);
            let n = read_u32(data, entry + 4, be).unwrap_or(0) as usize;
            let val_or_off = read_u32(data, entry + 8, be).unwrap_or(0);

            let type_size = match typ {
                1 | 2 | 7 => 1u32,
                3 => 2,
                4 | 9 => 4,
                5 | 10 => 8,
                _ => 1,
            };
            let byte_len = (n as u32).saturating_mul(type_size) as usize;
            let value_bytes: &[u8] = if byte_len <= 4 {
                &data[entry + 8..entry + 12]
            } else {
                let off = val_or_off as usize;
                if off + byte_len <= data.len() {
                    &data[off..off + byte_len]
                } else {
                    continue;
                }
            };

            match tag {
                0x0132 => {
                    // DateTime
                    if let Some(s) = ascii_tag(value_bytes) {
                        accum.datetime = Some(s);
                    }
                }
                0x9003 => {
                    if let Some(s) = ascii_tag(value_bytes) {
                        accum.datetime_original = Some(s);
                    }
                }
                0x9291 => {
                    if let Some(s) = ascii_tag(value_bytes) {
                        accum.subsec = Some(s);
                    }
                }
                0x0112 => {
                    if let Some(v) = orientation_from_exif(value_bytes, be) {
                        accum.orientation = Some(v);
                    }
                }
                0xA420 => {
                    if let Some(s) = ascii_tag(value_bytes) {
                        accum.image_unique_id = Some(s);
                    }
                }
                0x8769 => {
                    // ExifIFD pointer
                    exif_ifd = Some(val_or_off as usize);
                }
                0x927C => {
                    // MakerNote
                    makernote_off = Some(if byte_len <= 4 {
                        entry + 8
                    } else {
                        val_or_off as usize
                    });
                    makernote_len = Some(byte_len.max(if byte_len <= 4 { 4 } else { byte_len }));
                }
                _ => {}
            }
        }

        if let Some(off) = exif_ifd {
            // Parse Exif IFD as nested (same TIFF base)
            parse_one_ifd(data, off, be, accum, true);
        }
        if let (Some(off), Some(len)) = (makernote_off, makernote_len) {
            if off + len <= data.len() {
                parse_canon_makernotes(&data[off..off + len], accum);
            }
        }

        let next_off = ifd_offset + 2 + count * 12;
        ifd_offset = read_u32(data, next_off, be).unwrap_or(0) as usize;
    }
}

fn parse_one_ifd(data: &[u8], ifd_offset: usize, be: bool, accum: &mut ExifAccum, _is_exif: bool) {
    if ifd_offset + 2 > data.len() {
        return;
    }
    let count = read_u16(data, ifd_offset, be).unwrap_or(0) as usize;
    for i in 0..count {
        let entry = ifd_offset + 2 + i * 12;
        if entry + 12 > data.len() {
            break;
        }
        let tag = read_u16(data, entry, be).unwrap_or(0);
        let typ = read_u16(data, entry + 2, be).unwrap_or(0);
        let n = read_u32(data, entry + 4, be).unwrap_or(0) as usize;
        let val_or_off = read_u32(data, entry + 8, be).unwrap_or(0);
        let type_size = match typ {
            1 | 2 | 7 => 1u32,
            3 => 2,
            4 | 9 => 4,
            5 | 10 => 8,
            _ => 1,
        };
        let byte_len = (n as u32).saturating_mul(type_size) as usize;
        let value_bytes: &[u8] = if byte_len <= 4 {
            &data[entry + 8..entry + 12]
        } else {
            let off = val_or_off as usize;
            if off + byte_len <= data.len() {
                &data[off..off + byte_len]
            } else {
                continue;
            }
        };
        match tag {
            0x9003 => {
                if let Some(s) = ascii_tag(value_bytes) {
                    accum.datetime_original = Some(s);
                }
            }
            0x9291 => {
                if let Some(s) = ascii_tag(value_bytes) {
                    accum.subsec = Some(s);
                }
            }
            0x0112 => {
                if let Some(v) = orientation_from_exif(value_bytes, be) {
                    accum.orientation = Some(v);
                }
            }
            0xA420 => {
                if let Some(s) = ascii_tag(value_bytes) {
                    accum.image_unique_id = Some(s);
                }
            }
            0x927C => {
                let off = if byte_len <= 4 {
                    entry + 8
                } else {
                    val_or_off as usize
                };
                if off + byte_len <= data.len() {
                    parse_canon_makernotes(&data[off..off + byte_len.max(4)], accum);
                }
            }
            _ => {}
        }
    }
}

fn ascii_tag(bytes: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(bytes).ok()?;
    let trimmed = s.trim_end_matches('\0').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_canon_makernotes(data: &[u8], accum: &mut ExifAccum) {
    // Canon MakerNotes in CR3 CMT3 is typically a TIFF IFD (often little endian II*)
    if data.len() >= 8 && (data.starts_with(b"II") || data.starts_with(b"MM")) {
        parse_canon_ifd_tags(data, accum);
        return;
    }
    // Sometimes MakerNote is IFD entries without TIFF header (offset relative to start)
    // Try as IFD with little endian (Canon default)
    parse_canon_ifd_at(data, 0, false, accum);
}

fn parse_canon_ifd_tags(data: &[u8], accum: &mut ExifAccum) {
    let be = data.starts_with(b"MM");
    let ifd_offset = read_u32(data, 4, be).unwrap_or(0) as usize;
    parse_canon_ifd_at(data, ifd_offset, be, accum);
}

fn parse_canon_ifd_at(data: &[u8], ifd_offset: usize, be: bool, accum: &mut ExifAccum) {
    if ifd_offset + 2 > data.len() {
        return;
    }
    let count = read_u16(data, ifd_offset, be).unwrap_or(0) as usize;
    if count > 512 {
        return;
    }
    for i in 0..count {
        let entry = ifd_offset + 2 + i * 12;
        if entry + 12 > data.len() {
            break;
        }
        let tag = read_u16(data, entry, be).unwrap_or(0);
        let typ = read_u16(data, entry + 2, be).unwrap_or(0);
        let n = read_u32(data, entry + 4, be).unwrap_or(0) as usize;
        let val_or_off = read_u32(data, entry + 8, be).unwrap_or(0);

        if tag == 0x0001 {
            // CameraSettings: array of int16
            let byte_len = n * 2;
            let shorts: Vec<i16> = if byte_len <= 4 {
                // inline — unusual for CameraSettings
                continue;
            } else {
                let off = val_or_off as usize;
                if off + byte_len > data.len() {
                    continue;
                }
                let slice = &data[off..off + byte_len];
                (0..n)
                    .filter_map(|i| {
                        let o = i * 2;
                        if be {
                            Some(i16::from_be_bytes([slice[o], slice[o + 1]]))
                        } else {
                            Some(i16::from_le_bytes([slice[o], slice[o + 1]]))
                        }
                    })
                    .collect()
            };
            // ContinuousDrive is index 5
            if let Some(v) = shorts.get(5) {
                accum.continuous_drive = Some(i32::from(*v));
            }
        } else if tag == 0x0028 {
            // ImageUniqueID — often binary; stringify hex
            let type_size = if typ == 3 { 2 } else { 1 };
            let byte_len = n * type_size;
            let bytes = if byte_len <= 4 {
                &data[entry + 8..entry + 8 + byte_len.min(4)]
            } else {
                let off = val_or_off as usize;
                if off + byte_len <= data.len() {
                    &data[off..off + byte_len]
                } else {
                    continue;
                }
            };
            if accum.image_unique_id.is_none() {
                accum.image_unique_id = Some(bytes.iter().map(|b| format!("{b:02x}")).collect());
            }
        }
        let _ = typ;
    }
}

fn parse_datetime_ms(dt: &str, subsec: Option<&str>) -> Option<i64> {
    // "YYYY:MM:DD HH:MM:SS"
    let parts: Vec<&str> = dt.split([' ', ':']).collect();
    if parts.len() < 6 {
        return None;
    }
    let year: i32 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let day: u32 = parts[2].parse().ok()?;
    let hour: u32 = parts[3].parse().ok()?;
    let min: u32 = parts[4].parse().ok()?;
    let sec: u32 = parts[5].parse().ok()?;

    let days = days_from_civil(year, month as i32, day as i32)?;
    let secs =
        i64::from(days) * 86400 + i64::from(hour) * 3600 + i64::from(min) * 60 + i64::from(sec);
    let mut ms = secs * 1000;
    if let Some(sub) = subsec {
        let digits: String = sub.chars().filter(|c| c.is_ascii_digit()).collect();
        if !digits.is_empty() {
            let padded = format!("{:0<3}", &digits[..digits.len().min(3)]);
            if let Ok(v) = padded.parse::<i64>() {
                ms += v;
            }
        }
    }
    Some(ms)
}

/// Howard Hinnant days_from_civil (civil to Unix days)
fn days_from_civil(y: i32, m: i32, d: i32) -> Option<i32> {
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = y - i32::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400) as u32;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u32;
    let doy = (153 * mp + 2) / 5 + d as u32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe as i32 - 719468)
}

/// Read photo metadata from CR3 without extracting previews.
pub fn read_photo_meta(path: &Path) -> Result<PhotoMeta, String> {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let mut file = File::open(path).map_err(|e| format!("打开失败: {e}"))?;
    let file_len = file.metadata().map_err(|e| format!("metadata: {e}"))?.len();

    let mut accum = ExifAccum::default();
    let mut cmt_blobs: Vec<Vec<u8>> = Vec::new();
    let stop_top_level = Cell::new(false);

    walk_boxes_inner(
        &mut file,
        0,
        file_len,
        0,
        Some(&stop_top_level),
        &mut |f, hdr| {
            if stop_top_level.get() {
                return Ok(());
            }
            if &hdr.typ == b"mdat" {
                return Ok(());
            }
            if matches!(&hdr.typ, b"CMT1" | b"CMT2" | b"CMT3") {
                let data = read_file_region(f, hdr.payload_start, hdr.payload_len.min(512 * 1024))?;
                cmt_blobs.push(data);
                apply_cmt_blobs_to_accum(&cmt_blobs, &mut accum);
                if exif_meta_core_ready(&accum) {
                    stop_top_level.set(true);
                }
                return Ok(());
            }
            if hdr.typ == *b"uuid" && hdr.uuid == Some(UUID_CANON_META) {
                let cap = if exif_meta_core_ready(&accum) {
                    256 * 1024
                } else if accum.orientation.is_some() || accum.datetime_original.is_some() {
                    512 * 1024
                } else {
                    2 * 1024 * 1024
                };
                let data = read_file_region(f, hdr.payload_start, hdr.payload_len.min(cap))?;
                let mut off = 0usize;
                while off + 8 <= data.len() {
                    let size = read_u32_be(&data, off).unwrap_or(0) as usize;
                    if size < 8 || off + size > data.len() {
                        break;
                    }
                    let typ = &data[off + 4..off + 8];
                    if matches!(typ, b"CMT1" | b"CMT2" | b"CMT3") {
                        cmt_blobs.push(data[off + 8..off + size].to_vec());
                    }
                    off += size;
                }
                apply_cmt_blobs_to_accum(&cmt_blobs, &mut accum);
                if exif_meta_core_ready(&accum) {
                    stop_top_level.set(true);
                }
            }
            Ok(())
        },
    )?;

    if !cmt_blobs.is_empty() {
        apply_cmt_blobs_to_accum(&cmt_blobs, &mut accum);
    }

    let dt_str = accum.datetime_original.or(accum.datetime);
    let datetime_ms = dt_str
        .as_deref()
        .and_then(|d| parse_datetime_ms(d, accum.subsec.as_deref()));

    // R5m2 实测：ImageUniqueID 前 2 字节随帧变化，[2..] 在同一次连拍内稳定。
    // 用 [2..] 作为 burst_key；单张也会有唯一后缀，groupBursts 里单元素组即可。
    let burst_key = accum
        .image_unique_id
        .as_deref()
        .and_then(burst_key_from_image_unique_id);

    Ok(PhotoMeta {
        path: path.display().to_string(),
        file_name,
        datetime_ms,
        orientation: accum.orientation,
        continuous_drive: accum.continuous_drive,
        burst_key,
    })
}

/// Canon ImageUniqueID（16 字节 hex）→ 连拍键：去掉前 2 字节。
fn burst_key_from_image_unique_id(uid: &str) -> Option<String> {
    let hex: String = uid
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .flat_map(|c| c.to_lowercase())
        .collect();
    if hex.len() < 8 {
        return None;
    }
    Some(hex[4..].to_string())
}

fn collect_cr3_paths(dir_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths: Vec<PathBuf> = fs::read_dir(dir_path)
        .map_err(|e| format!("读取目录失败: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("cr3"))
                    .unwrap_or(false)
        })
        .collect();
    paths.sort_by(|a, b| {
        let a_name = a.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let b_name = b.file_name().and_then(|s| s.to_str()).unwrap_or("");
        a_name.cmp(b_name)
    });
    Ok(paths)
}

fn photo_meta_stub(path: &Path, err: Option<&str>) -> PhotoMeta {
    if let Some(e) = err {
        eprintln!("读取元数据失败 {}: {e}", path.display());
    }
    PhotoMeta {
        path: path.display().to_string(),
        file_name: path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string(),
        datetime_ms: None,
        orientation: None,
        continuous_drive: None,
        burst_key: None,
    }
}

fn touch_and_evict(
    root: &Path,
    key: &str,
    kind: PreviewKind,
    quality: Option<&str>,
    file_name: &str,
    size: u64,
) {
    touch_and_evict_kind(root, key, kind_str(kind, quality), file_name, size);
}

fn touch_and_evict_kind(root: &Path, key: &str, kind: &str, file_name: &str, size: u64) {
    let mut guard = cache_state().lock().unwrap();
    let now = now_secs();
    let kind_s = kind.to_string();

    if let Some(e) = guard
        .index
        .entries
        .iter_mut()
        .find(|e| e.key == key && e.kind == kind_s)
    {
        e.last_access = now;
        e.size = size;
    } else {
        guard.index.entries.push(CacheEntry {
            key: key.to_string(),
            kind: kind_s,
            file_name: file_name.to_string(),
            size,
            last_access: now,
        });
    }
    guard.dirty = true;

    // TTL cleanup
    let ttl_cutoff = now.saturating_sub(TTL_SECS);
    let mut removed: Vec<(String, String)> = Vec::new();
    guard.index.entries.retain(|e| {
        if e.last_access < ttl_cutoff {
            removed.push((e.file_name.clone(), e.kind.clone()));
            false
        } else {
            true
        }
    });
    for (name, _) in &removed {
        let _ = fs::remove_file(root.join(name));
    }

    let total: u64 = guard.index.entries.iter().map(|e| e.size).sum();
    if total > MAX_CACHE_BYTES {
        // Prefer evicting preview first
        let mut entries = guard.index.entries.clone();
        entries.sort_by(|a, b| {
            let pref = |k: &str| if is_preview_cache_kind(k) { 0 } else { 1 };
            pref(&a.kind)
                .cmp(&pref(&b.kind))
                .then(a.last_access.cmp(&b.last_access))
        });
        let mut running = total;
        let mut keep = entries.clone();
        let mut drop_names = Vec::new();
        for e in &entries {
            if running <= TARGET_AFTER_EVICT {
                break;
            }
            running = running.saturating_sub(e.size);
            drop_names.push(e.file_name.clone());
            keep.retain(|x| x.file_name != e.file_name);
        }
        for name in &drop_names {
            let _ = fs::remove_file(root.join(name));
        }
        guard.index.entries = keep;
        guard.dirty = true;
    }

    // 清理索引外的孤儿 jpg（含旧版 preview_*.jpg）
    if let Ok(rd) = fs::read_dir(root) {
        let known: std::collections::HashSet<String> = guard
            .index
            .entries
            .iter()
            .map(|e| e.file_name.clone())
            .collect();
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == INDEX_FILE {
                continue;
            }
            if name.ends_with(".jpg") && !known.contains(&name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    if guard.dirty {
        let _ = save_index(root, &guard.index);
        guard.dirty = false;
    }
}

fn cached_path(root: &Path, key: &str, kind: PreviewKind, quality: Option<&str>) -> PathBuf {
    root.join(format!("{}_{}.jpg", key, kind_str(kind, quality)))
}

fn cached_path_kind(root: &Path, key: &str, kind: &str) -> PathBuf {
    root.join(format!("{}_{}.jpg", key, kind))
}

#[tauri::command]
pub async fn get_cr3_preview(
    app: AppHandle,
    path: String,
    kind: PreviewKind,
    quality: Option<String>,
) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("文件不存在: {path}"));
    }
    let root = cache_root(&app)?;
    ensure_index_loaded(&root);
    let key = content_key(&path_buf)?;
    let quality_ref = quality.as_deref();
    let out = cached_path(&root, &key, kind, quality_ref);

    if out.exists() {
        if cached_jpeg_file_ok(&out) {
            let size = out.metadata().map(|m| m.len()).unwrap_or(0);
            touch_and_evict(
                &root,
                &key,
                kind,
                quality_ref,
                out.file_name().unwrap().to_string_lossy().as_ref(),
                size,
            );
            return Ok(out.display().to_string());
        }
        let _ = fs::remove_file(&out);
    }

    let lock_key = format!("{}:{}", key, kind_str(kind, quality_ref));
    let out_display = tauri::async_runtime::spawn_blocking({
        let path_buf = path_buf.clone();
        let root = root.clone();
        let key = key.clone();
        let out = out.clone();
        let lock_key = lock_key.clone();
        let quality_owned = quality.clone();
        move || -> Result<String, String> {
            let lock = preview_extract_lock(&lock_key);
            let result = (|| {
                let _guard = lock.lock().unwrap();
                let q = quality_owned.as_deref();
                // 双检：等待期间可能已被其他任务写好
                if out.exists() && cached_jpeg_file_ok(&out) {
                    let size = out.metadata().map(|m| m.len()).unwrap_or(0);
                    touch_and_evict(
                        &root,
                        &key,
                        kind,
                        q,
                        out.file_name().unwrap().to_string_lossy().as_ref(),
                        size,
                    );
                    return Ok(out.display().to_string());
                }
                if out.exists() {
                    let _ = fs::remove_file(&out);
                }
                let jpeg = extract_preview_jpeg(&path_buf, kind, q)?;
                {
                    let mut f = File::create(&out).map_err(|e| format!("写缓存失败: {e}"))?;
                    f.write_all(&jpeg).map_err(|e| format!("写缓存失败: {e}"))?;
                }
                let size = jpeg.len() as u64;
                touch_and_evict(
                    &root,
                    &key,
                    kind,
                    q,
                    out.file_name().unwrap().to_string_lossy().as_ref(),
                    size,
                );
                Ok(out.display().to_string())
            })();
            drop(lock);
            release_preview_extract_lock(&lock_key);
            result
        }
    })
    .await
    .map_err(|e| format!("抽取任务失败: {e}"))??;

    Ok(out_display)
}

#[tauri::command]
pub async fn get_cr3_raw_preview(app: AppHandle, path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("文件不存在: {path}"));
    }
    let root = cache_root(&app)?;
    ensure_index_loaded(&root);
    let key = content_key(&path_buf)?;
    let out = cached_path_kind(&root, &key, RAW_PREVIEW_CACHE_KIND);

    if out.exists() {
        if cached_jpeg_file_ok(&out) {
            let size = out.metadata().map(|m| m.len()).unwrap_or(0);
            touch_and_evict_kind(
                &root,
                &key,
                RAW_PREVIEW_CACHE_KIND,
                out.file_name().unwrap().to_string_lossy().as_ref(),
                size,
            );
            return Ok(out.display().to_string());
        }
        let _ = fs::remove_file(&out);
    }

    let lock_key = format!("{key}:{RAW_PREVIEW_CACHE_KIND}");
    let out_display = tauri::async_runtime::spawn_blocking({
        let path_buf = path_buf.clone();
        let root = root.clone();
        let key = key.clone();
        let out = out.clone();
        let lock_key = lock_key.clone();
        move || -> Result<String, String> {
            let lock = preview_extract_lock(&lock_key);
            let result = (|| {
                let _guard = lock.lock().unwrap();
                if out.exists() && cached_jpeg_file_ok(&out) {
                    let size = out.metadata().map(|m| m.len()).unwrap_or(0);
                    touch_and_evict_kind(
                        &root,
                        &key,
                        RAW_PREVIEW_CACHE_KIND,
                        out.file_name().unwrap().to_string_lossy().as_ref(),
                        size,
                    );
                    return Ok(out.display().to_string());
                }
                if out.exists() {
                    let _ = fs::remove_file(&out);
                }
                let jpeg = extract_raw_developed_jpeg(&path_buf)?;
                {
                    let mut f = File::create(&out).map_err(|e| format!("写缓存失败: {e}"))?;
                    f.write_all(&jpeg).map_err(|e| format!("写缓存失败: {e}"))?;
                }
                let size = jpeg.len() as u64;
                touch_and_evict_kind(
                    &root,
                    &key,
                    RAW_PREVIEW_CACHE_KIND,
                    out.file_name().unwrap().to_string_lossy().as_ref(),
                    size,
                );
                Ok(out.display().to_string())
            })();
            drop(lock);
            release_preview_extract_lock(&lock_key);
            result
        }
    })
    .await
    .map_err(|e| format!("RAW 预览任务失败: {e}"))??;

    Ok(out_display)
}

/// 仅列出顶层 `.cr3` 文件名，不读元数据。
#[tauri::command]
pub fn list_cr3_directory(dir: String) -> Result<Vec<PhotoMeta>, String> {
    if dir.is_empty() {
        return Err("路径不能为空".into());
    }
    let dir_path = PathBuf::from(&dir);
    if !dir_path.is_dir() {
        return Err(format!("不是目录: {dir}"));
    }
    Ok(collect_cr3_paths(&dir_path)?
        .into_iter()
        .map(|p| PhotoMeta {
            path: p.display().to_string(),
            file_name: p
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string(),
            datetime_ms: None,
            orientation: None,
            continuous_drive: None,
            burst_key: None,
        })
        .collect())
}

/// 最新一次 enrich 的 gen；旧任务在分片间隙看到不匹配则提前结束，避免占 CPU。
static ENRICH_GEN: AtomicU64 = AtomicU64::new(0);

fn advance_enrich_gen(gen: u64) -> bool {
    loop {
        let cur = ENRICH_GEN.load(Ordering::SeqCst);
        if gen < cur {
            return false;
        }
        if ENRICH_GEN
            .compare_exchange(cur, gen, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            return true;
        }
    }
}

/// 仅推进 enrich gen，用于清空目录 / 切换时作废仍在跑的旧扫描。
#[tauri::command]
pub fn cancel_cr3_enrich(gen: u64) {
    let _ = advance_enrich_gen(gen);
}

/// 渐进式补齐元数据：按与 `list_cr3_directory` 相同顺序分批 `read_photo_meta` 并发射事件。
#[tauri::command]
pub async fn enrich_cr3_directory(app: AppHandle, dir: String, gen: u64) -> Result<(), String> {
    if dir.is_empty() {
        return Err("路径不能为空".into());
    }
    let dir_path = PathBuf::from(&dir);
    if !dir_path.is_dir() {
        return Err(format!("不是目录: {dir}"));
    }
    // 只允许更新为「不小于当前」的 gen，避免晚到的旧任务覆盖新任务
    if !advance_enrich_gen(gen) {
        // 仍发 done，避免前端 enriching 卡在 true（该 gen 若已过期会被前端忽略）
        let _ = app.emit("photo-scan-done", PhotoScanDoneEvent { gen });
        return Ok(());
    }
    let paths = collect_cr3_paths(&dir_path)?;

    for chunk in paths.chunks(8) {
        if ENRICH_GEN.load(Ordering::SeqCst) != gen {
            let _ = app.emit("photo-scan-done", PhotoScanDoneEvent { gen });
            return Ok(());
        }
        let owned: Vec<PathBuf> = chunk.to_vec();
        let photos = tauri::async_runtime::spawn_blocking(move || {
            owned
                .iter()
                .map(|p| match read_photo_meta(p) {
                    Ok(m) => m,
                    Err(e) => photo_meta_stub(p, Some(&e)),
                })
                .collect::<Vec<PhotoMeta>>()
        })
        .await
        .map_err(|e| format!("元数据补齐任务失败: {e}"))?;

        if ENRICH_GEN.load(Ordering::SeqCst) != gen {
            let _ = app.emit("photo-scan-done", PhotoScanDoneEvent { gen });
            return Ok(());
        }
        app.emit("photo-scan-meta", PhotoScanMetaEvent { gen, photos })
            .map_err(|e| format!("发射 photo-scan-meta 失败: {e}"))?;
    }

    // 正常完成或末尾再被作废：都发 done，前端按 gen 过滤
    let _ = app.emit("photo-scan-done", PhotoScanDoneEvent { gen });
    Ok(())
}

/// 仅扫描目录顶层 `.cr3`（非递归）。
/// 与 `watch_directory(NonRecursive)` / 视频 `read_directory_files` 一致：
/// 相机导出通常为平坦目录；刻意不扫子文件夹，避免与监听范围不一致。
#[tauri::command]
pub async fn scan_cr3_directory(dir: String) -> Result<Vec<PhotoMeta>, String> {
    if dir.is_empty() {
        return Err("路径不能为空".into());
    }
    let dir_path = PathBuf::from(&dir);
    if !dir_path.is_dir() {
        return Err(format!("不是目录: {dir}"));
    }

    let paths = collect_cr3_paths(&dir_path)?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut result = Vec::with_capacity(paths.len());
        // Simple parallelism: chunk across threads
        let chunk_size = (paths.len() / 8).max(1);
        let chunks: Vec<&[PathBuf]> = paths.chunks(chunk_size).collect();
        let mut handles = Vec::new();
        for chunk in chunks {
            let owned: Vec<PathBuf> = chunk.to_vec();
            handles.push(std::thread::spawn(move || {
                owned
                    .iter()
                    .filter_map(|p| match read_photo_meta(p) {
                        Ok(m) => Some(m),
                        Err(e) => Some(photo_meta_stub(p, Some(&e))),
                    })
                    .collect::<Vec<_>>()
            }));
        }
        for h in handles {
            match h.join() {
                Ok(mut part) => result.append(&mut part),
                Err(_) => {
                    return Err("扫描分片线程异常退出，请重试".into());
                }
            }
        }
        result.sort_by(|a, b| {
            a.datetime_ms
                .cmp(&b.datetime_ms)
                .then_with(|| a.file_name.cmp(&b.file_name))
        });
        Ok(result)
    })
    .await
    .map_err(|e| format!("扫描任务失败: {e}"))?
}

fn is_preview_cache_kind(k: &str) -> bool {
    k == "preview" || k == "preview_hq" || k == "preview_hq_v3" || k == RAW_PREVIEW_CACHE_KIND
}

fn run_cache_maintenance(root: &Path) {
    let mut guard = cache_state().lock().unwrap();
    let now = now_secs();
    let ttl_cutoff = now.saturating_sub(TTL_SECS);
    let mut removed = Vec::new();
    guard.index.entries.retain(|e| {
        if e.last_access < ttl_cutoff {
            removed.push(e.file_name.clone());
            false
        } else {
            true
        }
    });
    for name in &removed {
        let _ = fs::remove_file(root.join(name));
    }

    let total: u64 = guard.index.entries.iter().map(|e| e.size).sum();
    if total > MAX_CACHE_BYTES {
        let mut entries = guard.index.entries.clone();
        entries.sort_by(|a, b| {
            let pref = |k: &str| if is_preview_cache_kind(k) { 0 } else { 1 };
            pref(&a.kind)
                .cmp(&pref(&b.kind))
                .then(a.last_access.cmp(&b.last_access))
        });
        let mut running = total;
        let mut keep = entries.clone();
        let mut drop_names = Vec::new();
        for e in &entries {
            if running <= TARGET_AFTER_EVICT {
                break;
            }
            running = running.saturating_sub(e.size);
            drop_names.push(e.file_name.clone());
            keep.retain(|x| x.file_name != e.file_name);
        }
        for name in &drop_names {
            let _ = fs::remove_file(root.join(name));
        }
        guard.index.entries = keep;
    }

    if let Ok(rd) = fs::read_dir(root) {
        let known: std::collections::HashSet<String> = guard
            .index
            .entries
            .iter()
            .map(|e| e.file_name.clone())
            .collect();
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == INDEX_FILE {
                continue;
            }
            if name.ends_with(".jpg") && !known.contains(&name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    let _ = save_index(root, &guard.index);
    guard.dirty = false;
}

#[tauri::command]
pub async fn cleanup_photo_preview_cache(app: AppHandle) -> Result<(), String> {
    let root = cache_root(&app)?;
    ensure_index_loaded(&root);
    run_cache_maintenance(&root);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn datetime_parse() {
        let ms = parse_datetime_ms("2024:05:01 12:30:45", Some("123")).unwrap();
        assert!(ms > 0);
        assert_eq!(ms % 1000, 123);
    }

    #[test]
    fn find_jpeg() {
        let mut data = vec![0, 1, 2];
        data.extend_from_slice(&[0xff, 0xd8, 0xff, 0xdb, 0x00, 0xff, 0xd9]);
        let j = find_jpeg_in_slice(&data).unwrap();
        assert_eq!(j[0], 0xff);
        assert_eq!(j[j.len() - 1], 0xd9);
    }

    #[test]
    fn burst_key_from_r5m2_image_unique_id() {
        // 同连拍：前 2 字节不同，[2..] 相同
        let a = "b0ceba1009204ccc993a2ceadbbe192c";
        let b = "b3ceba1009204ccc993a2ceadbbe192c";
        let c = "d6ce962d09204ccc993a2ceadbbe192c";
        let d = "29cf962d09204ccc993a2ceadbbe192c"; // b1 也跳了，仍同连拍
        assert_eq!(
            burst_key_from_image_unique_id(a).unwrap(),
            burst_key_from_image_unique_id(b).unwrap()
        );
        assert_eq!(
            burst_key_from_image_unique_id(c).unwrap(),
            burst_key_from_image_unique_id(d).unwrap()
        );
        assert_ne!(
            burst_key_from_image_unique_id(a).unwrap(),
            burst_key_from_image_unique_id(c).unwrap()
        );
    }
}
