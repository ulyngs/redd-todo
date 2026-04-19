mod commands;

use commands::app::*;
use commands::reminders::*;
use commands::window::*;
use commands::oauth::*;
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
const ZOOM_STEP: f64 = 0.1;
#[cfg(target_os = "macos")]
const ZOOM_MIN: f64 = 0.5;
#[cfg(target_os = "macos")]
const ZOOM_MAX: f64 = 2.5;

/// Adjust the main window's webview zoom by the given delta (clamped).
#[cfg(target_os = "macos")]
fn adjust_main_zoom(app: &tauri::AppHandle, delta: f64) {
    let Some(window) = app.get_webview_window("main") else { return };
    let current = read_main_zoom(app).unwrap_or(1.0);
    let next = (current + delta).clamp(ZOOM_MIN, ZOOM_MAX);
    let _ = window.set_zoom(next);
    write_main_zoom(app, next);
}

#[cfg(target_os = "macos")]
fn set_main_zoom(app: &tauri::AppHandle, value: f64) {
    let Some(window) = app.get_webview_window("main") else { return };
    let value = value.clamp(ZOOM_MIN, ZOOM_MAX);
    let _ = window.set_zoom(value);
    write_main_zoom(app, value);
}

/// Persist + read zoom level so it survives restarts. Stored in the Tauri
/// app config dir as a tiny JSON file.
#[cfg(target_os = "macos")]
fn zoom_state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("zoom.txt"))
}

#[cfg(target_os = "macos")]
fn read_main_zoom(app: &tauri::AppHandle) -> Option<f64> {
    let path = zoom_state_path(app)?;
    let raw = std::fs::read_to_string(path).ok()?;
    raw.trim().parse::<f64>().ok()
}

#[cfg(target_os = "macos")]
fn write_main_zoom(app: &tauri::AppHandle, value: f64) {
    let Some(path) = zoom_state_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, format!("{value}"));
}

/// Open a URL (https, mailto, etc.) in the user's default handler.
#[cfg(target_os = "macos")]
fn open_url(_app: &tauri::AppHandle, url: &str) {
    if let Err(e) = open::that_detached(url) {
        log::warn!("Failed to open {url}: {e}");
    }
}

