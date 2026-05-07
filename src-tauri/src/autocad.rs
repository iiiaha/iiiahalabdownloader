use crate::error::AppResult;
use encoding_rs::EUC_KR;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// AutoCAD 측 익스텐션은 SketchUp 처럼 호스트 버전별로 폴더가 갈리지 않는다.
/// 모든 AutoCAD/LT 버전이 단일 폴더 %LOCALAPPDATA%\{slug}\ 를 공유.
/// 결과적으로 "한 슬러그 = 한 설치 상태" — 호스트 버전 차원의 enumerate 불필요.
#[derive(Debug, Clone, Serialize)]
pub struct AutoCadInstall {
    /// %LOCALAPPDATA% (Windows 전용 — Mac 에선 빈 PathBuf)
    pub localappdata: PathBuf,
    /// slug → installed version. 폴더 안 어떤 .lsp 에서든 (setq *{slug}:version* "X.Y.Z") 매치되면 채워짐.
    pub installed: HashMap<String, String>,
    /// 폴더는 있는데 버전이 안 읽히는 슬러그.
    pub installed_unknown: Vec<String>,
}

/// %LOCALAPPDATA% 위치. macOS 에선 캐드 지원 자체를 의미 없게 처리(빈 결과).
fn localappdata() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        dirs::data_local_dir()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn version_re_for(slug: &str) -> Regex {
    // (setq *{slug}:version* "X.Y.Z")  — 공백 다양성 허용
    let pattern = format!(
        r#"\(\s*setq\s+\*{slug}:version\*\s+"([^"]+)"\s*\)"#,
        slug = regex::escape(slug)
    );
    Regex::new(&pattern).expect("static regex")
}

fn lsp_ext_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\.lsp$").expect("static regex"))
}

/// CP949(EUC-KR) 로 인코딩된 AutoLISP 파일을 안전하게 텍스트로 디코딩.
/// COMMON_RULES 에서 "UTF-8 로 읽으면 한글 망가짐" 명시되어 있어 EUC-KR 우선.
fn decode_lsp(bytes: &[u8]) -> String {
    let (cow, _, had_errors) = EUC_KR.decode(bytes);
    if had_errors {
        // EUC-KR 디코딩 실패 시 UTF-8 lossy 로 폴백 (영문/숫자 라인은 어차피 무관)
        return String::from_utf8_lossy(bytes).into_owned();
    }
    cow.into_owned()
}

/// `%LOCALAPPDATA%\{slug}\` 안의 .lsp 들을 훑어 첫 매치되는 버전을 반환.
fn find_version_in_folder(folder: &Path, slug: &str) -> Option<String> {
    let re = version_re_for(slug);
    let read_dir = std::fs::read_dir(folder).ok()?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s,
            None => continue,
        };
        if !lsp_ext_re().is_match(name) {
            continue;
        }
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let text = decode_lsp(&bytes);
        // 큰 파일 대비 — 첫 100KB 만 검색 (실제 .lsp 는 수십 KB 가 한계)
        let head = if text.len() > 100_000 {
            &text[..100_000]
        } else {
            &text[..]
        };
        if let Some(c) = re.captures(head) {
            return Some(c.get(1)?.as_str().to_string());
        }
    }
    None
}

/// 주어진 슬러그 목록(= 사이트의 platform=autocad 제품) 에 대해 로컬 설치 상태를 스캔.
/// `%LOCALAPPDATA%\{slug}\` 폴더가 없으면 미설치, 있는데 버전 못 읽으면 unknown.
pub fn scan_for_slugs(slugs: &[String]) -> AppResult<AutoCadInstall> {
    let mut installed = HashMap::new();
    let mut unknown = Vec::new();

    let parent = match localappdata() {
        Some(p) => p,
        None => {
            return Ok(AutoCadInstall {
                localappdata: PathBuf::new(),
                installed,
                installed_unknown: unknown,
            });
        }
    };

    for slug in slugs {
        let folder = parent.join(slug);
        if !folder.is_dir() {
            continue;
        }
        match find_version_in_folder(&folder, slug) {
            Some(ver) => {
                installed.insert(slug.clone(), ver);
            }
            None => unknown.push(slug.clone()),
        }
    }

    Ok(AutoCadInstall {
        localappdata: parent,
        installed,
        installed_unknown: unknown,
    })
}

/// AutoCAD 슬러그 한 개의 install/update — Inno Setup .exe 를 그대로 실행.
/// 마법사가 이미 자체적으로 캐드 실행 중 감지/경고 로직을 갖추고 있어
/// 우리 측에서 별도 silent 플래그 없이 사용자에게 그대로 노출한다.
/// status() 로 종료 코드까지 기다린 뒤 반환 — 종료 후 프론트가 재스캔.
pub async fn run_installer(exe_path: &Path) -> AppResult<i32> {
    let status = tokio::process::Command::new(exe_path).status().await?;
    Ok(status.code().unwrap_or(-1))
}

#[tauri::command]
pub fn cmd_scan_autocad(slugs: Vec<String>) -> AppResult<AutoCadInstall> {
    scan_for_slugs(&slugs)
}
