use crate::error::{AppError, AppResult};
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 한 SketchUp 버전(예: SketchUp 2025)의 설치 위치와
/// 그 안에 깔린 iiiaha_* 익스텐션의 버전 맵.
#[derive(Debug, Clone, Serialize)]
pub struct SketchUpInstall {
    /// 폴더 이름 그대로. 예: "SketchUp 2025"
    pub label: String,
    /// 폴더에서 추출한 4자리 숫자. 예: "2025"
    pub year: String,
    /// {plugins_dir}. 예: "C:\Users\LEE\AppData\Roaming\SketchUp\SketchUp 2025\SketchUp\Plugins"
    pub plugins_dir: PathBuf,
    /// slug → installed version. iiiaha_{slug}.rb 의 PLUGIN_VERSION 상수에서 추출.
    pub installed: HashMap<String, String>,
    /// 버전 추출 실패한 익스텐션 slug 목록 ('unknown' 상태로 표시).
    pub installed_unknown: Vec<String>,
}

/// 사용자 PC의 SketchUp 루트 디렉토리. OS별로 다름.
/// Windows: %APPDATA%\SketchUp\
/// macOS:  ~/Library/Application Support/
fn sketchup_parent() -> AppResult<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = dirs::config_dir().ok_or_else(|| {
            AppError::Msg("Could not resolve %APPDATA%".to_string())
        })?;
        Ok(appdata.join("SketchUp"))
    }
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or_else(|| {
            AppError::Msg("Could not resolve home directory".to_string())
        })?;
        Ok(home.join("Library").join("Application Support"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(AppError::Msg(
            "Unsupported OS for SketchUp detection".to_string(),
        ))
    }
}

/// SU 폴더 패턴: "SketchUp 20\d\d"
fn su_folder_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^SketchUp 20\d\d$").expect("static regex"))
}

/// iiiaha_<slug>.rb 패턴 — 캡쳐: slug
fn iiiaha_loader_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^iiiaha_([a-zA-Z0-9_]+)\.rb$").expect("static regex"))
}

/// PLUGIN_VERSION = '1.2.3' (single 또는 double quote)
fn plugin_version_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]"#).expect("static regex")
    })
}

/// 한 SU 설치의 Plugins 폴더에서 iiiaha_*.rb 들을 스캔해 버전 맵을 만든다.
fn scan_plugins(plugins_dir: &Path) -> AppResult<(HashMap<String, String>, Vec<String>)> {
    let mut installed = HashMap::new();
    let mut unknown = Vec::new();

    let read_dir = match std::fs::read_dir(plugins_dir) {
        Ok(rd) => rd,
        Err(_) => return Ok((installed, unknown)),
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s,
            None => continue,
        };
        let slug = match iiiaha_loader_re().captures(file_name) {
            Some(c) => c.get(1).unwrap().as_str().to_string(),
            None => continue,
        };
        match extract_version_from_loader(&path) {
            Some(ver) => {
                installed.insert(slug, ver);
            }
            None => unknown.push(slug),
        }
    }

    Ok((installed, unknown))
}

/// loader .rb 파일 첫 30줄에서 PLUGIN_VERSION 상수 값을 정규식으로 뽑아낸다.
fn extract_version_from_loader(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    for line in content.lines().take(30) {
        if let Some(c) = plugin_version_re().captures(line) {
            return Some(c.get(1)?.as_str().to_string());
        }
    }
    None
}

/// SketchUp 부모 폴더에서 SketchUp 20XX 형태 폴더를 모두 찾아
/// 각각의 Plugins 폴더와 iiiaha_* 설치 상태를 수집한다.
/// 버전 번호 하드코딩 없음 — 2026/2027/... 모두 자동 인식.
pub fn scan_installations() -> AppResult<Vec<SketchUpInstall>> {
    let parent = sketchup_parent()?;
    if !parent.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    for entry in std::fs::read_dir(&parent)?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let label = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s,
            None => continue,
        };
        if !su_folder_re().is_match(label) {
            continue;
        }
        let year = label
            .strip_prefix("SketchUp ")
            .unwrap_or("")
            .to_string();

        let plugins_dir = path.join("SketchUp").join("Plugins");
        if !plugins_dir.exists() {
            continue;
        }

        let (installed, unknown) = scan_plugins(&plugins_dir)?;
        results.push(SketchUpInstall {
            label: label.to_string(),
            year,
            plugins_dir,
            installed,
            installed_unknown: unknown,
        });
    }

    // 최신 버전이 위로 오도록 (2025, 2024, 2023 ...)
    results.sort_by(|a, b| b.year.cmp(&a.year));
    Ok(results)
}

#[tauri::command]
pub fn cmd_scan_installations() -> AppResult<Vec<SketchUpInstall>> {
    scan_installations()
}
