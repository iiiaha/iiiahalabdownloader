mod api;
mod cache;
mod error;
mod installer;
mod process;
mod sketchup;
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            api::cmd_fetch_products,
            sketchup::cmd_scan_installations,
            process::cmd_is_sketchup_running,
            installer::cmd_install_extension,
            installer::cmd_uninstall_extension,
            cache::cmd_clear_cache,
            cache::cmd_cache_stats,
            updater::cmd_check_update,
            updater::cmd_apply_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
