mod commands;

use commands::app::*;
use commands::reminders::*;
use commands::window::*;
use commands::oauth::*;
use tauri::{Manager, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_nspanel::init());

    
    builder
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Handle deep link URL passed to running instance
            if let Some(url) = argv.iter().find(|arg| arg.starts_with("redddo://")) {
                log::info!("[Deep Link] Received URL from new instance: {}", url);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("deep-link-received", url);
                    let _ = window.set_focus();
                }
            }
        }))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            
            // Handle deep link URLs on app startup
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    for url in urls {
                        log::info!("[Deep Link] Startup URL: {}", url.as_str());
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("deep-link-received", url.as_str());
                        }
                    }
                }
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App commands
            get_app_version,
            // Reminders commands
            fetch_reminders_lists,
            fetch_reminders_tasks,
            update_reminders_status,
            update_reminders_title,
            update_reminders_notes,
            delete_reminders_task,
            create_reminders_task,
            // Window commands
            window_minimize,
            window_maximize,
            window_close,
            enter_focus_mode,
            open_focus_window,
            exit_focus_mode,
            set_focus_window_size,
            set_focus_window_height,
            enter_fullscreen_focus,
            enter_fullscreen_focus_handoff,
            exit_fullscreen_focus_handoff,
            exit_fullscreen_focus_to_home,
            refresh_main_window,
            task_updated,
            focus_status_changed,
            // OAuth commands
            start_basecamp_auth,
            handle_oauth_callback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
