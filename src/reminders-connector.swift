import Foundation
import EventKit

// Semaphore to wait for async operations
let semaphore = DispatchSemaphore(value: 0)
let store = EKEventStore()

// Helper to print JSON and exit
func output(_ data: Any) {
    do {
        let jsonData = try JSONSerialization.data(withJSONObject: data, options: [])
        if let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
        }
    } catch {
        print("[]")
    }
    exit(0)
}

func outputError(_ message: String) {
    let err = ["error": message]
    output(err)
}

func authorizationStatusString(_ status: EKAuthorizationStatus) -> String {
    if #available(macOS 14.0, *) {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .fullAccess: return "fullAccess"
        case .writeOnly: return "writeOnly"
        @unknown default: return "unknown"
        }
    } else {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .fullAccess: return "fullAccess"
        case .writeOnly: return "writeOnly"
        @unknown default: return "unknown"
        }
    }
}

func checkAccess() {
    let initialStatus = EKEventStore.authorizationStatus(for: .reminder)

    if #available(macOS 14.0, *) {
        switch initialStatus {
        case .fullAccess:
            return
        case .restricted, .denied:
            outputError("Permission denied (\(authorizationStatusString(initialStatus)))")
        case .notDetermined:
            store.requestFullAccessToReminders { _, _ in
                semaphore.signal()
            }
            semaphore.wait()

            let finalStatus = EKEventStore.authorizationStatus(for: .reminder)
            if finalStatus != .fullAccess {
                outputError("Permission denied (\(authorizationStatusString(finalStatus)))")
            }
        default:
            let finalStatus = EKEventStore.authorizationStatus(for: .reminder)
            if finalStatus != .fullAccess {
                outputError("Permission denied (\(authorizationStatusString(finalStatus)))")
            }
        }
    } else {
        switch initialStatus {
        case .authorized:
            return
        case .restricted, .denied:
            outputError("Permission denied (\(authorizationStatusString(initialStatus)))")
        case .notDetermined:
            store.requestAccess(to: .reminder) { _, _ in
                semaphore.signal()
            }
            semaphore.wait()

            let finalStatus = EKEventStore.authorizationStatus(for: .reminder)
            if finalStatus != .authorized {
                outputError("Permission denied (\(authorizationStatusString(finalStatus)))")
            }
        default:
            let finalStatus = EKEventStore.authorizationStatus(for: .reminder)
            if finalStatus != .authorized {
                outputError("Permission denied (\(authorizationStatusString(finalStatus)))")
            }
        }
    }
}

func fetchLists() {
    let calendars = store.calendars(for: .reminder)
    let result = calendars.map { cal in
        return [
            "id": cal.calendarIdentifier,
            "name": cal.title
        ]
    }
    output(result)
}

func fetchTasks(listId: String) {
    guard let calendar = store.calendar(withIdentifier: listId) else {
        outputError("List not found")
        return
    }
    
    let predicate = store.predicateForReminders(in: [calendar])
    
    store.fetchReminders(matching: predicate) { reminders in
        guard let reminders = reminders else {
            output([])
            return
        }
        
        let result = reminders.map { rem in
            return [
                "id": rem.calendarItemIdentifier,
                "name": rem.title ?? "No Title",
                "completed": rem.isCompleted,
                "notes": rem.notes ?? "",
                "creationDate": rem.creationDate?.timeIntervalSince1970 ?? 0,
                "completionDate": rem.completionDate?.timeIntervalSince1970 ?? 0,
                "lastModifiedDate": rem.lastModifiedDate?.timeIntervalSince1970 ?? 0
            ] as [String : Any]
        }
        output(result)
    }
}

func updateTask(taskId: String, completed: Bool) {
    guard let reminder = store.calendarItem(withIdentifier: taskId) as? EKReminder else {
        outputError("Task not found")
        return
    }
    
    reminder.isCompleted = completed
    
    do {
        try store.save(reminder, commit: true)
        output(["success": true])
    } catch {
        outputError("Failed to save: \(error.localizedDescription)")
    }
}

func updateTaskTitle(taskId: String, title: String) {
    guard let reminder = store.calendarItem(withIdentifier: taskId) as? EKReminder else {
        outputError("Task not found")
        return
    }
    
    reminder.title = title
    
    do {
        try store.save(reminder, commit: true)
        output(["success": true])
    } catch {
        outputError("Failed to save: \(error.localizedDescription)")
    }
}

func deleteTask(taskId: String) {
    guard let reminder = store.calendarItem(withIdentifier: taskId) as? EKReminder else {
        outputError("Task not found")
        return
    }
    
    do {
        try store.remove(reminder, commit: true)
        output(["success": true])
    } catch {
        outputError("Failed to delete: \(error.localizedDescription)")
    }
}

func createTask(listId: String, title: String) {
    guard let calendar = store.calendar(withIdentifier: listId) else {
        outputError("List not found")
        return
    }
    
    let reminder = EKReminder(eventStore: store)
    reminder.title = title
    reminder.calendar = calendar
    
    do {
        try store.save(reminder, commit: true)
        output(["id": reminder.calendarItemIdentifier])
    } catch {
        outputError("Failed to create: \(error.localizedDescription)")
    }
}

func updateTaskNotes(taskId: String, notes: String) {
    guard let reminder = store.calendarItem(withIdentifier: taskId) as? EKReminder else {
        outputError("Task not found")
        return
    }
    
    reminder.notes = notes
    
    do {
        try store.save(reminder, commit: true)
        output(["success": true])
    } catch {
        outputError("Failed to save: \(error.localizedDescription)")
    }
}

// Main Logic
checkAccess()

let args = CommandLine.arguments

if args.count < 2 {
    outputError("No command provided")
}

let command = args[1]

switch command {
case "lists":
    fetchLists()
case "tasks":
    if args.count < 3 {
        outputError("List ID required")
    }
    fetchTasks(listId: args[2])
    // fetchReminders is async, so we need to wait. 
    // However, output() calls exit(0), so we just park the main thread until then.
    RunLoop.main.run()
case "update-status":
    if args.count < 4 {
        outputError("Task ID and status required")
    }
    let taskId = args[2]
    let completed = (args[3] == "true")
    updateTask(taskId: taskId, completed: completed)
case "update-title":
    if args.count < 4 {
        outputError("Task ID and title required")
    }
    let taskId = args[2]
    let title = args[3]
    updateTaskTitle(taskId: taskId, title: title)
case "delete-task":
    if args.count < 3 {
        outputError("Task ID required")
    }
    let taskId = args[2]
    deleteTask(taskId: taskId)
case "create-task":
    if args.count < 4 {
        outputError("List ID and title required")
    }
    let listId = args[2]
    let title = args[3]
    createTask(listId: listId, title: title)
case "update-notes":
    if args.count < 4 {
        outputError("Task ID and notes required")
    }
    let taskId = args[2]
    let notes = args[3]
    updateTaskNotes(taskId: taskId, notes: notes)
default:
    outputError("Unknown command")
}
