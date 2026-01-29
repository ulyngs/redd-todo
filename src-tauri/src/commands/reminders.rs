use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{command, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct RemindersList {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemindersTask {
    pub id: String,
    pub name: String,
    pub completed: bool,
    pub notes: String,
    #[serde(rename = "creationDate")]
    pub creation_date: f64,
    #[serde(rename = "completionDate")]
    pub completion_date: f64,
    #[serde(rename = "lastModifiedDate")]
    pub last_modified_date: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemindersResult {
    pub success: Option<bool>,
    pub error: Option<String>,
    pub id: Option<String>,
}

/// Get the path to the reminders-connector binary
fn get_connector_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // In development, use the src directory
    // In production, use the resource directory
    if cfg!(debug_assertions) {
        let path = std::env::current_dir()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("No parent directory")?
            .join("src")
            .join("reminders-connector");
        Ok(path)
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("reminders-connector")
            .pipe(Ok)
    }
}

trait Pipe: Sized {
    fn pipe<T, F: FnOnce(Self) -> T>(self, f: F) -> T {
        f(self)
    }
}

impl<T> Pipe for T {}

/// Execute the reminders-connector with the given arguments
fn run_connector(app: &tauri::AppHandle, args: &[&str]) -> Result<String, String> {
    let path = get_connector_path(app)?;
    
    if !path.exists() {
        return Err(format!("Reminders connector not found at: {:?}", path));
    }
    
    let output = Command::new(&path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute reminders-connector: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Reminders connector error: {}", stderr));
    }
    
    String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 output: {}", e))
}

/// Fetch all Reminders lists
#[command]
pub fn fetch_reminders_lists(app: tauri::AppHandle) -> Result<Vec<RemindersList>, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(vec![]);
    
    #[cfg(target_os = "macos")]
    {
        let output = run_connector(&app, &["lists"])?;
        serde_json::from_str(&output)
            .map_err(|e| format!("Failed to parse reminders lists: {}", e))
    }
}

/// Fetch tasks from a specific Reminders list
#[command]
pub fn fetch_reminders_tasks(app: tauri::AppHandle, list_id: String) -> Result<Vec<RemindersTask>, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(vec![]);
    
    #[cfg(target_os = "macos")]
    {
        let output = run_connector(&app, &["tasks", &list_id])?;
        serde_json::from_str(&output)
            .map_err(|e| format!("Failed to parse reminders tasks: {}", e))
    }
}

/// Update the completion status of a Reminders task
#[command]
pub fn update_reminders_status(app: tauri::AppHandle, task_id: String, completed: bool) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        let completed_str = if completed { "true" } else { "false" };
        let output = run_connector(&app, &["update-status", &task_id, completed_str])?;
        serde_json::from_str(&output)
            .map_err(|e| format!("Failed to parse result: {}", e))
    }
}

/// Update the title of a Reminders task
#[command]
pub fn update_reminders_title(app: tauri::AppHandle, task_id: String, title: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        let output = run_connector(&app, &["update-title", &task_id, &title])?;
        serde_json::from_str(&output)
            .map_err(|e| format!("Failed to parse result: {}", e))
    }
}

/// Update the notes of a Reminders task
#[command]
pub fn update_reminders_notes(app: tauri::AppHandle, task_id: String, notes: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        let output = run_connector(&app, &["update-notes", &task_id, &notes])?;
        serde_json::from_str(&output)
            .map_err(|e| format!("Failed to parse result: {}", e))
    }
}

/// Delete a Reminders task
#[command]
pub fn delete_reminders_task(app: tauri::AppHandle, task_id: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        let output = run_connector(&app, &["delete-task", &task_id])?;
        serde_json::from_str(&output)
            .map_err(|e| format!("Failed to parse result: {}", e))
    }
}

/// Create a new Reminders task
#[command]
pub fn create_reminders_task(app: tauri::AppHandle, list_id: String, title: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        let output = run_connector(&app, &["create-task", &list_id, &title])?;
        serde_json::from_str(&output)
            .map_err(|e| format!("Failed to parse result: {}", e))
    }
}
