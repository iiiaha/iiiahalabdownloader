use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
}

/// 사이트 매니페스트(https://iiiahalab.com/downloader/latest.json) 를 비차단으로 조회.
/// 새 버전 있으면 UpdateInfo 반환. 없거나 매니페스트 부재(404 등)면 None.
/// 어떤 에러든 silent failure — 사용자에게 빈 결과로 보임.
#[tauri::command]
pub async fn cmd_check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!("updater unavailable: {}", e);
            return Ok(None);
        }
    };
    match updater.check().await {
        Ok(Some(u)) => Ok(Some(UpdateInfo {
            version: u.version.clone(),
            current_version: u.current_version.clone(),
            body: u.body.clone(),
        })),
        Ok(None) => Ok(None),
        Err(e) => {
            tracing::warn!("updater check failed: {}", e);
            Ok(None)
        }
    }
}

/// 새 버전이 있으면 다운로드 → minisign 검증 → 적용 → 앱 재시작.
/// 사용자가 토스트의 "Update now" 클릭 시 호출.
#[tauri::command]
pub async fn cmd_apply_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}
