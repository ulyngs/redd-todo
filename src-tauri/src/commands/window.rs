use tauri::{command, Emitter, LogicalPosition, Manager, WebviewUrl};
use tauri::WebviewWindowBuilder;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "macos")]
use tauri_nspanel::{CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask};

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(FocusModePanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: true,
            needs_panel_to_become_key: true,
            accepts_first_responder: true,
            is_floating_panel: true
        }
    })
}

fn focus_window_label(task_id: &str) -> String {
    // Tauri labels should avoid special characters.
    let safe = urlencoding::encode(task_id).replace('%', "_");
    format!("focus-{safe}")
}

fn fullscreen_focus_window_label(task_id: &str) -> String {
    let safe = urlencoding::encode(task_id).replace('%', "_");
    format!("focusfs-{safe}")
}

#[derive(Clone, Copy)]
struct FocusWindowGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn fullscreen_handoff_geometry() -> &'static Mutex<HashMap<String, FocusWindowGeometry>> {
    static STORE: OnceLock<Mutex<HashMap<String, FocusWindowGeometry>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn position_focus_window(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    anchor_left: Option<f64>,
    anchor_right: Option<f64>,
    anchor_top: Option<f64>,
) {
    let offset_step = 28.0;
    let focus_count = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("focus-"))
        .count()
        .saturating_sub(1) as f64;
    let cascade = focus_count * offset_step;

    if let Some(main_window) = app.get_webview_window("main") {
        if let Ok(main_pos) = main_window.outer_position() {
            let scale = main_window.scale_factor().unwrap_or(1.0);
            let main_x = (main_pos.x as f64) / scale;
            let main_y = (main_pos.y as f64) / scale;
            let window_width = window
                .outer_size()
                .ok()
                .map(|size| (size.width as f64) / scale)
                .unwrap_or(320.0);

            if let (Some(left), Some(right)) = (anchor_left, anchor_right) {
                // Anchor values are sent as coordinates relative to the main window
                // viewport to avoid cross-monitor/screen-coordinate mismatches.
                let left_abs = main_x + left;
                let right_abs = main_x + right;
                let mut x = left_abs + 12.0;

                if let Ok(Some(monitor)) = main_window.current_monitor() {
                    let monitor_pos = monitor.position().to_logical::<f64>(scale);
                    let monitor_size = monitor.size().to_logical::<f64>(scale);
                    let min_x = monitor_pos.x;
                    let max_x = monitor_pos.x + monitor_size.width - window_width;

                    if x > max_x {
                        x = right_abs - 12.0 - window_width;
                    }

                    x = x.clamp(min_x, max_x.max(min_x));
                } else if x + window_width > right_abs + 12.0 {
                    // Without monitor bounds we can still enforce the requested fallback.
                    x = right_abs - 12.0 - window_width;
                }

                let y = anchor_top.map(|top| main_y + top).unwrap_or(main_y + 32.0) + cascade;
                let _ = window.set_position(LogicalPosition::new(x, y));
                return;
            }

            let x = main_x + 32.0 + cascade;
            let y = main_y + 32.0 + cascade;
            let _ = window.set_position(LogicalPosition::new(x, y));
            return;
        }
    }

    let _ = window.set_position(LogicalPosition::new(120.0 + cascade, 120.0 + cascade));
}

