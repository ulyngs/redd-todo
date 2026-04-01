use serde::{Deserialize, Serialize};
#[cfg(debug_assertions)]
use serde_json::Value;
use std::process::Command;
use tauri::command;
#[cfg(debug_assertions)]
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct RemindersList {
    pub id: String,
    pub name: String,
    #[serde(rename = "groupName", default)]
    pub group_name: Option<String>,
    #[serde(rename = "sourceName", default)]
    pub source_name: Option<String>,
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
#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
trait Pipe: Sized {
    fn pipe<T, F: FnOnce(Self) -> T>(self, f: F) -> T {
        f(self)
    }
}

#[cfg(debug_assertions)]
impl<T> Pipe for T {}

#[cfg(debug_assertions)]
fn should_use_jxa_fallback(error: &str) -> bool {
    cfg!(debug_assertions) && error.to_lowercase().contains("permission denied")
}

#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

#[cfg(debug_assertions)]
fn jxa_lists_output() -> Result<String, String> {
    run_jxa(
        r#"
var app = Application('Reminders');
try {
  var lists = app.lists();
  var out = lists.map(function(l) {
    var groupName = "";
    var sourceName = "";
    try {
      if (l.container && l.container()) {
        groupName = l.container().name() || "";
      }
    } catch (e) {}
    try {
      if (l.account && l.account()) {
        sourceName = l.account().name() || "";
      }
    } catch (e) {}
    if (!sourceName) sourceName = groupName;
    return { id: l.id(), name: l.name(), groupName: groupName, sourceName: sourceName };
  });
  JSON.stringify(out);
} catch (e) {
  JSON.stringify({ error: String(e) });
}
"#,
    )
}

#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
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

#[cfg(all(target_os = "macos", not(debug_assertions)))]
mod native_eventkit {
    use super::{RemindersList, RemindersResult, RemindersTask};
    use block2::RcBlock;
    use objc2::{msg_send, sel};
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::AnyThread;
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendar, EKEntityMask, EKEntityType, EKEventStore, EKReminder,
    };
    use objc2_foundation::{NSArray, NSDate, NSError, NSObjectProtocol, NSString};
    use std::sync::mpsc;

    const REMINDER_ENTITY_TYPE: EKEntityType = EKEntityType(1);
    const REMINDER_ENTITY_MASK: EKEntityMask = EKEntityMask::from_bits_retain(1 << 1);

    const STATUS_NOT_DETERMINED: EKAuthorizationStatus = EKAuthorizationStatus(0);
    const STATUS_RESTRICTED: EKAuthorizationStatus = EKAuthorizationStatus(1);
    const STATUS_DENIED: EKAuthorizationStatus = EKAuthorizationStatus(2);
    const STATUS_AUTHORIZED: EKAuthorizationStatus = EKAuthorizationStatus(3);
    const STATUS_FULL_ACCESS: EKAuthorizationStatus = EKAuthorizationStatus(4);
    const STATUS_WRITE_ONLY: EKAuthorizationStatus = EKAuthorizationStatus(5);

    fn authorization_status_string(status: EKAuthorizationStatus) -> &'static str {
        match status {
            STATUS_NOT_DETERMINED => "notDetermined",
            STATUS_RESTRICTED => "restricted",
            STATUS_DENIED => "denied",
            STATUS_AUTHORIZED => "authorized",
            STATUS_FULL_ACCESS => "fullAccess",
            STATUS_WRITE_ONLY => "writeOnly",
            _ => "unknown",
        }
    }

    fn has_read_access(status: EKAuthorizationStatus) -> bool {
        status == STATUS_AUTHORIZED || status == STATUS_FULL_ACCESS
    }

    #[allow(deprecated)]
    fn reminders_store() -> Retained<EKEventStore> {
        unsafe {
            EKEventStore::initWithAccessToEntityTypes(EKEventStore::alloc(), REMINDER_ENTITY_MASK)
        }
    }

    fn ns_string(value: &str) -> Retained<NSString> {
        NSString::from_str(value)
    }

    fn permission_denied(status: EKAuthorizationStatus, error: Option<String>) -> String {
        match error {
            Some(error) if !error.trim().is_empty() => format!("Permission denied ({})", error.trim()),
            _ => format!(
                "Permission denied ({})",
                authorization_status_string(status)
            ),
        }
    }

    fn ns_date_to_timestamp(date: Option<Retained<NSDate>>) -> f64 {
        match date {
            Some(date) => unsafe { msg_send![&*date, timeIntervalSince1970] },
            None => 0.0,
        }
    }

    fn source_title(calendar: &EKCalendar) -> String {
        unsafe {
            calendar
                .source()
                .map(|source| {
                    let title: Retained<NSString> = msg_send![&*source, title];
                    title.to_string()
                })
                .unwrap_or_default()
        }
    }

    fn reminder_notes(reminder: &EKReminder) -> String {
        unsafe {
            let notes: Option<Retained<NSString>> = msg_send![reminder, notes];
            notes.map(|value| value.to_string()).unwrap_or_default()
        }
    }

    fn reminder_creation_date(reminder: &EKReminder) -> Option<Retained<NSDate>> {
        unsafe { msg_send![reminder, creationDate] }
    }

    fn reminder_last_modified_date(reminder: &EKReminder) -> Option<Retained<NSDate>> {
        unsafe { msg_send![reminder, lastModifiedDate] }
    }

    fn reminder_to_task(reminder: &EKReminder) -> RemindersTask {
        RemindersTask {
            id: unsafe { reminder.calendarItemIdentifier() }.to_string(),
            name: unsafe { reminder.title() }.to_string(),
            completed: unsafe { reminder.isCompleted() },
            notes: reminder_notes(reminder),
            creation_date: ns_date_to_timestamp(reminder_creation_date(reminder)),
            completion_date: ns_date_to_timestamp(unsafe { reminder.completionDate() }),
            last_modified_date: ns_date_to_timestamp(reminder_last_modified_date(reminder)),
        }
    }

    fn find_calendar(store: &EKEventStore, list_id: &str) -> Result<Retained<EKCalendar>, String> {
        let identifier = ns_string(list_id);
        unsafe { store.calendarWithIdentifier(&identifier) }.ok_or_else(|| "List not found".to_string())
    }

    fn find_reminder(store: &EKEventStore, task_id: &str) -> Result<Retained<EKReminder>, String> {
        let identifier = ns_string(task_id);
        let item = unsafe { store.calendarItemWithIdentifier(&identifier) }
            .ok_or_else(|| "Task not found".to_string())?;

        item.downcast::<EKReminder>()
            .map_err(|_| "Task not found".to_string())
    }

    fn save_reminder(store: &EKEventStore, reminder: &EKReminder) -> Result<(), String> {
        unsafe { store.saveReminder_commit_error(reminder, true) }
            .map_err(|err| format!("Failed to save: {}", err))
    }

    fn remove_reminder(store: &EKEventStore, reminder: &EKReminder) -> Result<(), String> {
        unsafe { store.removeReminder_commit_error(reminder, true) }
            .map_err(|err| format!("Failed to delete: {}", err))
    }

    pub fn ensure_access() -> Result<(), String> {
        let initial_status =
            unsafe { EKEventStore::authorizationStatusForEntityType(REMINDER_ENTITY_TYPE) };

        if has_read_access(initial_status) {
            return Ok(());
        }

        if initial_status == STATUS_RESTRICTED
            || initial_status == STATUS_DENIED
            || initial_status == STATUS_WRITE_ONLY
        {
            return Err(permission_denied(initial_status, None));
        }

        let store = reminders_store();
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            let error_message = if error.is_null() {
                None
            } else {
                Some(unsafe { (&*error).to_string() })
            };
            let _ = tx.send((granted.as_bool(), error_message));
        });

        unsafe {
            if store.respondsToSelector(sel!(requestFullAccessToRemindersWithCompletion:)) {
                store.requestFullAccessToRemindersWithCompletion(RcBlock::as_ptr(&block));
            } else {
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(
                    REMINDER_ENTITY_TYPE,
                    RcBlock::as_ptr(&block),
                );
            }
        }

        let (granted, error_message) = rx
            .recv()
            .map_err(|_| "Reminders permission request did not complete".to_string())?;
        let final_status =
            unsafe { EKEventStore::authorizationStatusForEntityType(REMINDER_ENTITY_TYPE) };

        if granted && has_read_access(final_status) {
            Ok(())
        } else {
            Err(permission_denied(final_status, error_message))
        }
    }

    pub fn fetch_lists() -> Result<Vec<RemindersList>, String> {
        ensure_access()?;

        let store = reminders_store();
        let calendars = unsafe { store.calendarsForEntityType(REMINDER_ENTITY_TYPE) };
        let mut lists = Vec::with_capacity(calendars.len());

        for calendar in &*calendars {
            let source_name = source_title(&calendar);
            let source_value = (!source_name.is_empty()).then_some(source_name.clone());

            lists.push(RemindersList {
                id: unsafe { calendar.calendarIdentifier() }.to_string(),
                name: unsafe { calendar.title() }.to_string(),
                group_name: source_value.clone(),
                source_name: source_value,
            });
        }

        Ok(lists)
    }

    pub fn fetch_tasks(list_id: String) -> Result<Vec<RemindersTask>, String> {
        ensure_access()?;

        let store = reminders_store();
        let calendar = find_calendar(&store, &list_id)?;
        let calendars = NSArray::from_retained_slice(&[calendar]);
        let predicate = unsafe { store.predicateForRemindersInCalendars(Some(&calendars)) };
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |reminders: *mut NSArray<EKReminder>| {
            let tasks = if reminders.is_null() {
                Vec::new()
            } else {
                let reminders = unsafe { &*reminders };
                reminders.iter().map(|reminder| reminder_to_task(&reminder)).collect()
            };
            let _ = tx.send(tasks);
        });

        unsafe {
            store.fetchRemindersMatchingPredicate_completion(&predicate, &block);
        }

        rx.recv()
            .map_err(|_| "Failed to fetch reminders tasks".to_string())
    }

    pub fn update_status(task_id: String, completed: bool) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        unsafe {
            reminder.setCompleted(completed);
        }
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn update_title(task_id: String, title: String) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        let title = ns_string(&title);
        unsafe {
            reminder.setTitle(Some(&title));
        }
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn update_notes(task_id: String, notes: String) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        let notes = ns_string(&notes);
        unsafe {
            reminder.setNotes(Some(&notes));
        }
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn delete_task(task_id: String) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        remove_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn create_task(list_id: String, title: String) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let calendar = find_calendar(&store, &list_id)?;
        let reminder = unsafe { EKReminder::reminderWithEventStore(&store) };
        let title = ns_string(&title);

        unsafe {
            reminder.setTitle(Some(&title));
            reminder.setCalendar(Some(&calendar));
        }
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: Some(unsafe { reminder.calendarItemIdentifier() }.to_string()),
        })
    }
}

