use serde::{Deserialize, Serialize};
use serde_json::Value;
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

fn should_use_jxa_fallback(error: &str) -> bool {
    cfg!(debug_assertions) && error.to_lowercase().contains("permission denied")
}

fn run_jxa(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output()
        .map_err(|e| format!("Failed to execute JXA script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("JXA execution failed: {}", stderr.trim()));
    }

    String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 output from JXA: {}", e))
}

fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

fn jxa_lists_output() -> Result<String, String> {
    run_jxa(
        r#"
var app = Application('Reminders');
try {
  var lists = app.lists();
  var out = lists.map(function(l) { return { id: l.id(), name: l.name() }; });
  JSON.stringify(out);
} catch (e) {
  JSON.stringify({ error: String(e) });
}
"#,
    )
}

fn jxa_tasks_output(list_id: &str) -> Result<String, String> {
    let list_id = js_string(list_id);
    run_jxa(&format!(
        r#"
var app = Application('Reminders');
var listId = {list_id};
function ts(d) {{
  return d ? (new Date(d).getTime() / 1000) : 0;
}}
try {{
  var list = app.lists.byId(listId);
  var tasks = list.reminders();
  var out = tasks.map(function(t) {{
    return {{
      id: t.id(),
      name: t.name() || "No Title",
      completed: !!t.completed(),
      notes: t.body() || "",
      creationDate: ts(t.creationDate()),
      completionDate: ts(t.completionDate()),
      lastModifiedDate: ts(t.modificationDate())
    }};
  }});
  JSON.stringify(out);
}} catch (e) {{
  JSON.stringify({{ error: String(e) }});
}}
"#
    ))
}

fn jxa_update_status_output(task_id: &str, completed: bool) -> Result<String, String> {
    let task_id = js_string(task_id);
    run_jxa(&format!(
        r#"
var app = Application('Reminders');
var taskId = {task_id};
var completed = {completed};
try {{
  var task = app.reminders.byId(taskId);
  task.completed = completed;
  JSON.stringify({{ success: true }});
}} catch (e) {{
  JSON.stringify({{ error: String(e) }});
}}
"#
    ))
}

fn jxa_update_title_output(task_id: &str, title: &str) -> Result<String, String> {
    let task_id = js_string(task_id);
    let title = js_string(title);
    run_jxa(&format!(
        r#"
var app = Application('Reminders');
var taskId = {task_id};
var title = {title};
try {{
  var task = app.reminders.byId(taskId);
  task.name = title;
  JSON.stringify({{ success: true }});
}} catch (e) {{
  JSON.stringify({{ error: String(e) }});
}}
"#
    ))
}

fn jxa_update_notes_output(task_id: &str, notes: &str) -> Result<String, String> {
    let task_id = js_string(task_id);
    let notes = js_string(notes);
    run_jxa(&format!(
        r#"
var app = Application('Reminders');
var taskId = {task_id};
var notes = {notes};
try {{
  var task = app.reminders.byId(taskId);
  task.body = notes;
  JSON.stringify({{ success: true }});
}} catch (e) {{
  JSON.stringify({{ error: String(e) }});
}}
"#
    ))
}

fn jxa_delete_task_output(task_id: &str) -> Result<String, String> {
    let task_id = js_string(task_id);
    run_jxa(&format!(
        r#"
var app = Application('Reminders');
var taskId = {task_id};
try {{
  var task = app.reminders.byId(taskId);
  task.delete();
  JSON.stringify({{ success: true }});
}} catch (e) {{
  JSON.stringify({{ error: String(e) }});
}}
"#
    ))
}

fn jxa_create_task_output(list_id: &str, title: &str) -> Result<String, String> {
    let list_id = js_string(list_id);
    let title = js_string(title);
    run_jxa(&format!(
        r#"
var app = Application('Reminders');
var listId = {list_id};
var title = {title};
try {{
  var list = app.lists.byId(listId);
  var reminder = app.Reminder({{ name: title }});
  list.reminders.push(reminder);
  JSON.stringify({{ success: true, id: reminder.id() }});
}} catch (e) {{
  JSON.stringify({{ error: String(e) }});
}}
"#
    ))
}

fn parse_array_or_error<T: for<'de> Deserialize<'de>>(
    output: &str,
    label: &str,
) -> Result<Vec<T>, String> {
    let value: Value = serde_json::from_str(output)
        .map_err(|e| format!("Failed to parse {} JSON: {}", label, e))?;

    if let Some(err) = value
        .as_object()
        .and_then(|obj| obj.get("error"))
        .and_then(|v| v.as_str())
    {
        return Err(format!("Reminders connector error: {}", err));
    }

    match value {
        Value::Array(items) => serde_json::from_value(Value::Array(items))
            .map_err(|e| format!("Failed to parse {}: {}", label, e)),
        Value::Object(mut obj) => {
            // Backward/forward compatibility: accept { lists: [...] } / { tasks: [...] }.
            let nested = obj.remove("lists").or_else(|| obj.remove("tasks"));
            if let Some(Value::Array(items)) = nested {
                serde_json::from_value(Value::Array(items))
                    .map_err(|e| format!("Failed to parse {}: {}", label, e))
            } else {
                Err(format!("Unexpected {} format from reminders connector", label))
            }
        }
        _ => Err(format!("Unexpected {} format from reminders connector", label)),
    }
}

fn parse_result_or_error(output: &str, label: &str) -> Result<RemindersResult, String> {
    let value: Value = serde_json::from_str(output)
        .map_err(|e| format!("Failed to parse {} JSON: {}", label, e))?;

    if let Some(err) = value
        .as_object()
        .and_then(|obj| obj.get("error"))
        .and_then(|v| v.as_str())
    {
        return Err(format!("Reminders connector error: {}", err));
    }

    serde_json::from_value(value).map_err(|e| format!("Failed to parse {}: {}", label, e))
}

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
        match parse_array_or_error(&output, "reminders lists") {
            Ok(v) => Ok(v),
            Err(e) if should_use_jxa_fallback(&e) => {
                let jxa_output = jxa_lists_output()?;
                parse_array_or_error(&jxa_output, "reminders lists (JXA)")
            }
            Err(e) => Err(e),
        }
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
        match parse_array_or_error(&output, "reminders tasks") {
            Ok(v) => Ok(v),
            Err(e) if should_use_jxa_fallback(&e) => {
                let jxa_output = jxa_tasks_output(&list_id)?;
                parse_array_or_error(&jxa_output, "reminders tasks (JXA)")
            }
            Err(e) => Err(e),
        }
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
        match parse_result_or_error(&output, "update reminders status") {
            Ok(v) => Ok(v),
            Err(e) if should_use_jxa_fallback(&e) => {
                let jxa_output = jxa_update_status_output(&task_id, completed)?;
                parse_result_or_error(&jxa_output, "update reminders status (JXA)")
            }
            Err(e) => Err(e),
        }
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
        match parse_result_or_error(&output, "update reminders title") {
            Ok(v) => Ok(v),
            Err(e) if should_use_jxa_fallback(&e) => {
                let jxa_output = jxa_update_title_output(&task_id, &title)?;
                parse_result_or_error(&jxa_output, "update reminders title (JXA)")
            }
            Err(e) => Err(e),
        }
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
        match parse_result_or_error(&output, "update reminders notes") {
            Ok(v) => Ok(v),
            Err(e) if should_use_jxa_fallback(&e) => {
                let jxa_output = jxa_update_notes_output(&task_id, &notes)?;
                parse_result_or_error(&jxa_output, "update reminders notes (JXA)")
            }
            Err(e) => Err(e),
        }
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
        match parse_result_or_error(&output, "delete reminders task") {
            Ok(v) => Ok(v),
            Err(e) if should_use_jxa_fallback(&e) => {
                let jxa_output = jxa_delete_task_output(&task_id)?;
                parse_result_or_error(&jxa_output, "delete reminders task (JXA)")
            }
            Err(e) => Err(e),
        }
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
        match parse_result_or_error(&output, "create reminders task") {
            Ok(v) => Ok(v),
            Err(e) if should_use_jxa_fallback(&e) => {
                let jxa_output = jxa_create_task_output(&list_id, &title)?;
                parse_result_or_error(&jxa_output, "create reminders task (JXA)")
            }
            Err(e) => Err(e),
        }
    }
}

/// Open macOS Reminders privacy settings page
#[command]
pub fn open_reminders_privacy_settings() -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(());

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders")
            .status()
            .map_err(|e| format!("Failed to open Reminders privacy settings: {}", e))?;

        if status.success() {
            Ok(())
        } else {
            Err("Failed to open Reminders privacy settings".to_string())
        }
    }
}