/// Minimize the main window
#[command]
pub fn window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// Maximize or unmaximize the main window
#[command]
pub fn window_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// Close the window
#[command]
pub fn window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// Open focus mode in a separate window.
#[command]
pub fn open_focus_window(
    app: tauri::AppHandle,
    task_id: String,
    task_name: String,
    duration: Option<f64>,
    time_spent: Option<f64>,
    anchor_left: Option<f64>,
    anchor_right: Option<f64>,
    anchor_top: Option<f64>,
    preserve_window_geometry: Option<bool>,
) -> Result<(), String> {
    let label = focus_window_label(&task_id);
    let preserve_window_geometry = preserve_window_geometry.unwrap_or(false);

    #[cfg(target_os = "macos")]
    {
        let panel_behavior = CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .full_screen_auxiliary()
            .ignores_cycle();

        // Check if window already exists
        if let Some(window) = app.get_webview_window(&label) {
            // Drive visibility from the panel handle first. Mixing only WebviewWindow
            // APIs can lose some NSPanel-specific behavior across space transitions.
            if let Ok(panel) = app.get_webview_panel(&label) {
                panel.show_and_make_key();
                panel.set_floating_panel(true);
                panel.set_level(PanelLevel::Floating.value());
                panel.set_collection_behavior(panel_behavior.value());
                panel.set_corner_radius(8.0);
                panel.order_front_regardless();
            }
            position_focus_window(&app, &window, anchor_left, anchor_right, anchor_top);
            
            // Emit event to the window with task data
            let _ = window.emit("enter-focus-mode", serde_json::json!({
                "taskId": task_id,
                "taskName": task_name,
                "duration": duration,
                "initialTimeSpent": time_spent.unwrap_or(0.0),
                "preserveWindowGeometry": preserve_window_geometry
            }));
            
            // Notify main window about focus status change
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.emit("focus-status-changed", serde_json::json!({
                    "activeTaskId": task_id,
                    "openedTaskId": task_id
                }));
            }
            
            return Ok(());
        }
        
        // Build the URL with query params
        let url = format!("index.html?focus=1&taskId={}&taskName={}&duration={}&timeSpent={}",
            urlencoding::encode(&task_id),
            urlencoding::encode(&task_name),
            duration.unwrap_or(0.0),
            time_spent.unwrap_or(0.0)
        );

        // Build a true NSPanel for reliable fullscreen overlay behavior.
        let panel = PanelBuilder::<_, FocusModePanel>::new(&app, &label)
            .url(WebviewUrl::App(url.into()))
            .level(PanelLevel::Floating)
            .floating(true)
            .hides_on_deactivate(false)
            .movable_by_window_background(true)
            .collection_behavior(panel_behavior)
            .style_mask(StyleMask::empty().borderless().nonactivating_panel())
            .corner_radius(8.0)
            .transparent(true)
            .with_window(|window| {
                window
                    .decorations(false)
                    .resizable(true)
                    .inner_size(320.0, 48.0)
            })
            .build()
            .map_err(|e| e.to_string())?;

        panel.show_and_make_key();
        panel.order_front_regardless();

        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            position_focus_window(&app, &window, anchor_left, anchor_right, anchor_top);
            if preserve_window_geometry {
                let _ = window.emit("enter-focus-mode", serde_json::json!({
                    "taskId": task_id,
                    "taskName": task_name,
                    "duration": duration,
                    "initialTimeSpent": time_spent.unwrap_or(0.0),
                    "preserveWindowGeometry": true
                }));
            }
        }
        
        // Notify main window about focus status change
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": task_id,
                "openedTaskId": task_id
            }));
        }
        
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_always_on_top(true);
            position_focus_window(&app, &window, anchor_left, anchor_right, anchor_top);
            let _ = window.show();
            let _ = window.set_focus();

            let _ = window.emit("enter-focus-mode", serde_json::json!({
                "taskId": task_id,
                "taskName": task_name,
                "duration": duration,
                "initialTimeSpent": time_spent.unwrap_or(0.0),
                "preserveWindowGeometry": preserve_window_geometry
            }));

            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.emit("focus-status-changed", serde_json::json!({
                    "activeTaskId": task_id,
                    "openedTaskId": task_id
                }));
            }

            return Ok(());
        }

        // Keep non-macOS focus windows on a simple route and send the task
        // payload via events to avoid Windows URL resolution edge cases.
        let url = "index.html?focus=1".to_string();

        let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
            .zoom_hotkeys_enabled(true)
            .always_on_top(true)
            .decorations(false)
            .resizable(true)
            .inner_size(320.0, 48.0)
            .build()
            .map_err(|e| e.to_string())?;

        position_focus_window(&app, &window, anchor_left, anchor_right, anchor_top);
        let _ = window.show();
        let _ = window.set_focus();
        let payload = serde_json::json!({
            "taskId": task_id,
            "taskName": task_name,
            "duration": duration,
            "initialTimeSpent": time_spent.unwrap_or(0.0),
            "preserveWindowGeometry": preserve_window_geometry
        });
        let _ = window.emit("enter-focus-mode", payload.clone());

        // The first emit can race initial JS listener setup on some platforms.
        // Retry shortly after creation to ensure focus UI is initialized.
        {
            let app_handle = app.clone();
            let label_for_emit = label.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(160));
                if let Some(retry_window) = app_handle.get_webview_window(&label_for_emit) {
                    let _ = retry_window.emit("enter-focus-mode", payload);
                }
            });
        }

        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": task_id,
                "openedTaskId": task_id
            }));
        }

        Ok(())
    }
}

