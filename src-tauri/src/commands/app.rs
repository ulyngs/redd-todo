use tauri::command;

/// Get the application version
#[command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Report whether this build is intended for a store-distributed channel.
#[command]
pub fn get_distribution_channel() -> String {
    if cfg!(target_os = "macos") {
        if option_env!("APP_STORE").is_some() {
            return "mac-app-store".to_string();
        }
        return "direct".to_string();
    }

    if cfg!(target_os = "windows") {
        if option_env!("WINDOWS_STORE").is_some() {
            return "msix".to_string();
        }
        return "desktop".to_string();
    }

    "desktop".to_string()
}
