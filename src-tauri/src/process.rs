use sysinfo::{ProcessesToUpdate, System};

/// SketchUp이 현재 실행 중인지 확인.
/// Win: SketchUp.exe / Mac: SketchUp (또는 SketchUp.app 안의 SketchUp 바이너리).
pub fn is_sketchup_running() -> bool {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        name == "sketchup.exe" || name == "sketchup"
    })
}

#[tauri::command]
pub fn cmd_is_sketchup_running() -> bool {
    is_sketchup_running()
}