/// Exit focus mode and hide/close the dedicated focus window.
#[command]
pub fn exit_focus_mode(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: Option<String>,
    _width: Option<f64>,
    _height: Option<f64>,
) -> Result<(), String> {
    if let Some(id) = &task_id {
        if let Ok(mut store) = fullscreen_handoff_geometry().lock() {
            store.remove(id);
        }
    }

    let target_label = if let Some(id) = &task_id {
        focus_window_label(id)
    } else if window.label().starts_with("focus-") {
        window.label().to_string()
    } else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    {
        if window.label().starts_with("focusfs-") {
            let _ = window.close();
        }

        // Hide panel instead of closing NSPanel-backed window.
        // Closing can throw Objective-C exceptions across FFI boundaries.
        if let Ok(panel) = app.get_webview_panel(&target_label) {
            panel.hide();
        }
        if let Some(window) = app.get_webview_window(&target_label) {
            let _ = window.hide();
        }
        
        // Notify main window that focus mode ended and bring it to front
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": Option::<String>::None,
                "closedTaskId": task_id
            }));
            // Bring main window to front
            let _ = main_window.set_focus();
        }
        
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window(&target_label) {
            let _ = window.close();
        }

        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": Option::<String>::None,
                "closedTaskId": task_id
            }));
            let _ = main_window.set_focus();
        }

        Ok(())
    }
}

/// Set focus window size (width only, height stays at 48)
#[command]
pub fn set_focus_window_size(window: tauri::WebviewWindow, width: f64) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    let _ = window.set_fullscreen(false);

    let _ = window.set_size(tauri::LogicalSize::new(width, 48.0));
    Ok(())
}

/// Set focus window height (for notes panel)
#[command]
pub fn set_focus_window_height(window: tauri::WebviewWindow, height: f64) -> Result<(), String> {
    if let Ok(size) = window.outer_size() {
        let scale = window.scale_factor().unwrap_or(1.0);
        let current_width = (size.width as f64) / scale;
        let _ = window.set_size(tauri::LogicalSize::new(current_width, height));
    }
    Ok(())
}

/// Enter fullscreen focus mode
#[command]
pub fn enter_fullscreen_focus(window: tauri::WebviewWindow) -> Result<(), String> {
    let _ = window.set_resizable(true);
    let _ = window.set_always_on_top(true);

    #[cfg(target_os = "macos")]
    {
        // Avoid native fullscreen on NSPanel-backed focus windows.
        // Toggling style masks can crash WebKit observer bookkeeping on macOS.
        let scale = window.scale_factor().unwrap_or(1.0);
        if let Ok(Some(monitor)) = window.current_monitor() {
            let pos = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            let _ = window.set_position(LogicalPosition::new(pos.x, pos.y));
            let _ = window.set_size(tauri::LogicalSize::new(size.width, size.height));
        } else {
            // Safe fallback if monitor info is unavailable.
            let _ = window.set_position(LogicalPosition::new(0.0, 0.0));
            let _ = window.set_size(tauri::LogicalSize::new(1440.0, 900.0));
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_fullscreen(true);
    }

    Ok(())
}

#[command]
pub fn enter_fullscreen_focus_handoff(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    task_name: String,
    duration: Option<f64>,
    time_spent: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let fullscreen_label = fullscreen_focus_window_label(&task_id);
        let panel_label = focus_window_label(&task_id);
        let scale = window.scale_factor().unwrap_or(1.0);
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            let geometry = FocusWindowGeometry {
                x: (pos.x as f64) / scale,
                y: (pos.y as f64) / scale,
                width: (size.width as f64) / scale,
                height: (size.height as f64) / scale,
            };
            if let Ok(mut store) = fullscreen_handoff_geometry().lock() {
                store.insert(task_id.clone(), geometry);
            }
        }

        if app.get_webview_window(&fullscreen_label).is_none() {
            let url = format!(
                "index.html?focus=1&fullscreen=1&taskId={}&taskName={}&duration={}&timeSpent={}",
                urlencoding::encode(&task_id),
                urlencoding::encode(&task_name),
                duration.unwrap_or(0.0),
                time_spent.unwrap_or(0.0)
            );

            let fullscreen_window =
                WebviewWindowBuilder::new(&app, &fullscreen_label, WebviewUrl::App(url.into()))
                    .zoom_hotkeys_enabled(true)
                    .always_on_top(true)
                    .decorations(false)
                    .resizable(true)
                    .fullscreen(true)
                    .build()
                    .map_err(|e| e.to_string())?;

            let _ = fullscreen_window.emit(
                "enter-focus-mode",
                serde_json::json!({
                    "taskId": task_id,
                    "taskName": task_name,
                    "duration": duration,
                    "initialTimeSpent": time_spent.unwrap_or(0.0)
                }),
            );
            let _ = fullscreen_window.set_focus();
        } else if let Some(fullscreen_window) = app.get_webview_window(&fullscreen_label) {
            let _ = fullscreen_window.set_fullscreen(true);
            let _ = fullscreen_window.show();
            let _ = fullscreen_window.set_focus();
            let _ = fullscreen_window.emit(
                "enter-focus-mode",
                serde_json::json!({
                    "taskId": task_id,
                    "taskName": task_name,
                    "duration": duration,
                    "initialTimeSpent": time_spent.unwrap_or(0.0)
                }),
            );
        }

        if let Ok(panel) = app.get_webview_panel(&panel_label) {
            panel.hide();
        }
        let _ = window.hide();
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = window;
        let _ = task_id;
        let _ = task_name;
        let _ = duration;
        let _ = time_spent;
        Ok(())
    }
}

