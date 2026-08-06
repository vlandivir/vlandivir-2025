use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const DEFAULT_API_BASE: &str = "https://vlandivir.com";
const TOKEN_FILE: &str = "session.jwt";

struct AppState {
    api_base: Mutex<String>,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

type AppResult<T> = Result<T, AppError>;

fn err(msg: impl Into<String>) -> AppError {
    AppError::Message(msg.into())
}

fn app_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| err(format!("app data dir: {e}")))
}

fn token_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app_data_dir(app)?.join(TOKEN_FILE))
}

fn media_cache_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app_data_dir(app)?.join("trip-media");
    fs::create_dir_all(&dir).map_err(|e| err(format!("create cache dir: {e}")))?;
    Ok(dir)
}

fn read_token(app: &AppHandle) -> AppResult<Option<String>> {
    let path = token_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| err(format!("read token: {e}")))?;
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

fn write_token(app: &AppHandle, token: &str) -> AppResult<()> {
    let dir = app_data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| err(format!("create data dir: {e}")))?;
    fs::write(token_path(app)?, token.trim()).map_err(|e| err(format!("write token: {e}")))
}

fn clear_token_file(app: &AppHandle) -> AppResult<()> {
    let path = token_path(app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| err(format!("clear token: {e}")))?;
    }
    Ok(())
}

fn api_base(state: &AppState) -> String {
    state
        .api_base
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| DEFAULT_API_BASE.to_string())
}

#[tauri::command]
fn get_api_base(state: State<'_, AppState>) -> String {
    api_base(&state)
}

#[tauri::command]
fn set_api_base(state: State<'_, AppState>, base: String) -> AppResult<()> {
    let trimmed = base.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Err(err("API base is empty"));
    }
    *state.api_base.lock().map_err(|_| err("lock poisoned"))? = trimmed;
    Ok(())
}

#[tauri::command]
fn get_session_token(app: AppHandle) -> AppResult<Option<String>> {
    read_token(&app)
}

#[tauri::command]
fn save_session_token(app: AppHandle, token: String) -> AppResult<()> {
    if token.trim().is_empty() {
        return Err(err("empty token"));
    }
    write_token(&app, &token)
}

#[tauri::command]
fn clear_session_token(app: AppHandle) -> AppResult<()> {
    clear_token_file(&app)
}

/// Opens system browser for Google OAuth and waits for loopback handoff.
#[tauri::command]
async fn login_with_google(app: AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    let base = api_base(&state);
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| err(format!("bind: {e}")))?;
    listener
        .set_nonblocking(false)
        .map_err(|e| err(format!("set blocking: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| err(format!("local_addr: {e}")))?
        .port();

    let redirect = format!("/auth/desktop-handoff?port={port}");
    let login_url = format!(
        "{base}/auth/google?redirect={}",
        urlencoding_encode(&redirect)
    );

    app.opener()
        .open_url(login_url, None::<&str>)
        .map_err(|e| err(format!("open browser: {e}")))?;

    let token = tokio::task::spawn_blocking(move || wait_for_handoff(listener))
        .await
        .map_err(|e| err(format!("handoff task: {e}")))??;

    write_token(&app, &token)?;
    Ok(token)
}

fn urlencoding_encode(value: &str) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn wait_for_handoff(listener: TcpListener) -> AppResult<String> {
    let (mut stream, _) = listener
        .accept()
        .map_err(|e| err(format!("waiting for Google handoff: {e}")))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(180)))
        .ok();

    let mut buf = [0u8; 8192];
    let n = stream
        .read(&mut buf)
        .map_err(|e| err(format!("read handoff: {e}")))?;
    let req = String::from_utf8_lossy(&buf[..n]);
    let first_line = req.lines().next().unwrap_or("");
    // GET /?token=... HTTP/1.1
    let path = first_line.split_whitespace().nth(1).unwrap_or("/");
    let url = Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|e| err(format!("parse handoff url: {e}")))?;
    let token = url
        .query_pairs()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| err("handoff response missing token"))?;

    let body = "<!doctype html><html><body><p>Signed in. You can close this tab.</p><script>window.close()</script></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    Ok(token)
}

fn media_path(app: &AppHandle, media_id: &str) -> AppResult<PathBuf> {
    let safe = media_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    Ok(media_cache_dir(app)?.join(format!("{safe}.bin")))
}

#[derive(Serialize)]
struct CacheEnsureResult {
    path: String,
    downloaded: bool,
    bytes: u64,
}

#[tauri::command]
async fn ensure_media_cached(
    app: AppHandle,
    media_id: String,
    url: String,
) -> AppResult<CacheEnsureResult> {
    let path = media_path(&app, &media_id)?;
    if path.exists() {
        let meta = fs::metadata(&path).map_err(|e| err(format!("stat cache: {e}")))?;
        return Ok(CacheEnsureResult {
            path: path.to_string_lossy().into_owned(),
            downloaded: false,
            bytes: meta.len(),
        });
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| err(format!("download start: {e}")))?;
    if !response.status().is_success() {
        return Err(err(format!(
            "download failed: HTTP {}",
            response.status()
        )));
    }

    let tmp = path.with_extension("partial");
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| err(format!("create partial: {e}")))?;
    let mut stream = response.bytes_stream();
    let mut bytes: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| err(format!("download chunk: {e}")))?;
        bytes += chunk.len() as u64;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| err(format!("write cache: {e}")))?;
    }
    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| err(format!("flush cache: {e}")))?;
    drop(file);
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| err(format!("finalize cache: {e}")))?;

    Ok(CacheEnsureResult {
        path: path.to_string_lossy().into_owned(),
        downloaded: true,
        bytes,
    })
}

