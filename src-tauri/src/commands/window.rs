use tauri::{command, Emitter, Manager, WebviewWindow};

/// Minimize the main window
#[command]
pub fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// Maximize or unmaximize the main window
#[command]
pub fn window_maximize(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// Close the window
#[command]
pub fn window_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// Enter focus mode - resize and configure the window
#[command]
pub fn enter_focus_mode(window: WebviewWindow) -> Result<(), String> {
    // Set to small size for focus mode
    window.set_size(tauri::LogicalSize::new(320.0, 48.0)).map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_minimizable(false).map_err(|e| e.to_string())?;
    
    #[cfg(target_os = "macos")]
    {
        window.set_decorations(false).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

/// Exit focus mode - restore window settings
#[command]
pub fn exit_focus_mode(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_minimizable(true).map_err(|e| e.to_string())?;
    
    #[cfg(target_os = "macos")]
    {
        window.set_decorations(false).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

/// Set focus window size (width only, height stays at 48)
#[command]
pub fn set_focus_window_size(window: WebviewWindow, width: f64) -> Result<(), String> {
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    window.set_size(tauri::LogicalSize::new(width, 48.0)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Set focus window height (for notes panel)
#[command]
pub fn set_focus_window_height(window: WebviewWindow, height: f64) -> Result<(), String> {
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let current_width = (size.width as f64) / scale;
    window.set_size(tauri::LogicalSize::new(current_width, height)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Enter fullscreen focus mode
#[command]
pub fn enter_fullscreen_focus(window: WebviewWindow) -> Result<(), String> {
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    Ok(())
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