#[command]
pub fn exit_fullscreen_focus_handoff(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    task_name: String,
    duration: Option<f64>,
    time_spent: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        open_focus_window(
            app.clone(),
            task_id.clone(),
            task_name,
            duration,
            time_spent,
            None,
            None,
            None,
            Some(true),
        )?;

        if let Ok(mut store) = fullscreen_handoff_geometry().lock() {
            if let Some(geometry) = store.remove(&task_id) {
                if let Some(restored_window) = app.get_webview_window(&focus_window_label(&task_id)) {
                    let _ = restored_window.set_size(tauri::LogicalSize::new(geometry.width, geometry.height));
                    let _ = restored_window.set_position(LogicalPosition::new(geometry.x, geometry.y));
                }
            }
        }

        if window.label().starts_with("focusfs-") {
            let _ = window.close();
        } else if let Some(fullscreen_window) = app.get_webview_window(&fullscreen_focus_window_label(&task_id)) {
            let _ = fullscreen_window.close();
        }
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = window;
        let _ = task_id;
        let _ = task_name;
        let _ = duration;
        let _ = time_spent;
        Ok(())
    }
}

#[command]
pub fn exit_fullscreen_focus_to_home(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(mut store) = fullscreen_handoff_geometry().lock() {
            store.remove(&task_id);
        }

        if window.label().starts_with("focusfs-") {
            let _ = window.close();
        } else if let Some(fullscreen_window) = app.get_webview_window(&fullscreen_focus_window_label(&task_id)) {
            let _ = fullscreen_window.close();
        }

        let target_label = focus_window_label(&task_id);
        if let Ok(panel) = app.get_webview_panel(&target_label) {
            panel.hide();
        }
        if let Some(panel_window) = app.get_webview_window(&target_label) {
            let _ = panel_window.hide();
        }

        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": Option::<String>::None,
                "closedTaskId": task_id
            }));
            let _ = main_window.set_focus();
        }
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = window;
        let _ = task_id;
        Ok(())
    }
}

/// Emit refresh event to main window (for panel window to trigger main refresh)
#[command]
pub fn refresh_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.emit("refresh-data", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Emit task update to all windows
#[command]
pub fn task_updated(app: tauri::AppHandle, task_id: String, text: String) -> Result<(), String> {
    app.emit("task-updated", serde_json::json!({ "taskId": task_id, "text": text }))
        .map_err(|e| e.to_string())
}

/// Emit focus status changed to all windows
#[command]
pub fn focus_status_changed(app: tauri::AppHandle, active_task_id: Option<String>) -> Result<(), String> {
    app.emit("focus-status-changed", serde_json::json!({ "activeTaskId": active_task_id }))
        .map_err(|e| e.to_string())
}

// Keep the old enter_focus_mode for backwards compatibility (delegates to open_focus_window on macOS)
#[command]
pub fn enter_focus_mode(_app: tauri::AppHandle) -> Result<(), String> {
    // Legacy no-op: focus mode is opened through open_focus_window with task payload.
    Ok(())
}