#[derive(Serialize)]
struct CacheStats {
    files: usize,
    bytes: u64,
    path: String,
}

#[tauri::command]
fn get_cache_stats(app: AppHandle) -> AppResult<CacheStats> {
    let dir = media_cache_dir(&app)?;
    let mut files = 0usize;
    let mut bytes = 0u64;
    for entry in fs::read_dir(&dir).map_err(|e| err(format!("read cache: {e}")))? {
        let entry = entry.map_err(|e| err(format!("cache entry: {e}")))?;
        let meta = entry
            .metadata()
            .map_err(|e| err(format!("cache meta: {e}")))?;
        if meta.is_file() {
            files += 1;
            bytes += meta.len();
        }
    }
    Ok(CacheStats {
        files,
        bytes,
        path: dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn clear_media_cache(app: AppHandle) -> AppResult<CacheStats> {
    let dir = media_cache_dir(&app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| err(format!("clear cache: {e}")))?;
    }
    get_cache_stats(app)
}

#[derive(Deserialize)]
struct ExportClip {
    media_id: String,
    source_path: String,
    trim_start_sec: Option<f64>,
    trim_end_sec: Option<f64>,
    output_name: String,
}

#[derive(Serialize, Clone)]
struct ExportProgress {
    index: usize,
    total: usize,
    message: String,
}

#[tauri::command]
async fn export_clips(
    app: AppHandle,
    clips: Vec<ExportClip>,
    output_dir: String,
) -> AppResult<String> {
    if clips.is_empty() {
        return Err(err("no clips to export"));
    }
    let out = PathBuf::from(&output_dir);
    fs::create_dir_all(&out).map_err(|e| err(format!("create output dir: {e}")))?;

    let total = clips.len();
    for (index, clip) in clips.into_iter().enumerate() {
        let _ = app.emit(
            "export-progress",
            ExportProgress {
                index: index + 1,
                total,
                message: format!("clip {}/{}: {}", index + 1, total, clip.output_name),
            },
        );

        let source = PathBuf::from(&clip.source_path);
        if !source.exists() {
            // Try cache by media id if caller path is stale.
            let cached = media_path(&app, &clip.media_id)?;
            if !cached.exists() {
                return Err(err(format!(
                    "missing local file for {}",
                    clip.output_name
                )));
            }
            run_ffmpeg_copy(
                &cached,
                &out.join(&clip.output_name),
                clip.trim_start_sec,
                clip.trim_end_sec,
            )?;
        } else {
            run_ffmpeg_copy(
                &source,
                &out.join(&clip.output_name),
                clip.trim_start_sec,
                clip.trim_end_sec,
            )?;
        }
    }

    Ok(out.to_string_lossy().into_owned())
}

fn run_ffmpeg_copy(
    input: &Path,
    output: &Path,
    trim_start: Option<f64>,
    trim_end: Option<f64>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
    ];
    if let Some(start) = trim_start {
        if start > 0.0 {
            args.push("-ss".into());
            args.push(format!("{start:.3}"));
        }
    }
    args.push("-i".into());
    args.push(input.to_string_lossy().into_owned());
    if let (Some(start), Some(end)) = (trim_start, trim_end) {
        if end > start {
            args.push("-t".into());
            args.push(format!("{:.3}", end - start.max(0.0)));
        }
    } else if let Some(end) = trim_end {
        if end > 0.0 {
            args.push("-t".into());
            args.push(format!("{end:.3}"));
        }
    }
    args.extend([
        "-c".into(),
        "copy".into(),
        "-movflags".into(),
        "+faststart".into(),
        output.to_string_lossy().into_owned(),
    ]);

    let status = Command::new("ffmpeg")
        .args(&args)
        .status()
        .map_err(|e| err(format!("ffmpeg not available: {e}")))?;
    if !status.success() {
        return Err(err(format!(
            "ffmpeg failed for {}",
            output.file_name().and_then(|s| s.to_str()).unwrap_or("?")
        )));
    }
    Ok(())
}

#[tauri::command]
fn path_to_asset_url(path: String) -> AppResult<String> {
    // Frontend uses convertFileSrc; this helper validates the path exists.
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(err("file does not exist"));
    }
    Ok(path)
}

#[tauri::command]
fn open_in_finder(app: AppHandle, path: String) -> AppResult<()> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| err(format!("open path: {e}")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            api_base: Mutex::new(DEFAULT_API_BASE.to_string()),
        })
        .invoke_handler(tauri::generate_handler![
            get_api_base,
            set_api_base,
            get_session_token,
            save_session_token,
            clear_session_token,
            login_with_google,
            ensure_media_cached,
            get_cache_stats,
            clear_media_cache,
            export_clips,
            path_to_asset_url,
            open_in_finder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trip Montage");
}
