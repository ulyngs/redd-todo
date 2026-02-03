use tauri::{command, Emitter, Manager, WebviewUrl};

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask};

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

// Define the panel class for macOS with fullscreen support
#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(FocusPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true,
            is_non_activating_panel: true,
            works_when_modal: true,
            hides_on_deactivate: false
        }
    })
}

/// Open focus mode - create a separate floating panel window (macOS) or resize main window (other platforms)
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
        // Check if panel already exists
        if let Ok(panel) = app.get_webview_panel("focus") {
            // Panel exists, just show it and send the new task data
            panel.show_and_make_key();
            
            // Emit event to the panel with task data
            if let Some(window) = panel.to_window() {
                let _ = window.emit("enter-focus-mode", serde_json::json!({
                    "taskId": task_id,
                    "taskName": task_name,
                    "duration": duration,
                    "initialTimeSpent": time_spent.unwrap_or(0.0)
                }));
            }
            
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
        
        // Create panel - no style_mask to avoid KVO observer crash
        let panel = PanelBuilder::<_, FocusPanel>::new(&app, "focus")
            .url(WebviewUrl::App(url.into()))
            .build()
            .map_err(|e| e.to_string())?;
        
        // Configure panel for fullscreen display (per tauri-nspanel fullscreen example)
        // Set floating window level
        panel.set_level(PanelLevel::Floating.value());
        
        // Allow panel to display over fullscreen windows and join all spaces
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .full_screen_auxiliary()
                .can_join_all_spaces()
                .ignores_cycle()
                .into()
        );
        
        // Prevent panel from hiding when app deactivates
        panel.set_hides_on_deactivate(false);
        
        // Set the panel size after creation
        if let Some(window) = panel.to_window() {
            let _ = window.set_size(tauri::LogicalSize::new(320.0, 48.0));
            let _ = window.set_decorations(false);
            // Set transparent background for rounded corners
            let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
        }
        
        // Show the panel
        panel.show();
        
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
        // On non-macOS platforms, fall back to modifying the main window
        if let Some(window) = app.get_webview_window("main") {
            window.set_size(tauri::LogicalSize::new(320.0, 48.0)).map_err(|e| e.to_string())?;
            window.set_resizable(true).map_err(|e| e.to_string())?;
            window.set_always_on_top(true).map_err(|e| e.to_string())?;
            window.set_minimizable(false).map_err(|e| e.to_string())?;
            
            // Emit enter-focus-mode event
            let _ = window.emit("enter-focus-mode", serde_json::json!({
                "taskId": task_id,
                "taskName": task_name,
                "duration": duration,
                "initialTimeSpent": time_spent.unwrap_or(0.0)
            }));
        }
        Ok(())
    }
}

/// Exit focus mode - close the focus panel (macOS) or restore main window (other platforms)
#[command]
pub fn exit_focus_mode(app: tauri::AppHandle, _width: Option<f64>, _height: Option<f64>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Close the focus panel - try getting it as a window first
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.close();
        } else if let Ok(panel) = app.get_webview_panel("focus") {
            // Fallback: try panel API
            if let Some(window) = panel.to_window() {
                let _ = window.close();
            }
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
        // On non-macOS, restore the main window
        if let Some(window) = app.get_webview_window("main") {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            let w = width.unwrap_or(450.0);
            let h = height.unwrap_or(600.0);
            window.set_size(tauri::LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
            window.set_resizable(true).map_err(|e| e.to_string())?;
            window.set_always_on_top(false).map_err(|e| e.to_string())?;
            window.set_minimizable(true).map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }
}

/// Set focus window size (width only, height stays at 48)
#[command]
pub fn set_focus_window_size(app: tauri::AppHandle, width: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Try getting the focus window directly first
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.set_fullscreen(false);
            let _ = window.set_size(tauri::LogicalSize::new(width, 48.0));
        } else if let Ok(panel) = app.get_webview_panel("focus") {
            // Fallback to panel API
            if let Some(window) = panel.to_window() {
                let _ = window.set_fullscreen(false);
                let _ = window.set_size(tauri::LogicalSize::new(width, 48.0));
            }
        }
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            window.set_size(tauri::LogicalSize::new(width, 48.0)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// Set focus window height (for notes panel)
#[command]
pub fn set_focus_window_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Try getting the focus window directly first
        if let Some(window) = app.get_webview_window("focus") {
            if let Ok(size) = window.outer_size() {
                let scale = window.scale_factor().unwrap_or(1.0);
                let current_width = (size.width as f64) / scale;
                let _ = window.set_size(tauri::LogicalSize::new(current_width, height));
            }
        } else if let Ok(panel) = app.get_webview_panel("focus") {
            // Fallback to panel API
            if let Some(window) = panel.to_window() {
                if let Ok(size) = window.outer_size() {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let current_width = (size.width as f64) / scale;
                    let _ = window.set_size(tauri::LogicalSize::new(current_width, height));
                }
            }
        }
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            let size = window.outer_size().map_err(|e| e.to_string())?;
            let scale = window.scale_factor().unwrap_or(1.0);
            let current_width = (size.width as f64) / scale;
            window.set_size(tauri::LogicalSize::new(current_width, height)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// Enter fullscreen focus mode
#[command]
pub fn enter_fullscreen_focus(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Try getting the focus window directly first
        if let Some(window) = app.get_webview_window("focus") {
            let _ = window.set_resizable(true);
            let _ = window.set_fullscreen(true);
        } else if let Ok(panel) = app.get_webview_panel("focus") {
            // Fallback to panel API
            if let Some(window) = panel.to_window() {
                let _ = window.set_resizable(true);
                let _ = window.set_fullscreen(true);
            }
        }
        Ok(())
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.set_resizable(true).map_err(|e| e.to_string())?;
            window.set_fullscreen(true).map_err(|e| e.to_string())?;
            window.set_always_on_top(true).map_err(|e| e.to_string())?;
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
    // This is a legacy command - on macOS, the JS side should use open_focus_window instead
    // For non-macOS, we still need to handle this
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = _app.get_webview_window("main") {
            window.set_size(tauri::LogicalSize::new(320.0, 48.0)).map_err(|e| e.to_string())?;
            window.set_resizable(true).map_err(|e| e.to_string())?;
            window.set_always_on_top(true).map_err(|e| e.to_string())?;
            window.set_minimizable(false).map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}