/// Copy every file/subdirectory from `src` into `dst` without overwriting any
/// file that already exists at the destination. Existing directories are
/// merged into; existing files are left alone.
fn copy_dir_non_destructive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_non_destructive(&src_path, &dst_path)?;
        } else if !dst_path.exists() {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Before v2.4.1 the Tauri app identifier was `com.redd.todo`. We renamed it
/// to `com.redd.do` in the v2.4.0 rebrand, which moved the per-user data dir
/// to a new location (e.g. `%APPDATA%\com.redd.do\` on Windows,
/// `~/Library/Application Support/com.redd.do/` on macOS). On first launch of
/// the renamed build, copy the old tree in so existing users' tasks survive.
/// Safe to leave in place indefinitely — guarded by a marker file.
fn migrate_legacy_identifier_data(app: &tauri::AppHandle) {
    let resolver = app.path();
    let targets = [
        resolver.app_data_dir().ok(),
        resolver.app_config_dir().ok(),
        resolver.app_local_data_dir().ok(),
    ];
    for new_dir in targets.into_iter().flatten() {
        let Some(parent) = new_dir.parent() else { continue };
        let old_dir = parent.join("com.redd.todo");
        if old_dir == new_dir || !old_dir.exists() {
            continue;
        }
        let marker = new_dir.join(".migrated-from-com-redd-todo");
        if marker.exists() {
            continue;
        }
        if let Err(e) = std::fs::create_dir_all(&new_dir) {
            log::warn!("Failed to create {new_dir:?}: {e}");
            continue;
        }
        match copy_dir_non_destructive(&old_dir, &new_dir) {
            Ok(()) => {
                log::info!("Migrated user data from {old_dir:?} into {new_dir:?}");
                if let Err(e) = std::fs::write(&marker, "") {
                    log::warn!("Failed to write migration marker {marker:?}: {e}");
                }
            }
            Err(e) => log::warn!("Failed to migrate {old_dir:?} -> {new_dir:?}: {e}"),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    
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
            migrate_legacy_identifier_data(app.handle());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // On Windows, remove native decorations so only the custom HTML title bar shows
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // On macOS, build a custom menu that includes Zoom In / Zoom Out
            // under the Window menu so users discover the keyboard shortcuts.
            // (Tauri's default menu doesn't expose them.)
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{
                    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder,
                    PredefinedMenuItem, SubmenuBuilder,
                };

                let app_handle = app.handle();

                let about_metadata = AboutMetadataBuilder::new()
                    .name(Some("ReDD Do"))
                    .version(Some(env!("CARGO_PKG_VERSION")))
                    .authors(Some(vec![
                        "The Reduce Digital Distraction Project".to_string(),
                    ]))
                    .comments(Some(
                        "Get back to that thing you meant to do.\n\n\
                        ReDD Do is a calm, distraction-free todo app with focus \
                        mode and time tracking. Your data lives on your device — \
                        nothing is collected.\n\n\
                        Built by the Reduce Digital Distraction Project, a \
                        not-for-profit that creates insights & open-source digital \
                        focus tools for everyone to thrive in the digital world, \
                        in collaboration with researchers at the University of \
                        Oxford and the University of Maastricht.",
                    ))
                    .copyright(Some("© 2026 Reduce Digital Distraction Ltd"))
                    .website(Some("https://reddfocus.org"))
                    .website_label(Some("reddfocus.org"))
                    .license(Some("CC BY-NC-ND 3.0"))
                    .build();

                let about_item = PredefinedMenuItem::about(
                    app_handle,
                    Some("About ReDD Do"),
                    Some(about_metadata),
                )?;

                let app_submenu = SubmenuBuilder::new(app_handle, "ReDD Do")
                    .item(&about_item)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(app_handle, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                // Tauri/muda parses `+` as the separator in accelerator strings,
                // so `CmdOrCtrl+=` leaves an empty key token and macOS ends up
                // displaying a garbled shortcut (⌘`). Use the explicit key
                // codes instead.
                let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In")
                    .accelerator("CmdOrCtrl+Equal")
                    .build(app_handle)?;
                let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                    .accelerator("CmdOrCtrl+Minus")
                    .build(app_handle)?;
                let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Actual Size")
                    .accelerator("CmdOrCtrl+0")
                    .build(app_handle)?;

                let window_submenu = SubmenuBuilder::new(app_handle, "Window")
                    .minimize()
                    .separator()
                    .item(&zoom_in)
                    .item(&zoom_out)
                    .item(&zoom_reset)
                    .separator()
                    .close_window()
                    .build()?;

                let report_issue = MenuItemBuilder::with_id(
                    "help_report_issue",
                    "Report an issue",
                )
                .build(app_handle)?;
                let contact_us = MenuItemBuilder::with_id(
                    "help_contact_us",
                    "Contact us",
                )
                .build(app_handle)?;
                let about_redd = MenuItemBuilder::with_id(
                    "help_about_redd",
                    "About the ReDD Project",
                )
                .build(app_handle)?;

                let help_submenu = SubmenuBuilder::new(app_handle, "Help")
                    .item(&report_issue)
                    .item(&contact_us)
                    .item(&about_redd)
                    .build()?;

                let menu = MenuBuilder::new(app_handle)
                    .items(&[&app_submenu, &edit_submenu, &window_submenu, &help_submenu])
                    .build()?;

                app.set_menu(menu)?;

                app.on_menu_event(move |app, event| match event.id().as_ref() {
                    "zoom_in" => adjust_main_zoom(app, ZOOM_STEP),
                    "zoom_out" => adjust_main_zoom(app, -ZOOM_STEP),
                    "zoom_reset" => set_main_zoom(app, 1.0),
                    "help_report_issue" => open_url(app, "https://github.com/ulyngs/redd-todo/issues"),
                    "help_contact_us" => open_url(app, "mailto:team@reddfocus.org"),
                    "help_about_redd" => open_url(app, "https://reddfocus.org"),
                    _ => {}
                });

                // Restore last-saved zoom level on startup.
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(saved) = read_main_zoom(app.handle()) {
                        let _ = window.set_zoom(saved.clamp(ZOOM_MIN, ZOOM_MAX));
                    }
                }
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
            open_reminders_privacy_settings,
            // Window commands
            window_minimize,
            window_maximize,
            window_close,
            enter_focus_mode,
            open_focus_window,
            exit_focus_mode,
            set_focus_window_size,
            set_focus_window_height,
            set_window_bounds,
            enter_fullscreen_focus,
            exit_fullscreen_focus,
            enter_fullscreen_focus_handoff,
            exit_fullscreen_focus_handoff,
            exit_fullscreen_focus_to_home,
            refresh_main_window,
            task_updated,
            focus_status_changed,
            set_focus_mode_window_state,
            // OAuth commands
            start_basecamp_auth,
            handle_oauth_callback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
