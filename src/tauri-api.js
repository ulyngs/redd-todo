// Tauri API wrapper - provides unified interface for Tauri commands
// This abstraction allows gradual migration from Electron without modifying app.js extensively

const tauriAPI = {
    // Check if we're running in Tauri
    isTauri: typeof window !== 'undefined' && window.__TAURI__ != null,

    // Core invoke function - works with Tauri 2.x
    async invoke(cmd, args = {}) {
        if (!this.isTauri) {
            console.warn('Tauri not available, command ignored:', cmd);
            return null;
        }
        try {
            // Tauri 2.x: Use window.__TAURI__.invoke or window.__TAURI__.core.invoke
            const invoke = window.__TAURI__.invoke || (window.__TAURI__.core && window.__TAURI__.core.invoke);
            if (!invoke) {
                console.error('Tauri invoke function not found');
                return null;
            }
            return await invoke(cmd, args);
        } catch (e) {
            console.error(`Tauri invoke error (${cmd}):`, e);
            throw e;
        }
    },

    // App commands
    async getAppVersion() {
        return this.invoke('get_app_version');
    },

    // Reminders commands
    async fetchRemindersLists() {
        return this.invoke('fetch_reminders_lists');
    },

    async fetchRemindersTasks(listId) {
        return this.invoke('fetch_reminders_tasks', { listId });
    },

    async updateRemindersStatus(taskId, completed) {
        return this.invoke('update_reminders_status', { taskId, completed });
    },

    async updateRemindersTitle(taskId, title) {
        return this.invoke('update_reminders_title', { taskId, title });
    },

    async updateRemindersNotes(taskId, notes) {
        return this.invoke('update_reminders_notes', { taskId, notes });
    },

    async deleteRemindersTask(taskId) {
        return this.invoke('delete_reminders_task', { taskId });
    },

    async createRemindersTask(listId, title) {
        return this.invoke('create_reminders_task', { listId, title });
    },

    async openRemindersPrivacySettings() {
        return this.invoke('open_reminders_privacy_settings');
    },

    // Window commands
    async windowMinimize() {
        return this.invoke('window_minimize');
    },

    async windowMaximize() {
        return this.invoke('window_maximize');
    },

    async windowClose() {
        return this.invoke('window_close');
    },

    async enterFocusMode() {
        return this.invoke('enter_focus_mode');
    },

    async openFocusWindow(taskId, taskName, duration, timeSpent, anchorLeft = null, anchorRight = null, anchorTop = null) {
        return this.invoke('open_focus_window', {
            taskId,
            taskName,
            duration: duration || null,
            timeSpent: timeSpent || 0,
            anchorLeft,
            anchorRight,
            anchorTop
        });
    },

    async exitFocusMode(taskId = null) {
        return this.invoke('exit_focus_mode', { taskId });
    },

    async setFocusWindowSize(width) {
        return this.invoke('set_focus_window_size', { width });
    },

    async setFocusWindowHeight(height) {
        return this.invoke('set_focus_window_height', { height });
    },

    async enterFullscreenFocus() {
        return this.invoke('enter_fullscreen_focus');
    },

    async enterFullscreenFocusHandoff(taskId, taskName, duration, timeSpent) {
        return this.invoke('enter_fullscreen_focus_handoff', {
            taskId,
            taskName,
            duration: duration || null,
            timeSpent: timeSpent || 0
        });
    },

    async exitFullscreenFocusHandoff(taskId, taskName, duration, timeSpent) {
        return this.invoke('exit_fullscreen_focus_handoff', {
            taskId,
            taskName,
            duration: duration || null,
            timeSpent: timeSpent || 0
        });
    },

    async exitFullscreenFocusToHome(taskId) {
        return this.invoke('exit_fullscreen_focus_to_home', { taskId });
    },

    async refreshMainWindow() {
        return this.invoke('refresh_main_window');
    },

    async taskUpdated(taskId, text) {
        return this.invoke('task_updated', { taskId, text });
    },

    async focusStatusChanged(activeTaskId) {
        return this.invoke('focus_status_changed', { activeTaskId });
    },

    // Event listeners - matches Electron's ipcRenderer.on(channel, (event, data) => ...)
    onEvent(eventName, callback) {
        if (!this.isTauri) return () => { };
        // Prefer per-window listener so events emitted to one window do not
        // accidentally fan out to all windows in multi-window mode.
        const windowApi = window.__TAURI__.window;
        const currentWindow = windowApi && typeof windowApi.getCurrentWindow === 'function'
            ? windowApi.getCurrentWindow()
            : null;

        const listen = currentWindow && typeof currentWindow.listen === 'function'
            ? currentWindow.listen.bind(currentWindow)
            : window.__TAURI__.event.listen;

        const unlisten = listen(eventName, (event) => {
            // Call callback with (null, payload) to match Electron's (event, data) signature
            callback(null, event.payload);
        });
        return unlisten;
    },

    // Shell - open URL in default browser
    async openExternal(url) {
        if (!this.isTauri) {
            window.open(url, '_blank');
            return;
        }
        return window.__TAURI__.opener.openUrl(url);
    },

    // Clipboard operations
    async clipboardWriteText(text) {
        if (!this.isTauri) {
            return navigator.clipboard.writeText(text);
        }
        return window.__TAURI__.clipboardManager.writeText(text);
    },

    async clipboardReadText() {
        if (!this.isTauri) {
            return navigator.clipboard.readText();
        }
        return window.__TAURI__.clipboardManager.readText();
    },

    // Window dragging
    async startDrag() {
        if (!this.isTauri) return;
        return window.__TAURI__.window.getCurrentWindow().startDragging();
    },

    // HTTP fetch using Tauri's native client (bypasses CORS)
    async fetch(url, options = {}) {
        if (!this.isTauri || !window.__TAURI__.http) {
            return window.fetch(url, options);
        }

        try {

            // Tauri 2.x http plugin's fetch returns a Response object similar to browser fetch
            const response = await window.__TAURI__.http.fetch(url, {
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body
            });

            // Tauri 2 http.fetch should return a standard Response object
            // If it has json/text methods, use them directly
            if (typeof response.json === 'function') {
                return response;
            }

            // Fallback for different response format
            return {
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                json: async () => {
                    if (response.data) return response.data;
                    if (typeof response.body === 'string') return JSON.parse(response.body);
                    return response.body;
                },
                text: async () => {
                    if (typeof response.data === 'string') return response.data;
                    if (typeof response.body === 'string') return response.body;
                    return JSON.stringify(response.data || response.body);
                }
            };
        } catch (e) {
            console.error('[Tauri HTTP] Fetch error:', e);
            throw e;
        }
    }
};

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { tauriAPI };
}
