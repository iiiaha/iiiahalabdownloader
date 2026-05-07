use crate::api;
use crate::error::{AppError, AppResult};
use std::path::PathBuf;

/// 로컬 캐시 루트. ~/AppData/Local/iiiahalab-downloader/cache/  (Win)
/// ~/Library/Caches/iiiahalab-downloader/cache/ (Mac)
fn cache_dir() -> AppResult<PathBuf> {
    let base = dirs::cache_dir()
        .ok_or_else(|| AppError::Msg("Could not resolve cache dir".to_string()))?;
    Ok(base.join("iiiahalab-downloader").join("cache"))
}

fn cache_path(slug: &str, version: &str) -> AppResult<PathBuf> {
    let safe_ver = version.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-', "_");
    Ok(cache_dir()?.join(format!("{}-v{}.rbz", slug, safe_ver)))
}

/// .rbz를 로컬 캐시에서 가져오거나, 없으면 사이트에서 받아 저장 후 경로 반환.
/// 모든 유저가 동일한 파일을 받으므로 slug+version 단위로 캐시 안전.
pub async fn get_or_download(slug: &str, version: &str) -> AppResult<PathBuf> {
    let path = cache_path(slug, version)?;
    if path.exists() {
        return Ok(path);
    }
    let bytes = api::download_rbz(slug).await?;
    let dir = cache_dir()?;
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&path, bytes)?;
    Ok(path)
}

/// 캐시 폴더 통째로 비우기 (트러블슈팅용, 현재 UI 비노출).
pub fn clear() -> AppResult<()> {
    let dir = cache_dir()?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

/// 한 슬러그의 캐시 파일 중 keep_version 이외의 모든 .rbz 를 삭제.
/// install 성공 후 자동 호출 → 옛 버전 .rbz 가 디스크에 쌓이지 않도록.
pub fn cleanup_old_versions(slug: &str, keep_version: &str) -> AppResult<()> {
    let dir = cache_dir()?;
    if !dir.exists() {
        return Ok(());
    }
    let safe_keep = keep_version
        .replace(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-', "_");
    let keep_name = format!("{}-v{}.rbz", slug, safe_keep);
    let prefix = format!("{}-v", slug);

    for entry in std::fs::read_dir(&dir)?.flatten() {
        let name = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        if !name.starts_with(&prefix) || !name.ends_with(".rbz") {
            continue;
        }
        if name == keep_name {
            continue;
        }
        let path = entry.path();
        if path.is_file() {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
}

/// 캐시 폴더 안의 .rbz 파일 수와 합계 바이트(설정 화면 표시용).
pub fn stats() -> AppResult<(usize, u64)> {
    let dir = cache_dir()?;
    if !dir.exists() {
        return Ok((0, 0));
    }
    let mut count = 0usize;
    let mut bytes = 0u64;
    for entry in std::fs::read_dir(&dir)?.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                count += 1;
                bytes += meta.len();
            }
        }
    }
    Ok((count, bytes))
}

#[tauri::command]
pub fn cmd_clear_cache() -> AppResult<()> {
    clear()
}

#[tauri::command]
pub fn cmd_cache_stats() -> AppResult<(usize, u64)> {
    stats()
}
