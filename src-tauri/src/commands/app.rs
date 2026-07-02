use tauri::command;

/// Get the application version
#[command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Open a URL in the default browser/handler. Used instead of the opener
/// plugin because the plugin spawns `/usr/bin/open` on macOS, which fails in
/// sandboxed Mac App Store builds; this goes through NSWorkspace instead.
#[command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let allowed = trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("mailto:");
    if !allowed {
        return Err(format!("URL scheme not allowed: {trimmed}"));
    }
    crate::opener::open_external(trimmed)
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