/// Execute the reminders-connector with the given arguments
#[cfg(debug_assertions)]
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
        #[cfg(not(debug_assertions))]
        {
            let _ = app;
            return native_eventkit::fetch_lists();
        }

        #[cfg(debug_assertions)]
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
}

/// Fetch tasks from a specific Reminders list
#[command]
pub fn fetch_reminders_tasks(app: tauri::AppHandle, list_id: String) -> Result<Vec<RemindersTask>, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(vec![]);
    
    #[cfg(target_os = "macos")]
    {
        #[cfg(not(debug_assertions))]
        {
            let _ = app;
            return native_eventkit::fetch_tasks(list_id);
        }

        #[cfg(debug_assertions)]
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
}

/// Update the completion status of a Reminders task
#[command]
pub fn update_reminders_status(app: tauri::AppHandle, task_id: String, completed: bool) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        #[cfg(not(debug_assertions))]
        {
            let _ = app;
            return native_eventkit::update_status(task_id, completed);
        }

        #[cfg(debug_assertions)]
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
}

/// Update the title of a Reminders task
#[command]
pub fn update_reminders_title(app: tauri::AppHandle, task_id: String, title: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        #[cfg(not(debug_assertions))]
        {
            let _ = app;
            return native_eventkit::update_title(task_id, title);
        }

        #[cfg(debug_assertions)]
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
}

/// Update the notes of a Reminders task
#[command]
pub fn update_reminders_notes(app: tauri::AppHandle, task_id: String, notes: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        #[cfg(not(debug_assertions))]
        {
            let _ = app;
            return native_eventkit::update_notes(task_id, notes);
        }

        #[cfg(debug_assertions)]
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
}

/// Delete a Reminders task
#[command]
pub fn delete_reminders_task(app: tauri::AppHandle, task_id: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        #[cfg(not(debug_assertions))]
        {
            let _ = app;
            return native_eventkit::delete_task(task_id);
        }

        #[cfg(debug_assertions)]
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
}

/// Create a new Reminders task
#[command]
pub fn create_reminders_task(app: tauri::AppHandle, list_id: String, title: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(RemindersResult { success: Some(false), error: Some("Not on macOS".into()), id: None });
    
    #[cfg(target_os = "macos")]
    {
        #[cfg(not(debug_assertions))]
        {
            let _ = app;
            return native_eventkit::create_task(list_id, title);
        }

        #[cfg(debug_assertions)]
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
