use tauri::{command, Emitter, Manager, WebviewUrl};
#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;
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
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let panel_behavior = CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .full_screen_auxiliary()
            .ignores_cycle();

        // Check if window already exists
        if let Some(window) = app.get_webview_window("focus") {
            // Drive visibility from the panel handle first. Mixing only WebviewWindow
            // APIs can lose some NSPanel-specific behavior across space transitions.
            if let Ok(panel) = app.get_webview_panel("focus") {
                panel.show_and_make_key();
                panel.set_floating_panel(true);
                panel.set_level(PanelLevel::Floating.value());
                panel.set_collection_behavior(panel_behavior.value());
                panel.order_front_regardless();
            }
            
            // Emit event to the window with task data
            let _ = window.emit("enter-focus-mode", serde_json::json!({
                "taskId": task_id,
                "taskName": task_name,
                "duration": duration,
                "initialTimeSpent": time_spent.unwrap_or(0.0)
            }));
            
            // Notify main window about focus status change
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.emit("focus-status-changed", serde_json::json!({
                    "activeTaskId": task_id
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
        let panel = PanelBuilder::<_, FocusModePanel>::new(&app, "focus")
            .url(WebviewUrl::App(url.into()))
            .level(PanelLevel::Floating)
            .floating(true)
            .hides_on_deactivate(false)
            .movable_by_window_background(true)
            .collection_behavior(panel_behavior)
            .style_mask(StyleMask::empty().borderless().nonactivating_panel())
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

        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
        }
        
        // Notify main window about focus status change
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": task_id
            }));
        }
        
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.set_always_on_top(true);
            let _ = window.show();
            let _ = window.set_focus();

            let _ = window.emit("enter-focus-mode", serde_json::json!({
                "taskId": task_id,
                "taskName": task_name,
                "duration": duration,
                "initialTimeSpent": time_spent.unwrap_or(0.0)
            }));

            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.emit("focus-status-changed", serde_json::json!({
                    "activeTaskId": task_id
                }));
            }

            return Ok(());
        }

        let url = format!(
            "index.html?focus=1&taskId={}&taskName={}&duration={}&timeSpent={}",
            urlencoding::encode(&task_id),
            urlencoding::encode(&task_name),
            duration.unwrap_or(0.0),
            time_spent.unwrap_or(0.0)
        );

        let window = WebviewWindowBuilder::new(&app, "focus", WebviewUrl::App(url.into()))
            .always_on_top(true)
            .decorations(false)
            .resizable(true)
            .inner_size(320.0, 48.0)
            .build()
            .map_err(|e| e.to_string())?;

        let _ = window.show();
        let _ = window.set_focus();

        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": task_id
            }));
        }

        Ok(())
    }
}

/// Exit focus mode and hide/close the dedicated focus window.
#[command]
pub fn exit_focus_mode(app: tauri::AppHandle, _width: Option<f64>, _height: Option<f64>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Hide panel instead of closing NSPanel-backed window.
        // Closing can throw Objective-C exceptions across FFI boundaries.
        if let Ok(panel) = app.get_webview_panel("focus") {
            panel.hide();
        }
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.hide();
        }
        
        // Notify main window that focus mode ended and bring it to front
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": Option::<String>::None
            }));
            // Bring main window to front
            let _ = main_window.set_focus();
        }
        
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.close();
        }

        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.emit("focus-status-changed", serde_json::json!({
                "activeTaskId": Option::<String>::None
            }));
            let _ = main_window.set_focus();
        }

        Ok(())
    }
}

/// Set focus window size (width only, height stays at 48)
#[command]
pub fn set_focus_window_size(app: tauri::AppHandle, width: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.set_fullscreen(false);
            let _ = window.set_size(tauri::LogicalSize::new(width, 48.0));
        }
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.set_fullscreen(false);
            let _ = window.set_size(tauri::LogicalSize::new(width, 48.0));
        }
        Ok(())
    }
}

/// Set focus window height (for notes panel)
#[command]
pub fn set_focus_window_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("focus") {
            if let Ok(size) = window.outer_size() {
                let scale = window.scale_factor().unwrap_or(1.0);
                let current_width = (size.width as f64) / scale;
                let _ = window.set_size(tauri::LogicalSize::new(current_width, height));
            }
        }
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("focus") {
            if let Ok(size) = window.outer_size() {
                let scale = window.scale_factor().unwrap_or(1.0);
                let current_width = (size.width as f64) / scale;
                let _ = window.set_size(tauri::LogicalSize::new(current_width, height));
            }
        }
        Ok(())
    }
}

/// Enter fullscreen focus mode
#[command]
pub fn enter_fullscreen_focus(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.set_resizable(true);
            let _ = window.set_fullscreen(true);
        }
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.set_resizable(true);
            let _ = window.set_fullscreen(true);
            let _ = window.set_always_on_top(true);
        }
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
