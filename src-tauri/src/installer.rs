use crate::autocad;
use crate::cache;
use crate::error::{AppError, AppResult};
use crate::process;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// uninstall + install 결과 요약. 한 SU 버전당 한 건.
#[derive(Debug, Clone, Serialize)]
pub struct InstallReport {
    pub plugins_dir: String,
    pub uninstalled: bool,
    pub installed: bool,
}

/// {plugins_dir}/iiiaha_{slug}.rb 와 {plugins_dir}/iiiaha_{slug}/ 만 정확히 삭제.
/// 그 외 어떤 경로도 절대 건드리지 않는다 (사용자가 직접 깐 비-iiiaha 플러그인 보호).
pub fn uninstall(plugins_dir: &Path, slug: &str) -> AppResult<bool> {
    let loader = plugins_dir.join(format!("iiiaha_{slug}.rb"));
    let body = plugins_dir.join(format!("iiiaha_{slug}"));
    let mut removed = false;
    if loader.exists() && loader.is_file() {
        fs::remove_file(&loader)?;
        removed = true;
    }
    if body.exists() && body.is_dir() {
        fs::remove_dir_all(&body)?;
        removed = true;
    }
    Ok(removed)
}

/// .rbz 안의 엔트리 중 root 레벨 iiiaha_{slug}.rb 와 iiiaha_{slug}/* 만 받아들이고
/// 그 외 경로는 거부 (zip-slip / 의도치 않은 파일 install 방지).
pub fn install_rbz(plugins_dir: &Path, slug: &str, rbz_path: &Path) -> AppResult<()> {
    let file = fs::File::open(rbz_path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    let allowed_loader = format!("iiiaha_{slug}.rb");
    let allowed_body_prefix = format!("iiiaha_{slug}/");

    fs::create_dir_all(plugins_dir)?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();

        // 정규화: 백슬래시 → 슬래시 (윈도우에서 만든 .rbz 대응)
        let normalized = name.replace('\\', "/");

        // .rbz 안의 엔트리는 root 레벨이어야 한다.
        if normalized != allowed_loader && !normalized.starts_with(&allowed_body_prefix) {
            return Err(AppError::Msg(format!(
                "Unexpected entry in rbz: {} (expected only {} or {}*)",
                normalized, allowed_loader, allowed_body_prefix
            )));
        }

        let dest = plugins_dir.join(&normalized);

        // 안전성 확인: dest 가 plugins_dir 밖으로 나가지 않는지 (zip-slip 방어)
        if !dest.starts_with(plugins_dir) {
            return Err(AppError::Msg(format!(
                "Refusing to extract outside plugins dir: {}",
                normalized
            )));
        }

        if entry.is_dir() || normalized.ends_with('/') {
            fs::create_dir_all(&dest)?;
        } else {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }

    Ok(())
}

/// 한 슬러그를 여러 SU plugins 폴더에 일괄 설치/업데이트.
/// 1) SketchUp 실행 중이면 거부.
/// 2) .rbz 캐시 (없으면 다운로드).
/// 3) 각 plugins_dir에 대해 uninstall → install.
pub async fn install_or_update(
    slug: String,
    version: String,
    plugins_dirs: Vec<PathBuf>,
) -> AppResult<Vec<InstallReport>> {
    if process::is_sketchup_running() {
        return Err(AppError::Msg(
            "SketchUp is currently running. Please close it first and try again.".to_string(),
        ));
    }

    let rbz_path = cache::get_or_download(&slug, &version, "rbz").await?;

    let mut reports = Vec::with_capacity(plugins_dirs.len());
    for plugins_dir in plugins_dirs {
        let uninstalled = uninstall(&plugins_dir, &slug)?;
        install_rbz(&plugins_dir, &slug, &rbz_path)?;
        reports.push(InstallReport {
            plugins_dir: plugins_dir.to_string_lossy().to_string(),
            uninstalled,
            installed: true,
        });
    }

    // 설치 성공 후, 같은 슬러그의 옛 버전 .rbz 캐시는 정리. 디스크에 한 슬러그당 최신 1개만 남김.
    let _ = cache::cleanup_old_versions(&slug, &version);

    Ok(reports)
}

#[tauri::command]
pub async fn cmd_install_extension(
    slug: String,
    version: String,
    plugins_dirs: Vec<String>,
) -> AppResult<Vec<InstallReport>> {
    let dirs: Vec<PathBuf> = plugins_dirs.into_iter().map(PathBuf::from).collect();
    install_or_update(slug, version, dirs).await
}

/// AutoCAD 익스텐션 설치/업데이트 — Inno Setup .exe 를 인터랙티브로 실행.
/// SketchUp 과 다르게 호스트 버전별 폴더가 없고 마법사가 레지스트리 등록까지 처리.
#[tauri::command]
pub async fn cmd_install_autocad(slug: String, version: String) -> AppResult<i32> {
    let exe_path = cache::get_or_download(&slug, &version, "exe").await?;
    let code = autocad::run_installer(&exe_path).await?;
    let _ = cache::cleanup_old_versions(&slug, &version);
    Ok(code)
}

#[tauri::command]
pub async fn cmd_uninstall_extension(
    slug: String,
    plugins_dirs: Vec<String>,
) -> AppResult<Vec<InstallReport>> {
    if process::is_sketchup_running() {
        return Err(AppError::Msg(
            "SketchUp is currently running. Please close it first and try again.".to_string(),
        ));
    }
    let mut reports = Vec::new();
    for d in plugins_dirs {
        let plugins_dir = PathBuf::from(&d);
        let uninstalled = uninstall(&plugins_dir, &slug)?;
        reports.push(InstallReport {
            plugins_dir: d,
            uninstalled,
            installed: false,
        });
    }
    Ok(reports)
}
