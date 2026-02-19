// Platform detection and API abstraction for Tauri/Electron compatibility
// Directly check for Tauri runtime - don't rely on tauriAPI which may load after
const reddIsTauri = typeof window !== 'undefined' && window.__TAURI__ != null;
console.log('[ReddIpc] Tauri detection:', { reddIsTauri, hasTauriGlobal: !!window.__TAURI__, hasTauriAPI: typeof tauriAPI !== 'undefined' });

// Platform detection (works in both Tauri and Electron)
const platform = (() => {
    if (reddIsTauri) {
        // In Tauri, detect from user agent
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('mac')) return 'darwin';
        if (ua.includes('win')) return 'win32';
        return 'linux';
    }
    // Electron
    return typeof process !== 'undefined' ? process.platform : 'darwin';
})();

// Legacy Electron compatibility - only used if not running in Tauri
let ipcRenderer = null;
let clipboard = null;
let shell = null;

if (!reddIsTauri && typeof require !== 'undefined') {
    try {
        const electron = require('electron');
        ipcRenderer = electron.ipcRenderer;
        clipboard = electron.clipboard;
        shell = electron.shell;
    } catch (e) {
        console.log('Not running in Electron environment');
    }
}

// Unified IPC wrapper - routes to Tauri or Electron as appropriate
const reddIpc = {
    async send(channel, ...args) {
        if (reddIsTauri && typeof tauriAPI !== 'undefined') {
            // Map Electron channel names to Tauri commands
            const channelMap = {
                'exit-focus-mode': () => tauriAPI.exitFocusMode(args[0]?.taskId ?? null),
                'open-focus-window': () => tauriAPI.openFocusWindow(
                    args[0]?.taskId,
                    args[0]?.taskName,
                    args[0]?.duration,
                    args[0]?.initialTimeSpent,
                    args[0]?.anchorLeft ?? null,
                    args[0]?.anchorRight ?? null,
                    args[0]?.anchorTop ?? null
                ),
                'window-minimize': () => tauriAPI.windowMinimize(),
                'window-maximize': () => tauriAPI.windowMaximize(),
                'window-close': () => tauriAPI.windowClose(),
                'enter-focus-mode': () => tauriAPI.openFocusWindow(
                    args[0]?.taskId,
                    args[0]?.taskName || args[0],
                    args[0]?.duration,
                    args[0]?.initialTimeSpent,
                    args[0]?.anchorLeft ?? null,
                    args[0]?.anchorRight ?? null,
                    args[0]?.anchorTop ?? null
                ),
                'set-focus-window-size': () => tauriAPI.setFocusWindowSize(args[0]),
                'set-focus-window-height': () => tauriAPI.setFocusWindowHeight(args[0]),
                'enter-fullscreen-focus': () => tauriAPI.enterFullscreenFocus(),
                'enter-fullscreen-focus-handoff': () => tauriAPI.enterFullscreenFocusHandoff(
                    args[0]?.taskId,
                    args[0]?.taskName,
                    args[0]?.duration,
                    args[0]?.initialTimeSpent
                ),
                'exit-fullscreen-focus-handoff': () => tauriAPI.exitFullscreenFocusHandoff(
                    args[0]?.taskId,
                    args[0]?.taskName,
                    args[0]?.duration,
                    args[0]?.initialTimeSpent
                ),
                'exit-fullscreen-focus-to-home': () => tauriAPI.exitFullscreenFocusToHome(
                    args[0]?.taskId
                ),
                'refresh-main-window': () => tauriAPI.refreshMainWindow(),
                'task-updated': () => tauriAPI.taskUpdated(args[0]?.taskId, args[0]?.text),
                'start-basecamp-auth': async () => {
                    console.log('[Tauri OAuth] Invoking start_basecamp_auth command');
                    try {
                        await tauriAPI.invoke('start_basecamp_auth');
                        console.log('[Tauri OAuth] Command completed');
                    } catch (e) {
                        console.error('[Tauri OAuth] Command failed:', e);
                    }
                },
                'window-drag-start': () => tauriAPI.startDrag(),
                'window-drag-end': () => { } // No-op, drag ends automatically
            };
            const handler = channelMap[channel];
            if (handler) {
                try { await handler(); } catch (e) { console.error(`reddIpc.send(${channel}) error:`, e); }
            } else {
                console.warn(`Unknown Tauri channel: ${channel}`);
            }
        } else if (ipcRenderer) {
            ipcRenderer.send(channel, ...args);
        }
    },

    async invoke(channel, ...args) {
        if (reddIsTauri && typeof tauriAPI !== 'undefined') {
            const channelMap = {
                'get-app-version': () => tauriAPI.getAppVersion(),
                'fetch-reminders-lists': () => tauriAPI.fetchRemindersLists(),
                'fetch-reminders-tasks': () => tauriAPI.fetchRemindersTasks(args[0]),
                'update-reminders-status': () => tauriAPI.updateRemindersStatus(args[0], args[1]),
                'update-reminders-title': () => tauriAPI.updateRemindersTitle(args[0], args[1]),
                'update-reminders-notes': () => tauriAPI.updateRemindersNotes(args[0], args[1]),
                'delete-reminders-task': () => tauriAPI.deleteRemindersTask(args[0]),
                'create-reminders-task': () => tauriAPI.createRemindersTask(args[0], args[1])
            };
            const handler = channelMap[channel];
            if (handler) {
                return await handler();
            }
            console.warn(`Unknown Tauri invoke channel: ${channel}`);
            return null;
        } else if (ipcRenderer) {
            return ipcRenderer.invoke(channel, ...args);
        }
        return null;
    },

    on(channel, callback) {
        if (reddIsTauri && typeof tauriAPI !== 'undefined') {
            // Set up Tauri event listener
            return tauriAPI.onEvent(channel, callback);
        } else if (ipcRenderer) {
            ipcRenderer.on(channel, callback);
            return () => ipcRenderer.removeListener(channel, callback);
        }
        return () => { };
    }
};

// Shell wrapper for opening external URLs
const openExternal = async (url) => {
    if (reddIsTauri && typeof tauriAPI !== 'undefined') {
        await tauriAPI.openExternal(url);
    } else if (shell) {
        shell.openExternal(url);
    } else {
        window.open(url, '_blank');
    }
};

function getLaunchParams() {
    const params = new URLSearchParams(window.location.search || '');
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) return params;

    const hashParams = new URLSearchParams(hash);
    // Fill missing keys from hash so query params still take precedence.
    hashParams.forEach((value, key) => {
        if (!params.has(key)) {
            params.set(key, value);
        }
    });
    return params;
}

const launchParams = getLaunchParams();
let isFocusPanelWindow = launchParams.get('focus') === '1';
let isNativeFullscreenFocusWindow = isFocusPanelWindow && launchParams.get('fullscreen') === '1';

// Add body class for focus panel window styling (rounded corners, transparent background)
if (isFocusPanelWindow) {
    document.documentElement.classList.add('focus-panel-window');
    document.body.classList.add('focus-panel-window');
}

function markAsFocusPanelWindow() {
    if (isFocusPanelWindow) return;
    isFocusPanelWindow = true;
    isNativeFullscreenFocusWindow = launchParams.get('fullscreen') === '1';
    document.documentElement.classList.add('focus-panel-window');
    document.body.classList.add('focus-panel-window');
}

function detectFocusPanelByWindowLabel() {
    if (!reddIsTauri || typeof window === 'undefined' || !window.__TAURI__ || !window.__TAURI__.window) {
        return false;
    }
    try {
        const current = window.__TAURI__.window.getCurrentWindow?.();
        const label = typeof current?.label === 'function' ? current.label() : current?.label;
        return typeof label === 'string' && (label.startsWith('focus-') || label.startsWith('focusfs-'));
    } catch (_) {
        return false;
    }
}

// Application state
let currentGroupId = null;
let groups = {};
let currentTabId = null;
let tabs = {};
let taskCounter = 0;
let isFocusMode = false;
let isDoneCollapsed = false; // New state for done section
let doneMaxHeight = 140; // New state for done section resize
let enableGroups = false; // Feature toggle for tab groups
let enablePlan = false; // Feature toggle for plan mode
let focusStartTime = null;
let previousFocusStartTime = null;
let focusDuration = null; // Expected duration in minutes for the current focus session
let focusTimerInterval = null;
// Track dragged items
let draggedTaskId = null;
let draggedTabId = null;
let draggedGroupId = null; // Track dragged group
let focusedTaskId = null; // To track which task is currently in focus mode
let activeFocusTaskIds = new Set(); // Used to style focused tasks in the main window
let currentView = 'lists'; // 'lists', 'favourites', or 'plan'
let favouritesOrder = []; // Order of favourite task IDs for custom sorting
let planModuleLoaded = false; // Track if plan module has been initialized
let currentLang = 'en'; // Current language

// Translations
const translations = {
    en: {
        // Add task
        addTaskPlaceholder: 'Add task...',
        // Done section
        done: 'Done',
        clearAll: 'Clear all',
        // Footer
        madeWith: 'Made with',
        by: 'by',
        // Settings modal
        settings: 'Settings',
        language: 'Language',
        themeMode: 'Light/dark mode',
        themeLight: 'Light',
        themeDark: 'Dark',
        themeSystem: 'Auto',
        enableTabGroups: 'Enable Tab Groups',
        enablePlanMode: 'Enable plan mode (beta)',
        tabGroupsInfo: 'Organize your to-do lists into groups (shown in a top bar).',
        dataManagement: 'Data Management',
        dataManagementDesc: 'Backup or restore your data.',
        exportBackup: 'Export Backup',
        importBackup: 'Import Backup',
        integrations: 'Integrations',
        connectAppleReminders: 'Connect to Apple Reminders',
        connectedAppleReminders: 'Connected to Apple Reminders',
        remindersInfo: 'Import tasks from Apple Reminders.',
        connectBasecamp: 'Connect to Basecamp',
        connectedBasecamp: 'Connected to Basecamp',
        basecampInfo: 'Sync your to-do lists with Basecamp project management software.',
        disconnect: 'Disconnect',
        yourVersion: 'Your version',
        close: 'Close',
        // Tooltips
        settingsTooltip: 'Settings',
        moreInfo: 'More info',
        deleteAllCompleted: 'Delete all completed tasks',
        // Modals
        renameList: 'Rename list',
        cancel: 'Cancel',
        save: 'Save',
        deleteConfirm: 'Delete this list?',
        delete: 'Delete',
        deleteList: 'Delete list',
        // New items for plan
        newItems: 'New items:',
        addGroup: 'Add Group',
        // Focus mode
        focus: 'Focus',
        exitFocus: 'Exit Focus',
        // Time
        minutes: 'm',
    },
    da: {
        // Add task
        addTaskPlaceholder: 'Tilføj opgave...',
        // Done section
        done: 'Færdig',
        clearAll: 'Ryd alle',
        // Footer
        madeWith: 'Lavet med',
        by: 'af',
        // Settings modal
        settings: 'Indstillinger',
        language: 'Sprog',
        themeMode: 'Lys/mørk tilstand',
        themeLight: 'Lys',
        themeDark: 'Mørk',
        themeSystem: 'Auto',
        enableTabGroups: 'Aktiver fanegrupper',
        enablePlanMode: 'Aktiver plantilstand (beta)',
        tabGroupsInfo: 'Organiser dine to-do lister i grupper (vist i en topbar).',
        dataManagement: 'Datahåndtering',
        dataManagementDesc: 'Sikkerhedskopier eller gendan dine data.',
        exportBackup: 'Eksporter sikkerhedskopi',
        importBackup: 'Importer sikkerhedskopi',
        integrations: 'Integrationer',
        connectAppleReminders: 'Opret forbindelse til Apple Påmindelser',
        connectedAppleReminders: 'Forbundet til Apple Påmindelser',
        remindersInfo: 'Importer opgaver fra Apple Påmindelser.',
        connectBasecamp: 'Opret forbindelse til Basecamp',
        connectedBasecamp: 'Forbundet til Basecamp',
        basecampInfo: 'Synkroniser dine to-do lister med Basecamp projektstyringssoftware.',
        disconnect: 'Afbryd forbindelse',
        yourVersion: 'Din version',
        close: 'Luk',
        // Tooltips
        settingsTooltip: 'Indstillinger',
        moreInfo: 'Mere info',
        deleteAllCompleted: 'Slet alle færdige opgaver',
        // Modals
        renameList: 'Omdøb liste',
        cancel: 'Annuller',
        save: 'Gem',
        deleteConfirm: 'Slet denne liste?',
        delete: 'Slet',
        deleteList: 'Slet liste',
        // New items for plan
        newItems: 'Nye elementer:',
        addGroup: 'Tilføj gruppe',
        // Focus mode
        focus: 'Fokus',
        exitFocus: 'Afslut fokus',
        // Time
        minutes: 'm',
    }
};

function t(key) {
    return translations[currentLang]?.[key] || translations.en[key] || key;
}

// Cross-tab task dragging state
let dragSourceTabId = null; // The tab where the dragged task originated
let tabHoverTimeout = null; // Timer for auto-switching tabs when hovering
let dragTargetTabId = null; // The tab we've switched to while dragging (null if same as source)
let dragPlaceholderPosition = 0; // Position where the placeholder is in the target tab

// View Switcher Elements
const viewListsBtn = document.getElementById('view-lists-btn');
const viewFavBtn = document.getElementById('view-fav-btn');
const viewPlanBtn = document.getElementById('view-plan-btn');
const planMode = document.getElementById('plan-mode');
const groupsContainerMain = document.querySelector('.groups-container');
const tabsContainerMain = document.querySelector('.tabs-container');

// Basecamp State
let basecampConfig = {
    accountId: null,
    accessToken: null,
    refreshToken: null,
    clientId: null,
    clientSecret: null,
    email: null,
    isConnected: false
};

// Reminders State
let remindersConfig = {
    isConnected: false
};


// DOM elements
const groupsContainer = document.querySelector('.groups');
const tabsContainer = document.querySelector('.tabs');
const tasksContainer = document.querySelector('.tasks-container');
const newTaskInput = document.getElementById('new-task-input');
const addTaskBtn = document.getElementById('add-task-btn');
const addTabBtn = document.getElementById('add-tab-btn');
const durationInputContainer = document.getElementById('duration-input-container');
const taskDurationInput = document.getElementById('task-duration-input');
const settingsBtn = document.getElementById('settings-btn');
const syncBtn = document.getElementById('sync-btn');

function snapDurationToStep(value, direction, step = 5) {
    const n = Number.isFinite(value) ? value : 0;
    if (direction === 'up') {
        return (n % step === 0) ? (n + step) : (Math.ceil(n / step) * step);
    }
    // direction === 'down'
    return (n % step === 0) ? (n - step) : (Math.floor(n / step) * step);
}

function generateUniqueCollectionId(prefix, collection) {
    let candidate = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    while (collection[candidate]) {
        candidate = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    }
    return candidate;
}

// Done section elements
const doneContainer = document.getElementById('done-container');
const doneTasksContainer = document.querySelector('.done-tasks');
const deleteAllBtn = document.getElementById('delete-all-btn');
const doneTimeSpent = document.getElementById('done-time-spent');

// Modal elements
const tabNameModal = document.getElementById('tab-name-modal');
const modalTitle = document.getElementById('modal-title');
const tabNameInput = document.getElementById('tab-name-input');
const cancelTabBtn = document.getElementById('cancel-tab-btn');
const createTabBtn = document.getElementById('create-tab-btn');
// Basecamp Modal Elements
const basecampSelection = document.getElementById('basecamp-selection');
const bcProjectSelect = document.getElementById('bc-project-select');
const bcListSelect = document.getElementById('bc-list-select');
const bcListWrapper = document.getElementById('bc-list-wrapper');

// Settings Modal Elements
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const bcAuthContainer = document.getElementById('bc-auth-container');
const bcConnectionStatus = document.getElementById('bc-connection-status');
const bcLoginForm = document.getElementById('bc-login-form');
const bcAccountIdInput = document.getElementById('bc-account-id');
const bcEmailInput = document.getElementById('bc-email');
const bcAccessTokenInput = document.getElementById('bc-access-token');
const bcRefreshTokenInput = document.getElementById('bc-refresh-token');
const bcClientIdInput = document.getElementById('bc-client-id');
const bcClientSecretInput = document.getElementById('bc-client-secret');
const connectBcBtn = document.getElementById('connect-bc-btn');
const disconnectBcBtn = document.getElementById('disconnect-bc-btn');
const bcHelpLink = document.getElementById('bc-help-link');
const remindersConnectBtn = document.getElementById('reminders-connect-btn');
const remindersStatus = document.getElementById('reminders-status');
const remindersSelection = document.getElementById('reminders-selection');
const remindersListSelect = document.getElementById('reminders-list-select');
const remindersSelectionLabel = remindersSelection ? remindersSelection.querySelector('.bc-label') : null;
const disconnectRemindersBtn = document.getElementById('disconnect-reminders-btn');
// New elements
const oauthConnectBtn = document.getElementById('oauth-connect-btn');
const toggleManualAuthBtn = document.getElementById('toggle-manual-auth');
const manualAuthFields = document.getElementById('manual-auth-fields');
const bcAccountInfo = document.getElementById('bc-account-info');

// Delete Confirm Modal Elements
const deleteConfirmModal = document.getElementById('delete-confirm-modal');
const deleteConfirmMessage = document.getElementById('delete-confirm-message');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

// Generic Confirm Modal Elements
const confirmModal = document.getElementById('confirm-modal');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmModalCancel = document.getElementById('confirm-modal-cancel');
const confirmModalOk = document.getElementById('confirm-modal-ok');

// Undo Elements
const undoToast = document.getElementById('undo-toast');
const undoMessage = document.getElementById('undo-message');
const undoBtn = document.getElementById('undo-btn');
const closeUndoBtn = document.getElementById('close-undo-btn');

// Track which tab is being renamed
let renamingTabId = null;
// Track which group is being renamed
let renamingGroupId = null;
let remindersGroupsForImport = new Map(); // key => { name, lists[] }
// Track which tab is pending deletion
let pendingDeleteTabId = null;
// Track which group is pending deletion
let pendingDeleteGroupId = null;

// Undo State
let lastDeletedItem = null; // { type: 'tab'|'group', data: object, index: number, ... }
let undoTimeout = null;

// Focus mode elements
const normalMode = document.getElementById('normal-mode');
const focusMode = document.getElementById('focus-mode');
const focusTaskName = document.getElementById('focus-task-name');
const focusTimer = document.getElementById('focus-timer');
const exitFocusBtn = document.getElementById('exit-focus-btn');
const completeFocusBtn = document.getElementById('complete-focus-btn');
const resetFocusBtn = document.getElementById('reset-focus-btn');
const fullscreenFocusBtn = document.getElementById('fullscreen-focus-btn');

// Theme Management
const themeSelect = document.getElementById('theme-select');

function applyTheme(theme) {
    if (theme === 'system') {
        // Follow system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    } else if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'system';

    if (themeSelect) {
        themeSelect.value = savedTheme;
    }

    applyTheme(savedTheme);
}

// Listen for system theme changes (for when "System" is selected)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentTheme = localStorage.getItem('theme') || 'system';
    if (currentTheme === 'system') {
        applyTheme('system');
    }
});

if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        localStorage.setItem('theme', theme);
        applyTheme(theme);
    });
}

// Language Management
const languageSelect = document.getElementById('language-select');

function applyTranslations() {
    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    // Add task placeholder
    const newTaskInput = document.getElementById('new-task-input');
    if (newTaskInput) newTaskInput.placeholder = t('addTaskPlaceholder');

    // Done section
    const doneLabel = document.querySelector('.done-label');
    if (doneLabel) doneLabel.textContent = t('done');

    const deleteAllBtn = document.getElementById('delete-all-btn');
    if (deleteAllBtn) {
        deleteAllBtn.textContent = t('clearAll');
        deleteAllBtn.title = t('deleteAllCompleted');
    }

    // Footer
    const footerText = document.querySelector('.footer-text');
    if (footerText) {
        footerText.innerHTML = `${t('madeWith')} <span class="heart">♥</span> ${t('by')} <a href="https://reddfocus.org" target="_blank">reddfocus.org</a>`;
    }

    // Export/Import buttons
    const exportBtn = document.getElementById('export-data-btn');
    if (exportBtn) exportBtn.textContent = t('exportBackup');

    const importBtn = document.getElementById('import-data-btn');
    if (importBtn) importBtn.textContent = t('importBackup');

    // Settings button tooltip
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) settingsBtn.title = t('settingsTooltip');

    // Plan module - update labels if loaded
    if (planModuleLoaded && typeof PlanModule !== 'undefined' && PlanModule.refresh) {
        PlanModule.refresh();
    }
}

function initLanguage() {
    const savedLanguage = localStorage.getItem('language') || 'en';
    currentLang = savedLanguage;
    if (languageSelect) languageSelect.value = savedLanguage;
    applyTranslations();
}

if (languageSelect) {
    languageSelect.addEventListener('change', (e) => {
        currentLang = e.target.value;
        localStorage.setItem('language', e.target.value);
        applyTranslations();
    });
}

// Initialize app
function initApp() {
    // Windows fallback: in some cases the focus window can be launched without
    // URL params. If the window label indicates focus mode, force panel mode.
    if (!isFocusPanelWindow && detectFocusPanelByWindowLabel()) {
        markAsFocusPanelWindow();
    }

    // Load saved data or create default tab
    loadData();

    // If this is the dedicated focus panel window (macOS), hide the full UI immediately.
    // Read task data from URL params and enter focus mode.
    if (isFocusPanelWindow) {
        normalMode.classList.add('hidden');
        focusMode.classList.remove('hidden');

        // Read task data from URL params (passed by Rust when creating the panel)
        const taskName = launchParams.get('taskName') || 'Task';
        const taskId = launchParams.get('taskId');
        const duration = launchParams.get('duration') ? parseFloat(launchParams.get('duration')) : null;
        const timeSpent = launchParams.get('timeSpent') ? parseFloat(launchParams.get('timeSpent')) : 0;

        // Store the task ID for the focus panel
        if (taskId) {
            focusedTaskId = taskId;
            activeFocusTaskIds.add(taskId);
        }

        // Delay slightly to ensure DOM is ready
        setTimeout(() => {
            enterFocusMode(taskName, duration > 0 ? duration : null, timeSpent);
        }, 100);
    }

    // Apply saved max height
    if (doneMaxHeight !== undefined && doneMaxHeight !== null) {
        doneContainer.style.maxHeight = `${doneMaxHeight}px`;
        if (doneMaxHeight === 0) {
            doneContainer.style.paddingTop = '0';
            doneContainer.style.paddingBottom = '0';
        }
    }

    // Migration: Create default group if none exists
    if (Object.keys(groups).length === 0) {
        createGroup('General');
    } else if (!currentGroupId || !groups[currentGroupId]) {
        // If we have groups but invalid current ID, pick first
        currentGroupId = Object.keys(groups)[0];
    }

    // Migration: Assign orphan tabs to current group
    let hasOrphans = false;
    Object.values(tabs).forEach(tab => {
        if (!tab.groupId) {
            tab.groupId = currentGroupId;
            hasOrphans = true;
        }
    });
    if (hasOrphans) saveData();

    if (Object.keys(tabs).length === 0) {
        createNewTab('Tasks');
    }

    // Set up event listeners
    setupEventListeners();

    // Render groups
    renderGroups();

    // Load the first tab of current group
    const currentGroupTabs = Object.values(tabs).filter(t => t.groupId === currentGroupId);
    if (currentGroupTabs.length > 0) {
        // If current tab is in current group, stay on it, otherwise switch to first in group
        if (!tabs[currentTabId] || tabs[currentTabId].groupId !== currentGroupId) {
            switchToTab(currentGroupTabs[0].id);
        } else {
            // Just render tabs
            renderTabs();
            renderTasks();
            // Update sync button state
            updateSyncButtonState();
        }
    } else if (Object.keys(tabs).length > 0) {
        // Should not happen if we migrate correctly, but safety fallback
        renderTabs();
        renderTasks();
    }
    initTheme(); // Initialize theme
    initLanguage(); // Initialize language

    // Check Basecamp connection status
    updateBasecampUI();
    updateRemindersUI();

    // Update plan button visibility based on settings
    updatePlanButtonVisibility();

    // Restore preferred view after data/UI initialization.
    const savedView = localStorage.getItem('currentView');
    if (savedView === 'plan' && enablePlan) {
        switchView('plan');
    } else if (savedView === 'favourites') {
        switchView('favourites');
    } else {
        switchView('lists');
    }

    // Show window controls on non-Mac platforms
    if (platform !== 'darwin') {
        const winControls = document.getElementById('window-controls');
        if (winControls) {
            winControls.classList.remove('hidden');
        }
    }

}

// Group Management
function createGroup(name) {
    const groupId = generateUniqueCollectionId('group', groups);
    const groupName = name.trim() || 'New Group';

    groups[groupId] = {
        id: groupId,
        name: groupName,
        order: Object.keys(groups).length
    };

    saveData();
    switchToGroup(groupId);
    return groupId;
}

function switchToGroup(groupId) {
    if (!groups[groupId]) return;

    currentGroupId = groupId;
    renderGroups();

    // Switch to first tab in this group
    const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);
    if (groupTabs.length > 0) {
        switchToTab(groupTabs[0].id);
    } else {
        // No tabs in this group?
        currentTabId = null;
        renderTabs();
        renderTasks();
    }
}

// Tab management
function createNewTab(name, bcProjectId = null, bcListId = null, remindersListId = null, groupIdOverride = null) {
    const tabId = generateUniqueCollectionId('tab', tabs);
    const tabName = name.trim() || 'New Tab';

    tabs[tabId] = {
        id: tabId,
        name: tabName,
        tasks: [],
        basecampProjectId: bcProjectId,
        basecampListId: bcListId,
        remindersListId: remindersListId, // Reminders List ID
        groupId: groupIdOverride || currentGroupId // Assign to explicit group or current group
    };

    renderTabs();
    saveData();

    // If connected to Basecamp, fetch tasks immediately
    if (bcProjectId && bcListId) {
        syncBasecampList(tabId);
    }
    // If connected to Reminders, fetch tasks immediately
    if (remindersListId) {
        syncRemindersList(tabId);
    }

    return tabId;
}

function switchToTab(tabId) {
    if (!tabs[tabId]) return;

    // Ensure we are in the right group (in case we switch programmatically)
    if (tabs[tabId].groupId && tabs[tabId].groupId !== currentGroupId) {
        currentGroupId = tabs[tabId].groupId;
        renderGroups();
    }

    currentTabId = tabId;
    renderTabs();
    renderTasks();

    // Update sync button state
    updateSyncButtonState();
}

// Helper function to show a styled confirmation modal
// Returns a Promise that resolves to true (OK clicked) or false (Cancel clicked)
function showConfirmModal(title, message, okText = 'OK', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        confirmModalTitle.textContent = title;
        confirmModalMessage.textContent = message;
        confirmModalOk.textContent = okText;
        confirmModalCancel.textContent = cancelText;
        confirmModal.classList.remove('hidden');

        const cleanup = () => {
            confirmModal.classList.add('hidden');
            confirmModalOk.removeEventListener('click', handleOk);
            confirmModalCancel.removeEventListener('click', handleCancel);
        };

        const handleOk = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        confirmModalOk.addEventListener('click', handleOk);
        confirmModalCancel.addEventListener('click', handleCancel);
    });
}

// Helper function to update sync button visibility and state based on current tab and connection status
function updateSyncButtonState() {
    // Handle favourites view - show sync button if any favourited tasks belong to synced lists
    if (currentView === 'favourites') {
        const syncedTabsWithFavourites = getSyncedTabsWithFavourites();

        if (syncedTabsWithFavourites.length === 0) {
            syncBtn.classList.add('hidden');
            return;
        }

        // Determine connection status for all relevant synced services
        let hasBasecamp = false;
        let hasReminders = false;
        syncedTabsWithFavourites.forEach(tabId => {
            const tab = tabs[tabId];
            if (tab.basecampListId) hasBasecamp = true;
            if (tab.remindersListId) hasReminders = true;
        });

        const basecampDisconnected = hasBasecamp && !basecampConfig.isConnected;
        const remindersDisconnected = hasReminders && !remindersConfig.isConnected;

        syncBtn.classList.remove('hidden');

        if (basecampDisconnected || remindersDisconnected) {
            syncBtn.classList.add('disconnected');
            const services = [];
            if (basecampDisconnected) services.push('Basecamp');
            if (remindersDisconnected) services.push('Apple Reminders');
            syncBtn.title = `${services.join(' & ')} disconnected - click to reconnect`;
        } else {
            syncBtn.classList.remove('disconnected');
            const services = [];
            if (hasBasecamp) services.push('Basecamp');
            if (hasReminders) services.push('Apple Reminders');
            syncBtn.title = 'Sync favourites with ' + services.join(' & ');
        }
        return;
    }

    // Handle lists view
    if (!currentTabId || !tabs[currentTabId]) {
        syncBtn.classList.add('hidden');
        return;
    }

    const tab = tabs[currentTabId];
    const isSyncedToBasecamp = !!tab.basecampListId;
    const isSyncedToReminders = !!tab.remindersListId;

    if (!isSyncedToBasecamp && !isSyncedToReminders) {
        // Not a synced list - hide button
        syncBtn.classList.add('hidden');
        syncBtn.classList.remove('disconnected');
        syncBtn.title = 'Sync';
        return;
    }

    // Check connection status for the relevant service(s)
    const basecampDisconnected = isSyncedToBasecamp && !basecampConfig.isConnected;
    const remindersDisconnected = isSyncedToReminders && !remindersConfig.isConnected;

    syncBtn.classList.remove('hidden');

    if (basecampDisconnected || remindersDisconnected) {
        // Show button but mark as disconnected
        syncBtn.classList.add('disconnected');
        const services = [];
        if (basecampDisconnected) services.push('Basecamp');
        if (remindersDisconnected) services.push('Apple Reminders');
        syncBtn.title = `${services.join(' & ')} disconnected - click to reconnect`;
    } else {
        syncBtn.classList.remove('disconnected');
        syncBtn.title = 'Sync with ' + (isSyncedToBasecamp ? 'Basecamp' : '') + (isSyncedToBasecamp && isSyncedToReminders ? ' & ' : '') + (isSyncedToReminders ? 'Apple Reminders' : '');
    }
}

function closeTab(tabId) {
    if (Object.keys(tabs).length <= 1) {
        alert('You must have at least one tab!');
        return;
    }

    const tab = tabs[tabId];
    if (tab.tasks && tab.tasks.length > 0) {
        const completedCount = tab.tasks.filter(t => t.completed).length;
        const uncompletedCount = tab.tasks.length - completedCount;

        const confirmMessage = `Are you sure you wanted to delete the todo-list <strong>'${tab.name}'</strong>, with ${uncompletedCount} uncompleted and ${completedCount} completed tasks?`;

        showDeleteConfirmModal(tabId, confirmMessage);
        return;
    }

    performTabDeletion(tabId);
}

function performTabDeletion(tabId) {
    if (!tabs[tabId]) return;

    const tabIndex = Object.keys(tabs).indexOf(tabId);

    // Save for undo
    lastDeletedItem = {
        type: 'tab',
        data: JSON.parse(JSON.stringify(tabs[tabId])), // Deep copy
        index: tabIndex,
        originalGroupId: tabs[tabId].groupId
    };
    showUndoToast(`List '${tabs[tabId].name}' deleted`);

    delete tabs[tabId];

    // Switch to adjacent tab or first tab
    if (currentTabId === tabId) {
        const remainingTabs = Object.keys(tabs);
        currentTabId = remainingTabs[Math.max(0, Math.min(tabIndex, remainingTabs.length - 1))];
    }

    renderTabs();
    renderTasks();
    saveData();
}

// Undo Functions
function showUndoToast(message) {
    undoMessage.textContent = message;
    undoToast.classList.remove('hidden');

    // Clear existing timeout
    if (undoTimeout) clearTimeout(undoTimeout);

    // Auto hide after 5 seconds
    undoTimeout = setTimeout(() => {
        hideUndoToast();
    }, 5000);
}

function hideUndoToast() {
    undoToast.classList.add('hidden');
    if (undoTimeout) clearTimeout(undoTimeout);
}

async function performUndo() {
    if (!lastDeletedItem) return;

    if (lastDeletedItem.type === 'tab') {
        const tab = lastDeletedItem.data;
        tabs[tab.id] = tab;

        // Switch to restored tab
        switchToTab(tab.id);

    } else if (lastDeletedItem.type === 'group') {
        const group = lastDeletedItem.data;
        const groupTabs = lastDeletedItem.tabs;

        // Restore group
        groups[group.id] = group;

        // Restore tabs
        groupTabs.forEach(tab => {
            tabs[tab.id] = tab;
        });

        // Switch to restored group
        currentGroupId = group.id;
        renderGroups();

        if (groupTabs.length > 0) {
            switchToTab(groupTabs[0].id);
        }
    } else if (lastDeletedItem.type === 'task') {
        const task = lastDeletedItem.data;
        const tab = tabs[lastDeletedItem.tabId];

        if (tab) {
            // Restore locally
            if (lastDeletedItem.index !== undefined && lastDeletedItem.index >= 0) {
                tab.tasks.splice(lastDeletedItem.index, 0, task);
            } else {
                tab.tasks.push(task);
            }

            // Restore to Basecamp
            if (lastDeletedItem.basecampListId && basecampConfig.isConnected && task.basecampId) {
                // Creating a NEW todo because we can't un-delete easily via API usually, 
                // unless we archived it? Basecamp API uses "recording" buckets. 
                // Actually Basecamp 3 API supports "unarchiving" but we sent a DELETE request.
                // A DELETE request in BC3 usually trashes it. Recovering from trash is hard via API.
                // So we recreate it.
                // But wait, if we recreate it, it gets a NEW ID.
                // So we need to update the local task with the new ID.
                createBasecampTodo(tab.id, task);
            }

            // Restore to Reminders
            if (lastDeletedItem.remindersListId && remindersConfig.isConnected && task.remindersId) {
                // Reminders API also deletes. We must recreate.
                const newId = await createRemindersTask(lastDeletedItem.remindersListId, task.text);
                if (newId) {
                    task.remindersId = newId;
                }
            }

            // Switch to the tab if we aren't on it
            if (currentTabId !== tab.id) {
                switchToTab(tab.id);
            }
        }
    } else if (lastDeletedItem.type === 'tasks_bulk') {
        const tasks = lastDeletedItem.data || [];
        const tab = tabs[lastDeletedItem.tabId];

        if (tab && Array.isArray(tasks) && tasks.length > 0) {
            // Restore locally (append is fine; completedAt sorting controls Done display order)
            tab.tasks.push(...tasks);

            // Restore to Basecamp (recreate, because the API delete is destructive)
            if (lastDeletedItem.basecampListId && basecampConfig.isConnected) {
                tasks.forEach(task => {
                    if (task && task.basecampId) {
                        createBasecampTodo(tab.id, task);
                    }
                });
            }

            // If user is on a different tab, switch so they see the restoration
            if (currentTabId !== tab.id) {
                switchToTab(tab.id);
            }
        }
    }

    lastDeletedItem = null;
    hideUndoToast();
    renderTabs();
    renderTasks();
    saveData();
}

function renameTab(tabId, newName) {
    if (tabs[tabId]) {
        tabs[tabId].name = newName.trim() || 'Untitled';
        renderTabs();
        saveData();
    }
}

function renameGroup(groupId, newName) {
    if (groups[groupId]) {
        groups[groupId].name = newName.trim() || 'Untitled Group';
        renderGroups();
        saveData();
    }
}

function deleteGroup(groupId) {
    if (Object.keys(groups).length <= 1) {
        alert('You must have at least one group!');
        return;
    }

    const group = groups[groupId];
    const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);

    if (groupTabs.length > 0) {
        let totalTasks = 0;
        let completedTasks = 0;

        groupTabs.forEach(tab => {
            if (tab.tasks) {
                totalTasks += tab.tasks.length;
                completedTasks += tab.tasks.filter(t => t.completed).length;
            }
        });

        const uncompletedTasks = totalTasks - completedTasks;

        const confirmMessage = `Are you sure you want to delete the group <strong>'${group.name}'</strong>?<br><br>This will delete <strong>${groupTabs.length} lists</strong> containing ${uncompletedTasks} uncompleted and ${completedTasks} completed tasks.`;

        showGroupDeleteConfirmModal(groupId, confirmMessage);
        return;
    }

    performGroupDeletion(groupId);
}

function performGroupDeletion(groupId) {
    if (!groups[groupId]) return;

    // Delete all tabs in this group
    const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);

    // Save for undo
    lastDeletedItem = {
        type: 'group',
        data: JSON.parse(JSON.stringify(groups[groupId])),
        tabs: JSON.parse(JSON.stringify(groupTabs)), // Save tabs too
        index: groups[groupId].order // Store order/index
    };
    showUndoToast(`Group '${groups[groupId].name}' deleted`);

    groupTabs.forEach(tab => {
        delete tabs[tab.id];
    });

    // Delete the group
    delete groups[groupId];

    // Switch to another group if we deleted the current one
    if (currentGroupId === groupId) {
        const remainingGroups = Object.keys(groups);
        currentGroupId = remainingGroups[0];
    }

    // If we switched groups, we need to pick a valid tab in the new group
    const currentGroupTabs = Object.values(tabs).filter(t => t.groupId === currentGroupId);
    if (currentGroupTabs.length > 0) {
        switchToTab(currentGroupTabs[0].id);
    } else {
        currentTabId = null;
    }

    renderGroups();
    renderTabs();
    renderTasks();
    saveData();
}

// Task management
function addTask(text) {
    if (!text.trim()) return;

    // If no tab is selected (e.g. empty group), create one
    if (!currentTabId) {
        const newTabId = createNewTab('New list');
        switchToTab(newTabId);
        // Wait for render updates if necessary, but synchronous is fine usually.
        // Just ensure currentTabId is set.
    }

    const duration = taskDurationInput.value ? parseInt(taskDurationInput.value) : null;

    const task = {
        id: `task_${++taskCounter}`,
        text: text.trim(),
        completed: false,
        isFavourite: currentView === 'favourites',
        createdAt: new Date().toISOString(),
        expectedDuration: duration,
        actualDuration: null,
        basecampId: null
    };

    let targetTabId = currentTabId;
    if (currentView === 'favourites') {
        const allTabIds = Object.keys(tabs);
        if (allTabIds.length > 0) {
            targetTabId = allTabIds[0];
        }
    }

    if (!targetTabId) return; // Should not happen if tabs exist

    tabs[targetTabId].tasks.push(task);

    // If this is a Basecamp list, create the todo in Basecamp
    if (tabs[targetTabId].basecampListId && basecampConfig.isConnected) {
        createBasecampTodo(targetTabId, task);
    }

    renderTasks();
    saveData();

    // Reset inputs
    newTaskInput.value = '';
    taskDurationInput.value = '';
    durationInputContainer.classList.remove('visible');
    durationInputContainer.classList.remove('has-value'); // Reset this class

    // Reset duration input state
    const durationTriggerBtn = document.getElementById('duration-trigger-btn');
    if (durationTriggerBtn) {
        durationTriggerBtn.classList.remove('hidden');
    }
    taskDurationInput.classList.add('hidden');

    addTaskBtn.disabled = true;
    addTaskBtn.classList.add('hidden');
}

function deleteTask(taskId) {
    const context = getTaskContext(taskId);
    if (!context) return;

    const { task, tabId, tab } = context;
    const taskIndex = tab.tasks.findIndex(t => t.id === taskId);

    if (taskIndex !== -1) {
        // Save for undo
        lastDeletedItem = {
            type: 'task',
            data: JSON.parse(JSON.stringify(task)),
            index: taskIndex,
            tabId: tabId,
            basecampListId: tab.basecampListId,
            remindersListId: tab.remindersListId
        };
        showUndoToast(`Task deleted`);

        // If Basecamp connected, delete remote
        if (tab.basecampListId && basecampConfig.isConnected && task.basecampId) {
            deleteBasecampTodo(tabId, task.basecampId);
        }

        // If Reminders connected, delete remote
        if (tab.remindersListId && remindersConfig.isConnected && task.remindersId) {
            deleteRemindersTask(task.remindersId);
        }

        tab.tasks.splice(taskIndex, 1);
        renderTasks();
        saveData();
    }
}

function showMoveTaskModal(taskId) {
    const context = getTaskContext(taskId);
    if (!context) return;

    const { task, tabId: sourceTabId } = context;

    // Build list of available tabs to move to (excluding current tab)
    const availableTabs = Object.entries(tabs)
        .filter(([id]) => id !== sourceTabId)
        .map(([id, tab]) => ({ id, name: tab.name }));

    if (availableTabs.length === 0) {
        alert('No other lists available to move to.');
        return;
    }

    // Create a simple select modal using the existing modal system
    const modalHtml = `
        <div id="move-task-modal" class="modal-overlay">
            <div class="modal-content">
                <h3>Move task to...</h3>
                <select id="move-task-select" class="bc-select" style="width: 100%; margin-bottom: 16px;">
                    ${availableTabs.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                </select>
                <div class="modal-buttons">
                    <button id="cancel-move-btn" class="modal-btn cancel-btn">Cancel</button>
                    <button id="confirm-move-btn" class="modal-btn create-btn">Move</button>
                </div>
            </div>
        </div>
    `;

    // Append modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('move-task-modal');
    const select = document.getElementById('move-task-select');
    const cancelBtn = document.getElementById('cancel-move-btn');
    const confirmBtn = document.getElementById('confirm-move-btn');

    cancelBtn.addEventListener('click', () => {
        modal.remove();
    });

    confirmBtn.addEventListener('click', () => {
        const targetTabId = select.value;
        if (!targetTabId) return;

        // Remove from source tab
        const sourceTab = tabs[sourceTabId];
        const taskIndex = sourceTab.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            sourceTab.tasks.splice(taskIndex, 1);
        }

        // Add to target tab
        const targetTab = tabs[targetTabId];
        targetTab.tasks.push(task);

        modal.remove();
        renderTasks();
        saveData();
        showUndoToast(`Task moved to "${targetTab.name}"`);
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function toggleTask(taskId) {
    console.log('=== TOGGLE TASK START ===');
    console.log('Task ID:', taskId);

    const context = getTaskContext(taskId);
    if (!context) {
        console.log('❌ Task not found, returning');
        return;
    }

    const { task, tabId, tab } = context;
    const wasCompleted = task.completed;

    // Toggle the completion status
    task.completed = !task.completed;

    // If the task was completed and is now incomplete, move it to the beginning
    if (wasCompleted && !task.completed) {
        console.log('✅ Condition met: was completed and now incomplete, moving to beginning');
        // Remove from current position
        const taskIndex = tab.tasks.indexOf(task);
        if (taskIndex !== -1) {
            tab.tasks.splice(taskIndex, 1);
            // Insert at the beginning
            tab.tasks.unshift(task);
        }
        // Clear completedAt
        task.completedAt = null;
    } else if (!wasCompleted && task.completed) {
        // If task is being marked as completed, set timestamp
        task.completedAt = new Date().toISOString();
    }

    // Always track when status was last changed (for sync conflict resolution)
    task.statusChangedAt = new Date().toISOString();

    // If Basecamp connected, sync status
    if (tab.basecampListId && basecampConfig.isConnected && task.basecampId) {
        updateBasecampCompletion(tabId, task);
    }

    // If Reminders connected, sync status
    if (tab.remindersListId && remindersConfig.isConnected && task.remindersId) {
        updateRemindersCompletion(task.remindersId, task.completed);
    }

    // Find the task element in the DOM and apply visual change immediately
    const taskElement = document.querySelector(`.task-item[data-task-id="${taskId}"]`);
    if (taskElement) {
        const checkbox = taskElement.querySelector('.task-checkbox');
        const textSpan = taskElement.querySelector('.task-text');
        if (checkbox) checkbox.checked = task.completed;
        if (textSpan) {
            if (task.completed) {
                textSpan.classList.add('completed');
            } else {
                textSpan.classList.remove('completed');
            }
        }
    }

    // Save data immediately but delay the visual re-render
    saveData();

    // Wait 300ms before moving task between sections
    setTimeout(() => {
        renderTasks();
    }, 300);
}

function focusTask(taskId, anchorElement = null) {
    console.log('focusTask called with taskId:', taskId);

    const context = getTaskContext(taskId);
    if (!context) {
        console.log('❌ Task not found');
        return;
    }

    const { task } = context;

    // If this task is already focused (as indicated in the main window), clicking the icon exits focus mode.
    if (!isFocusPanelWindow && activeFocusTaskIds.has(taskId)) {
        reddIpc.send('exit-focus-mode', { taskId });
        activeFocusTaskIds.delete(taskId);
        renderTasks();
        return;
    }

    // Use a dedicated floating window for focus mode across platforms.
    if (!isFocusPanelWindow) {
        const anchorRect = anchorElement?.getBoundingClientRect?.();
        // Send viewport-relative coordinates. Backend resolves these against the
        // main window position to avoid OS/browser screen-coordinate drift.
        const anchorLeft = anchorRect ? anchorRect.left : null;
        const anchorRight = anchorRect ? anchorRect.right : null;
        const anchorTop = anchorRect ? anchorRect.top : null;

        activeFocusTaskIds.add(taskId);
        renderTasks();
        reddIpc.send('open-focus-window', {
            taskId,
            taskName: task.text,
            duration: task.expectedDuration ?? null,
            initialTimeSpent: task.timeSpent || 0,
            anchorLeft,
            anchorRight,
            anchorTop
        });
        return;
    }

    focusedTaskId = taskId;
    activeFocusTaskIds.add(taskId);
    console.log('Entering focus mode for task:', task.text);
    enterFocusMode(task.text, task.expectedDuration, task.timeSpent || 0);
}

// Tab drag and drop functions
function handleTabDragStart(e) {
    draggedTabId = e.target.dataset.tabId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleTabDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedTabId = null;

    document.querySelectorAll('.tab').forEach(el => {
        el.classList.remove('drag-over');
    });
}

function handleTabDragOver(e) {
    e.preventDefault();

    if (draggedTabId) {
        const target = e.target.closest('.tab');

        if (target && target.dataset.tabId === draggedTabId) return;

        e.dataTransfer.dropEffect = 'move';

        const container = tabsContainer;
        const afterElement = getDragAfterElement(container, e.clientX, '.tab');
        const draggable = document.querySelector('.tab.dragging');

        if (draggable) {
            if (afterElement == null) {
                const addBtn = container.querySelector('.add-tab-btn-subtle');
                if (addBtn) {
                    container.insertBefore(draggable, addBtn);
                } else {
                    container.appendChild(draggable);
                }
            } else {
                container.insertBefore(draggable, afterElement);
            }
        }
    }
}

function handleTabDrop(e) {
    e.preventDefault();

    if (draggedTabId) {
        saveTabOrderFromDOM();
    }

    document.querySelectorAll('.tab.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
}

function saveTabOrderFromDOM() {
    const tabElements = Array.from(tabsContainer.querySelectorAll('.tab'));
    const newTabs = {};

    tabElements.forEach(el => {
        const tabId = el.dataset.tabId;
        if (tabs[tabId]) {
            newTabs[tabId] = tabs[tabId];
        }
    });

    if (enableGroups) {
        const otherTabs = Object.keys(tabs).filter(key => tabs[key].groupId !== currentGroupId);
        otherTabs.forEach(key => {
            newTabs[key] = tabs[key];
        });
    }

    tabs = newTabs;
    saveData();
}

function saveTabOrderFromDOM() {
    // Reconstruct the tabs object in the new order
    const tabElements = Array.from(tabsContainer.querySelectorAll('.tab'));
    const newTabs = {};

    tabElements.forEach(el => {
        const tabId = el.dataset.tabId;
        if (tabs[tabId]) {
            newTabs[tabId] = tabs[tabId];
        }
    });

    if (enableGroups) {
        // If groups are enabled, preserve tabs from other groups
        const otherTabs = Object.keys(tabs).filter(key => tabs[key].groupId !== currentGroupId);
        otherTabs.forEach(key => {
            newTabs[key] = tabs[key];
        });
    }

    tabs = newTabs;
    saveData();
}

function reorderTabs(draggedId, targetId) {
    const tabIds = Object.keys(tabs);
    const draggedIndex = tabIds.indexOf(draggedId);
    const targetIndex = tabIds.indexOf(targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Create new ordered object
    const newTabs = {};
    const tabArray = Object.entries(tabs);
    const [draggedEntry] = tabArray.splice(draggedIndex, 1);

    // If moving right (higher index), we need to adjust target index because removal shifted indices
    // But splice logic is cleaner if we just use the target index logic similar to tasks
    // Let's reconstruct the array

    // We need to know if we are dropping BEFORE or AFTER the target
    // Typically simpler to just insert at target index

    let insertIndex = targetIndex;
    if (draggedIndex < targetIndex) {
        // If dragging from left to right, we want to insert AFTER the target? 
        // Or standard "insert before" logic. 
        // Actually, in list reordering:
        // [A, B, C, D] -> Drag A to C. Target is C.
        // Remove A: [B, C, D]. Target C is at index 1. Insert at 1: [B, A, C, D] -> effectively swapped?
        // Usually we want to insert AT the position, shifting others right.
        // If I drag A (0) to C (2), I expect [B, C, A, D] or [B, A, C, D]?
        // Let's stick to "insert before target". 
        // But if I drag A to C, and drop, it goes before C.
        // If I drag C to A, and drop, it goes before A.

        // Correction: `splice` insert puts it AT index, pushing existing element at that index to the right.
        // So if I have [A, B, C], drag A to C. Remove A -> [B, C]. Target C is index 1. Splice(1, 0, A) -> [B, A, C].
        // This feels like "swapping" or "placing before".

        // To enable placing "after" the last item, we usually need drop targets. 
        // But for tabs, "place before" is usually fine enough as long as you can reach the end.
        // Since we can't easily drop "after" the last element without a specific target or logic, 
        // let's refine:
        // If draggedIndex < targetIndex (moving right), we probably want to insert AFTER the target visual, 
        // which effectively means index should be targetIndex (since target shifted left).
        // Wait, if [A, B, C]. Remove A -> [B, C]. Target C is index 1. 
        // If I want [B, C, A], I need to insert at index 2.
        // So if dragged < target, insertIndex = targetIndex.
        // If dragged > target (moving left), [A, B, C]. Drag C to A. Remove C -> [A, B]. Target A is index 0. 
        // Insert at 0 -> [C, A, B]. Correct.

        // However, standard splice behavior:
        // const arr = ['A', 'B', 'C']; 
        // Remove 'A' (idx 0): ['B', 'C']. Target 'C' is now idx 1.
        // If I want it before C: splice(1, 0, 'A') -> ['B', 'A', 'C'].
        // If I want it after C: splice(2, 0, 'A') -> ['B', 'C', 'A'].

        // Let's stick to a simple "insert at target index" approach which effectively puts it "before" the target.
        // BUT, if moving right, the target has shifted left by 1.
        // original indices: A:0, B:1, C:2.
        // Drag A to C.
        // Remove A. Array is [B, C]. C is at 1.
        // If we use original target index (2), we insert at 2 (end). -> [B, C, A]. 
        // This feels natural for "drag A onto C".

        // Let's try simply:
        // 1. Convert tabs to array of entries
        // 2. Remove dragged entry
        // 3. Insert at target index (adjusting if needed)

        // Actually, let's use the same logic as tasks:
        // if (draggedIndex < targetIndex) insertIndex = targetIndex;
        // else insertIndex = targetIndex; 

        // Wait, in task logic:
        // if (draggedIndex < targetIndex) insertIndex = targetIndex - 1;
        // That was because we hadn't removed it yet? No, we did splice.
        // Let's look at task logic again:
        // const [draggedTask] = currentTab.tasks.splice(draggedIndex, 1);
        // let insertIndex = targetIndex;
        // if (draggedIndex < targetIndex) insertIndex = targetIndex - 1;
        // currentTab.tasks.splice(insertIndex, 0, draggedTask);

        // Let's copy that logic, it worked for tasks.
        if (draggedIndex < targetIndex) {
            insertIndex = targetIndex; // Note: In tasks I did targetIndex - 1, let's verify why.
            // Tasks: [A, B, C]. Drag A(0) to C(2). 
            // Splice A: [B, C]. C is at 1.
            // targetIndex was 2. 
            // If I use 2-1 = 1. Insert at 1: [B, A, C].
            // If I used 2. Insert at 2: [B, C, A].
            // Usually dropping ON C means "put before C" or "swap with C".
            // If I want to put after C, I need to drop past C.
            // Let's stick to "insert before target" logic.

            insertIndex = targetIndex - 1;
        }
    }

    // Wait, simpler logic for array reordering:
    // 1. Get array of keys.
    // 2. Remove dragged key.
    // 3. Find index of target key in remaining array.
    // 4. Insert dragged key before target key.

    // Let's do that, it's more robust than index math pre-removal.
    const keys = Object.keys(tabs);
    const remainingKeys = keys.filter(k => k !== draggedId);
    const newTargetIndex = remainingKeys.indexOf(targetId);

    // If we are dragging right and dropping on a target, we usually expect it to go AFTER if we passed the center, 
    // but simple "insert before" is standard.
    // Exception: If we are dragging from left to right, and drop on the last item, we might want it to be last?
    // "Insert before" means we can never make it the last item by dropping on the last item.
    // We would need a drop target after the last item.
    // OR, we change logic: if dragging right, place AFTER target. If dragging left, place BEFORE target.

    let finalIndex = newTargetIndex;
    if (draggedIndex < targetIndex) {
        // Dragging right: Insert AFTER target
        finalIndex = newTargetIndex + 1;
    } else {
        // Dragging left: Insert BEFORE target
        finalIndex = newTargetIndex;
    }

    remainingKeys.splice(finalIndex, 0, draggedId);

    // Reconstruct tabs object
    remainingKeys.forEach(key => {
        newTabs[key] = tabs[key];
    });

    tabs = newTabs;
    saveData();
    renderTabs();
}

// Rendering functions
function renderGroups() {
    if (!enableGroups) {
        groupsContainer.style.display = 'none';
        return;
    }
    groupsContainer.style.display = 'flex';
    groupsContainer.innerHTML = '';

    Object.values(groups).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(group => {
        const groupElement = document.createElement('div');
        const isSelected = group.id === currentGroupId;
        const isDimmed = currentGroupId && !isSelected;

        let className = `group-tab ${isSelected ? 'active' : ''} ${isDimmed ? 'dimmed' : ''}`;

        // Add color class if present (or inline style for custom hex colors)
        if (group.color) {
            if (group.color.startsWith('#')) {
                // Custom hex color - apply as inline style
                groupElement.style.backgroundColor = group.color;
                groupElement.style.borderColor = group.color;
            } else {
                // Preset color class
                className += ` tab-bg-${group.color}`;
            }
        }

        groupElement.className = className;
        groupElement.dataset.groupId = group.id;
        groupElement.draggable = true; // Enable group reordering

        // Group drag events
        groupElement.addEventListener('dragstart', handleGroupDragStart);
        groupElement.addEventListener('dragend', handleGroupDragEnd);

        // Group content
        const groupContent = document.createElement('span');
        groupContent.textContent = group.name;
        groupElement.appendChild(groupContent);

        // Click to switch group or rename
        groupElement.addEventListener('click', () => {
            if (group.id !== currentGroupId) {
                switchToGroup(group.id);
            } else {
                showGroupRenameModal(group.id);
            }
        });

        // Add delete button if more than one group AND it is the current group
        if (Object.keys(groups).length > 1 && group.id === currentGroupId) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'group-delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.title = 'Delete group';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteGroup(group.id);
            });
            groupElement.appendChild(deleteBtn);
        }

        // Drag and drop (Drop target for tabs)
        groupElement.addEventListener('dragover', handleGroupDragOver);
        groupElement.addEventListener('drop', handleGroupDrop);
        groupElement.addEventListener('dragleave', handleGroupDragLeave);

        groupsContainer.appendChild(groupElement);
    });

    // Add "Add Group" button
    const addGroupBtn = document.createElement('button');
    addGroupBtn.className = 'add-group-btn';
    addGroupBtn.textContent = '+';
    addGroupBtn.title = 'Add new group';
    addGroupBtn.addEventListener('click', () => {
        // Simple prompt for now
        // TODO: Use a nicer modal similar to tab creation
        // For simplicity/MVP, we can reuse the modal or just prompt
        // Let's reuse the modal logic but tweaked, or just a prompt for now to keep it simple as requested "simple way"
        // A prompt is simplest:
        /*
        const name = prompt('Enter group name:');
        if (name) createGroup(name);
        */
        // Better: Reuse tab modal but set a flag? Or just use standard prompt for MVP.
        // Let's stick to prompt for speed, can upgrade later.
        // Actually, user said "clicking a plus just like for the existing tabs".
        // The existing tabs use a custom modal. It would be nice to use that.
        // Let's make showTabNameModal handle groups too.
        showGroupModal();
    });
    groupsContainer.appendChild(addGroupBtn);
}

function showGroupModal() {
    // Reuse tab modal for groups
    modalTitle.textContent = 'Enter group name';
    createTabBtn.textContent = 'Create Group';
    tabNameInput.value = '';
    tabNameInput.placeholder = 'My Group';
    tabNameModal.classList.remove('hidden');
    tabNameModal.dataset.mode = 'group';

    // Handle Basecamp visibility
    if (basecampConfig.isConnected) {
        basecampSelection.classList.remove('hidden');
        bcProjectSelect.innerHTML = '<option value="">Select a project...</option>';
        bcListWrapper.classList.add('hidden'); // No list selection for groups initially

        fetchBasecampProjects().then(projects => {
            if (projects.length === 0) {
                bcProjectSelect.innerHTML = '<option value="">No projects found</option>';
            } else {
                projects.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    bcProjectSelect.appendChild(opt);
                });
            }
        });
    } else {
        basecampSelection.classList.add('hidden');
    }

    // In group mode, Reminders selection means importing all lists from a list-group/account.
    remindersGroupsForImport = new Map();
    if (remindersConfig.isConnected) {
        remindersSelection.classList.remove('hidden');
        if (remindersSelectionLabel) remindersSelectionLabel.textContent = 'Reminders List Group';
        remindersListSelect.innerHTML = '<option value="">Select a list group...</option>';

        fetchRemindersLists().then(lists => {
            // Group by groupName/sourceName when provided by backend, otherwise fallback to "All Lists".
            const grouped = new Map();
            lists.forEach(list => {
                const groupName = (list.groupName || list.sourceName || 'All Lists').trim();
                if (!grouped.has(groupName)) grouped.set(groupName, []);
                grouped.get(groupName).push(list);
            });

            remindersGroupsForImport = new Map();
            if (grouped.size === 0) {
                remindersListSelect.innerHTML = '<option value="">No list groups found</option>';
                updateGroupImportButtonLabel();
                return;
            }

            remindersListSelect.innerHTML = '<option value="">Select a list group...</option>';
            let idx = 0;
            grouped.forEach((groupLists, groupName) => {
                const key = `group_${idx++}`;
                remindersGroupsForImport.set(key, { name: groupName, lists: groupLists });
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = `${groupName} (${groupLists.length} lists)`;
                remindersListSelect.appendChild(opt);
            });

            updateGroupImportButtonLabel();
        });
    } else {
        remindersSelection.classList.add('hidden');
    }

    // Reset color picker and select next available color for groups
    const colorSwatches = document.querySelectorAll('.color-swatch');
    colorSwatches.forEach(swatch => {
        swatch.classList.remove('selected');
    });

    // Find next color for all groups
    const usedColors = Object.values(groups).map(group => group.color).filter(Boolean);
    const nextColor = findNextColor(usedColors);

    // Select the next color swatch
    const nextColorSwatch = Array.from(colorSwatches).find(swatch => swatch.dataset.color === nextColor);
    if (nextColorSwatch) {
        nextColorSwatch.classList.add('selected');
    } else {
        // Fallback to "none" if color not found
        const noneSwatch = Array.from(colorSwatches).find(swatch => swatch.dataset.color === '');
        if (noneSwatch) {
            noneSwatch.classList.add('selected');
        }
    }

    tabNameInput.focus();
}

function showGroupRenameModal(groupId) {
    renamingGroupId = groupId;
    const group = groups[groupId];
    if (group) {
        modalTitle.textContent = 'Edit group';
        createTabBtn.textContent = 'Save';
        tabNameInput.value = group.name;
        tabNameModal.classList.remove('hidden');
        basecampSelection.classList.add('hidden');
        remindersSelection.classList.add('hidden');
        tabNameModal.dataset.mode = 'group-rename';

        // Select logic for color
        const colorSwatches = document.querySelectorAll('.color-swatch');
        const customColorInput = document.getElementById('custom-color-input');
        const customSwatch = document.querySelector('.color-swatch-custom');

        colorSwatches.forEach(swatch => {
            swatch.classList.remove('selected');
            if (swatch.dataset.color === (group.color || '')) {
                swatch.classList.add('selected');
            }
        });

        // Handle custom hex color
        if (group.color && group.color.startsWith('#')) {
            if (customColorInput) customColorInput.value = group.color;
            if (customSwatch) {
                customSwatch.style.background = group.color;
                customSwatch.classList.add('selected');
            }
        } else {
            // Reset custom swatch to rainbow gradient
            if (customSwatch) {
                customSwatch.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
            }
        }

        tabNameInput.focus();
        tabNameInput.select();
    }
}

// Update existing modal handler to check mode
async function handleModalCreate() {
    const mode = tabNameModal.dataset.mode;
    let name = tabNameInput.value.trim();

    if (mode === 'group') {
        // Get selected color
        let selectedColor = '';
        const activeSwatch = document.querySelector('.color-swatch.selected');
        const customColorInput = document.getElementById('custom-color-input');
        if (activeSwatch) {
            if (activeSwatch.dataset.color === 'custom' && customColorInput) {
                selectedColor = customColorInput.value;
            } else {
                selectedColor = activeSwatch.dataset.color || '';
            }
        }

        // Check if Basecamp project is selected
        const bcProjectId = bcProjectSelect.value;
        const remindersGroupKey = remindersListSelect.value;
        const selectedRemindersGroup = remindersGroupsForImport.get(remindersGroupKey);

        const isImportingBasecamp = bcProjectId && basecampConfig.isConnected;
        const isImportingReminders = !!selectedRemindersGroup && remindersConfig.isConnected;

        if (isImportingBasecamp) {
            createTabBtn.textContent = 'Importing...';
            createTabBtn.disabled = true;
        } else if (isImportingReminders) {
            createTabBtn.textContent = 'Importing...';
            createTabBtn.disabled = true;
        }

        const groupId = createGroup(name);

        // Apply color to the new group
        if (groups[groupId]) {
            groups[groupId].color = selectedColor;
            saveData();
            renderGroups();
        }

        if (isImportingBasecamp) {
            try {
                // Fetch all todo lists from the project
                const lists = await getBasecampTodoLists(bcProjectId);

                // Create tabs for each list
                // Use for...of to allow await if we needed sequential async operations, 
                // but createNewTab is sync (except for the syncBasecampList call which is async background)
                // We want to trigger sync for all of them.

                for (const list of lists) {
                    createNewTab(list.name, bcProjectId, list.id, null, groupId);
                }

                // After creating all tabs, we might want to re-render or switch to the first one?
                // createNewTab already saves and renders.
                // Maybe switch to the first imported tab?
                // The last created tab will be active because createNewTab switches to it?
                // Actually createNewTab implementation DOES NOT call switchToTab automatically?
                // Let's check createNewTab...
                // It returns tabId. It does renderTabs() and saveData().
                // It calls syncBasecampList(tabId) if connected.
                // It DOES NOT call switchToTab.
                // Wait, in the event listener for creating a NEW tab (not group), it calls switchToTab(newTabId).

                // So here, we should decide which tab to switch to. 
                // Probably the first one.
                const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);
                if (groupTabs.length > 0) {
                    switchToTab(groupTabs[0].id);
                }

            } catch (e) {
                console.error('Import Error:', e);
                alert('Failed to import all lists from Basecamp.');
            } finally {
                createTabBtn.textContent = 'Create Group';
                createTabBtn.disabled = false;
            }
        } else if (isImportingReminders) {
            try {
                for (const list of selectedRemindersGroup.lists) {
                    createNewTab(list.name, null, null, list.id, groupId);
                }

                const groupTabs = Object.values(tabs).filter(t => t.groupId === groupId);
                if (groupTabs.length > 0) {
                    switchToTab(groupTabs[0].id);
                }
            } catch (e) {
                console.error('Reminders import Error:', e);
                alert('Failed to import all lists from Apple Reminders group.');
            } finally {
                createTabBtn.textContent = 'Create Group';
                createTabBtn.disabled = false;
            }
        }

        hideTabNameModal();
        tabNameModal.dataset.mode = ''; // Reset
        return;
    } else if (mode === 'group-rename') {
        // Get selected color
        let selectedColor = '';
        const activeSwatch = document.querySelector('.color-swatch.selected');
        const customColorInput = document.getElementById('custom-color-input');
        if (activeSwatch) {
            if (activeSwatch.dataset.color === 'custom' && customColorInput) {
                selectedColor = customColorInput.value;
            } else {
                selectedColor = activeSwatch.dataset.color || '';
            }
        }

        // Update group color
        if (groups[renamingGroupId]) {
            groups[renamingGroupId].color = selectedColor;
        }

        renameGroup(renamingGroupId, name);
        hideTabNameModal();
        tabNameModal.dataset.mode = ''; // Reset
        renamingGroupId = null;
        return;
    }

    // Existing tab creation logic...
    // (We need to update setupEventListeners to use this function instead of inline)
}

// Group Drag Handlers
function handleGroupDragStart(e) {
    draggedGroupId = e.target.dataset.groupId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleGroupDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedGroupId = null;

    document.querySelectorAll('.group-tab').forEach(el => {
        el.classList.remove('drag-over');
    });
}

function handleGroupDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.group-tab');
    if (!target) return;

    // Case 1: Dragging a tab onto a group (to move tab into group)
    if (draggedTabId) {
        e.dataTransfer.dropEffect = 'move';
        target.classList.add('drag-over');
        return;
    }

    // Case 2: Reordering groups (Live Reordering)
    if (draggedGroupId) {
        e.dataTransfer.dropEffect = 'move';

        // Don't reorder if over itself
        if (target.dataset.groupId === draggedGroupId) return;

        // Perform live reordering
        const container = groupsContainer;
        const afterElement = getDragAfterElement(container, e.clientX, '.group-tab');
        const draggable = document.querySelector('.group-tab.dragging');

        if (draggable) {
            if (afterElement == null) {
                container.appendChild(draggable);
            } else {
                container.insertBefore(draggable, afterElement);
            }
        }
    }
}

function handleGroupDragLeave(e) {
    const target = e.target.closest('.group-tab');
    if (target) {
        target.classList.remove('drag-over');
    }
}

function handleGroupDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.group-tab');

    if (target) {
        target.classList.remove('drag-over');
        const targetGroupId = target.dataset.groupId;

        // Case 1: Moving Tab to Group
        if (draggedTabId && targetGroupId) {
            moveTabToGroup(draggedTabId, targetGroupId);
        }

        // Case 2: Group Reordering - Save the new order from DOM
        if (draggedGroupId) {
            saveGroupOrderFromDOM();
        }
    }
}

// Helper to save group order based on DOM position
function saveGroupOrderFromDOM() {
    const groupElements = Array.from(groupsContainer.querySelectorAll('.group-tab'));

    groupElements.forEach((el, index) => {
        const groupId = el.dataset.groupId;
        if (groups[groupId]) {
            groups[groupId].order = index;
        }
    });

    saveData();
    // We don't need to renderGroups() because the DOM is already correct,
    // but we might want to ensure everything is clean.
    // However, if we re-render, we might lose some transient state if any.
    // Usually safe to just save.
}

// Helper to find insertion point
function getDragAfterElement(container, x, selector) {
    const draggableElements = [...container.querySelectorAll(`${selector}:not(.dragging)`)];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        // Measure distance to the center of the element
        const offset = x - box.left - box.width / 2;

        // We are interested in offsets < 0 (cursor is to the left of the center)
        // We want the element where the cursor is just to the left of its center (closest negative offset)
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Helper to find insertion point for vertical lists (tasks)
function getDragAfterElementVertical(container, y, selector) {
    const draggableElements = [...container.querySelectorAll(`${selector}:not(.dragging)`)];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function moveTabToGroup(tabId, targetGroupId) {
    if (tabs[tabId]) {
        // Update group ID
        tabs[tabId].groupId = targetGroupId;
        saveData();

        // Refresh view
        renderTabs();
        renderGroups(); // Optional, maybe to show count?

        // If we moved the active tab to another group, deciding what to do
        // Usually we stay on current group. So the tab disappears from view.
        if (tabId === currentTabId && currentGroupId !== targetGroupId) {
            // Switch to another tab in current group or clear selection
            const currentGroupTabs = Object.values(tabs).filter(t => t.groupId === currentGroupId && t.id !== tabId);
            if (currentGroupTabs.length > 0) {
                switchToTab(currentGroupTabs[0].id);
            } else {
                currentTabId = null;
                renderTabs();
                renderTasks();
            }
        }
    }
}

function renderTabs() {
    tabsContainer.innerHTML = '';

    // Filter tabs by current group only if groups are enabled
    let tabsToRender = Object.values(tabs);
    if (enableGroups) {
        tabsToRender = tabsToRender.filter(tab => tab.groupId === currentGroupId);
    }

    // Sort tabs? Currently they rely on object insertion order, which is usually consistent in JS for non-integer keys.
    // Ideally we would have an 'order' field but for now insertion order is used.

    tabsToRender.forEach(tab => {
        const tabElement = document.createElement('div');
        let className = `tab ${tab.id === currentTabId ? 'active' : ''}`;

        // List tabs use border-only color styling:
        // - active: thick, full-color border
        // - inactive: thin, faded-color border
        if (tab.color) {
            const activeColor = resolveTabColorHex(tab.color);
            const inactiveColor = activeColor ? hexToRgba(activeColor, 0.45) : null;

            if (activeColor && inactiveColor) {
                className += ' tab-colorized';
                tabElement.style.setProperty('--tab-color-active', activeColor);
                tabElement.style.setProperty('--tab-color-inactive', inactiveColor);
            } else if (!tab.color.startsWith('#')) {
                // Fallback for unknown named colors
                className += ` tab-border-${tab.color}`;
            }
        }

        tabElement.className = className;
        tabElement.dataset.tabId = tab.id;
        tabElement.draggable = true; // Enable dragging

        // Tab drag events (for tab reordering)
        tabElement.addEventListener('dragstart', handleTabDragStart);
        tabElement.addEventListener('dragover', (e) => {
            // Handle both tab reordering and task dropping on tabs
            if (draggedTabId) {
                handleTabDragOver(e);
            } else if (draggedTaskId) {
                handleTaskDragOverTab(e);
            }
        });
        tabElement.addEventListener('dragleave', handleTaskDragLeaveTab);
        tabElement.addEventListener('drop', (e) => {
            if (draggedTabId) {
                handleTabDrop(e);
            } else if (draggedTaskId) {
                handleTaskDropOnTab(e);
            }
        });
        tabElement.addEventListener('dragend', handleTabDragEnd);

        // Tab content
        const tabContent = document.createElement('span');

        // Add Basecamp logo if connected
        if (tab.basecampListId) {
            const img = document.createElement('img');
            img.src = './images/basecamp_logo_icon_147315.png';
            img.className = 'basecamp-icon'; // Added class for styling
            img.style.width = '14px';
            img.style.height = '14px';
            img.style.marginRight = '6px';
            img.style.verticalAlign = 'middle';
            img.style.marginBottom = '2px';
            tabContent.appendChild(img);
        }

        // Add Reminders icon if connected
        if (tab.remindersListId) {
            const icon = document.createElement('span');
            // Using an SVG or simple character for now. 
            // A bullet list icon or Apple logo (might be too much).
            // Let's use a list icon SVG.
            icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-bottom:2px;"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`;
            icon.style.marginRight = '6px';
            icon.style.color = '#555'; // Subtle grey
            tabContent.appendChild(icon);
        }

        const textNode = document.createTextNode(tab.name);
        tabContent.appendChild(textNode);

        tabElement.appendChild(tabContent);

        // Close button (only if more than one tab AND it is the current tab)
        if (Object.keys(tabs).length > 1 && tab.id === currentTabId) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tab-close';
            closeBtn.textContent = '×';
            closeBtn.title = 'Close tab';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(tab.id);
            });
            tabElement.appendChild(closeBtn);
        }

        // Click to switch tabs or rename if already active
        tabElement.addEventListener('click', () => {
            if (tab.id === currentTabId) {
                // Active tab clicked - rename it
                showRenameModal(tab.id);
            } else {
                // Inactive tab clicked - switch to it
                switchToTab(tab.id);
            }
        });

        // Double-click to rename
        tabElement.addEventListener('dblclick', (e) => {
            if (e.target.className !== 'tab-close') {
                showRenameModal(tab.id);
            }
        });

        tabsContainer.appendChild(tabElement);
    });

    // Add "Add Tab" button as a subtle plus icon after the last tab
    const addTabBtn = document.createElement('button');
    addTabBtn.className = 'add-tab-btn-subtle';
    addTabBtn.textContent = '+';
    addTabBtn.title = 'Add new tab';
    addTabBtn.addEventListener('click', () => {
        showTabNameModal();
    });
    tabsContainer.appendChild(addTabBtn);
}

function switchView(viewName) {
    if (currentView === viewName) return;
    currentView = viewName;

    // Get content elements that should be hidden in plan view
    const tasksContainer = document.querySelector('.tasks-container');
    const addTaskContainer = document.getElementById('add-task-container');
    const doneContainer = document.querySelector('.done-container');

    // Handle plan view - hide content, show calendar below title bar
    if (currentView === 'plan') {
        viewListsBtn.classList.remove('active');
        viewFavBtn.classList.remove('active');
        if (viewPlanBtn) viewPlanBtn.classList.add('active');

        // Hide all content elements below title bar
        if (groupsContainerMain) groupsContainerMain.style.display = 'none';
        if (tabsContainerMain) tabsContainerMain.style.display = 'none';
        if (tasksContainer) tasksContainer.style.display = 'none';
        if (addTaskContainer) addTaskContainer.style.display = 'none';
        if (doneContainer) doneContainer.style.display = 'none';

        // Show plan mode container
        if (planMode) {
            planMode.classList.remove('hidden');
            planMode.style.display = 'flex';
        }

        // Initialize plan module if not already done
        if (!planModuleLoaded && typeof PlanModule !== 'undefined') {
            PlanModule.init(planMode);
            planModuleLoaded = true;
        }
        localStorage.setItem('currentView', currentView);
        return;
    }

    // For lists/favourites views, hide plan mode and show content
    if (planMode) {
        planMode.classList.add('hidden');
        planMode.style.display = 'none';
    }

    // Show content elements
    if (tasksContainer) tasksContainer.style.display = '';
    if (addTaskContainer) addTaskContainer.style.display = '';
    if (doneContainer) doneContainer.style.display = '';
    if (viewPlanBtn) viewPlanBtn.classList.remove('active');

    if (currentView === 'lists') {
        viewListsBtn.classList.add('active');
        viewFavBtn.classList.remove('active');
        if (groupsContainerMain) groupsContainerMain.style.display = 'flex';
        if (tabsContainerMain) tabsContainerMain.style.display = 'flex';
    } else {
        viewListsBtn.classList.remove('active');
        viewFavBtn.classList.add('active');
        if (groupsContainerMain) groupsContainerMain.style.display = 'none';
        if (tabsContainerMain) tabsContainerMain.style.display = 'none';
    }
    localStorage.setItem('currentView', currentView);
    updateSyncButtonState();
    renderTasks();
}

// Expose switchView globally so plan module can call it
window.switchView = switchView;

// Update plan button visibility based on settings
function updatePlanButtonVisibility() {
    if (viewPlanBtn) {
        if (enablePlan) {
            viewPlanBtn.classList.remove('hidden');
        } else {
            viewPlanBtn.classList.add('hidden');
        }
    }
}

function getAllFavouriteTasks() {
    let allTasks = [];
    Object.keys(tabs).forEach(tabId => {
        const tab = tabs[tabId];
        tab.tasks.forEach(task => {
            if (task.isFavourite) {
                allTasks.push(task);
            }
        });
    });

    // Sort by favouritesOrder if available
    // Tasks not in favouritesOrder go to the end, preserving their relative order
    if (favouritesOrder.length > 0) {
        allTasks.sort((a, b) => {
            const indexA = favouritesOrder.indexOf(a.id);
            const indexB = favouritesOrder.indexOf(b.id);
            // If both are in the order array, sort by their position
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            // If only one is in the order array, it comes first
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            // If neither is in the order array, preserve original order
            return 0;
        });
    }

    return allTasks;
}

function getTaskContext(taskId) {
    // If lists view and currentTabId valid, check there first
    if (currentView === 'lists' && currentTabId && tabs[currentTabId]) {
        const task = tabs[currentTabId].tasks.find(t => t.id === taskId);
        if (task) return { task, tabId: currentTabId, tab: tabs[currentTabId] };
    }

    // Search all
    for (const tabId in tabs) {
        const task = tabs[tabId].tasks.find(t => t.id === taskId);
        if (task) return { task, tabId, tab: tabs[tabId] };
    }
    return null;
}

// Helper to determine the sync type of a tab
// Returns: 'reminders', 'basecamp', or 'local'
function getTabSyncType(tabId) {
    const tab = tabs[tabId];
    if (!tab) return null;

    if (tab.remindersListId) return 'reminders';
    if (tab.basecampListId) return 'basecamp';
    return 'local';
}

// Helper to get all synced tab IDs that contain favourited tasks
function getSyncedTabsWithFavourites() {
    const syncedTabIds = new Set();

    Object.keys(tabs).forEach(tabId => {
        const tab = tabs[tabId];
        const isSynced = tab.basecampListId || tab.remindersListId;

        if (isSynced) {
            const hasFavourites = tab.tasks.some(task => task.isFavourite);
            if (hasFavourites) {
                syncedTabIds.add(tabId);
            }
        }
    });

    return Array.from(syncedTabIds);
}

// Check if two tabs are compatible for task transfer
function areTabsCompatible(sourceTabId, targetTabId) {
    return getTabSyncType(sourceTabId) === getTabSyncType(targetTabId);
}

// Switch to a tab during a drag operation (creates a placeholder)
function switchToTabForDrag(targetTabId) {
    if (!draggedTaskId || !dragSourceTabId) return;

    // Get the original task data for the placeholder
    const sourceTab = tabs[dragSourceTabId];
    if (!sourceTab) return;
    const task = sourceTab.tasks.find(t => t.id === draggedTaskId);
    if (!task) return;

    // Mark that we've switched to a different tab during drag
    dragTargetTabId = targetTabId;
    dragPlaceholderPosition = 0; // Start at top

    // Switch to the target tab
    if (!tabs[targetTabId]) return;

    // Update group if needed
    if (tabs[targetTabId].groupId && tabs[targetTabId].groupId !== currentGroupId) {
        currentGroupId = tabs[targetTabId].groupId;
        renderGroups();
    }

    currentTabId = targetTabId;
    renderTabs();

    // Render tasks with a placeholder
    renderTasksWithPlaceholder(task);

    // Update sync button state
    updateSyncButtonState();
}

// Render tasks with a draggable placeholder at the current position
function renderTasksWithPlaceholder(placeholderTask) {
    const currentTab = tabs[currentTabId];
    if (!currentTab) return;

    const incompleteTasks = currentTab.tasks.filter(task => !task.completed);
    const completedTasks = currentTab.tasks.filter(task => task.completed).sort((a, b) => {
        const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return timeB - timeA;
    });

    tasksContainer.innerHTML = '';

    // Insert placeholder at the right position among incomplete tasks
    let insertedPlaceholder = false;
    incompleteTasks.forEach((task, index) => {
        if (index === dragPlaceholderPosition && !insertedPlaceholder) {
            // Insert placeholder here
            const placeholderEl = createPlaceholderElement(placeholderTask);
            tasksContainer.appendChild(placeholderEl);
            insertedPlaceholder = true;
        }
        const taskElement = createTaskElement(task);
        tasksContainer.appendChild(taskElement);
    });

    // If placeholder should be at the end
    if (!insertedPlaceholder) {
        const placeholderEl = createPlaceholderElement(placeholderTask);
        tasksContainer.appendChild(placeholderEl);
    }

    // Add bottom drag target
    const bottomDragTarget = document.createElement('div');
    bottomDragTarget.className = 'bottom-drag-target';
    bottomDragTarget.addEventListener('dragover', handlePlaceholderDragOver);
    bottomDragTarget.addEventListener('drop', handlePlaceholderDrop);
    tasksContainer.appendChild(bottomDragTarget);

    // Render done section
    doneTasksContainer.innerHTML = '';
    if (completedTasks.length > 0) {
        completedTasks.forEach(task => {
            const taskElement = createTaskElement(task);
            doneTasksContainer.appendChild(taskElement);
        });
        doneContainer.style.display = 'block';
    } else {
        doneContainer.style.display = 'none';
    }
}

// Create a placeholder element for the dragged task
function createPlaceholderElement(task) {
    const placeholder = document.createElement('div');
    placeholder.className = 'task-item task-placeholder dragging';
    placeholder.dataset.taskId = task.id;
    placeholder.dataset.isPlaceholder = 'true';

    placeholder.innerHTML = `
        <input type="checkbox" class="task-checkbox" disabled>
        <span class="task-text">${task.text}</span>
        <div class="task-actions"></div>
    `;

    // Allow the placeholder to be dragged/repositioned
    placeholder.addEventListener('dragover', handlePlaceholderDragOver);
    placeholder.addEventListener('drop', handlePlaceholderDrop);

    return placeholder;
}

// Handle dragging over the task area when we have a placeholder
function handlePlaceholderDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!dragTargetTabId || !draggedTaskId) return;

    // Remove tab highlight styles since we're in the task area now
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('task-drop-target', 'task-drop-incompatible');
    });

    // Calculate new position based on mouse Y
    const container = tasksContainer;
    const placeholder = container.querySelector('.task-placeholder');

    if (!placeholder) return;

    const afterElement = getDragAfterElementVertical(container, e.clientY, '.task-item:not(.task-placeholder)');
    const bottomTarget = container.querySelector('.bottom-drag-target');

    if (afterElement == null) {
        // Move to end
        if (bottomTarget) {
            container.insertBefore(placeholder, bottomTarget);
        } else {
            container.appendChild(placeholder);
        }
    } else if (afterElement !== placeholder) {
        container.insertBefore(placeholder, afterElement);
    }

    // Update placeholder position
    const allItems = Array.from(container.querySelectorAll('.task-item'));
    dragPlaceholderPosition = allItems.indexOf(placeholder);
}

// Handle drop in the task area when we have a placeholder
function handlePlaceholderDrop(e) {
    e.preventDefault();

    if (!dragTargetTabId || !draggedTaskId || !dragSourceTabId) return;

    // Get final position from placeholder
    const container = tasksContainer;
    const allItems = Array.from(container.querySelectorAll('.task-item:not(.task-placeholder)'));
    const placeholder = container.querySelector('.task-placeholder');

    if (!placeholder) return;

    // Find where the placeholder is
    let insertPosition = 0;
    const children = Array.from(container.children);
    for (let i = 0; i < children.length; i++) {
        if (children[i] === placeholder) break;
        if (children[i].classList.contains('task-item') && !children[i].dataset.isPlaceholder) {
            insertPosition++;
        }
    }

    // Move the task to the target tab at the specified position
    moveTaskToTabAtPosition(draggedTaskId, dragSourceTabId, dragTargetTabId, insertPosition);

    // Clean up
    dragTargetTabId = null;
    dragPlaceholderPosition = 0;
}

function toggleTaskFavourite(taskId) {
    let taskFound = false;
    for (const tabId in tabs) {
        const tab = tabs[tabId];
        const task = tab.tasks.find(t => t.id === taskId);
        if (task) {
            task.isFavourite = !task.isFavourite;
            taskFound = true;
            break;
        }
    }
    if (taskFound) {
        saveData();
        renderTasks();
    }
}

function renderTasks() {
    let tasksToRender = [];
    let completedTasksToRender = [];

    if (currentView === 'favourites') {
        const allFavs = getAllFavouriteTasks();
        tasksToRender = allFavs.filter(task => !task.completed);
        completedTasksToRender = allFavs.filter(task => task.completed);

        tasksContainer.innerHTML = '';
        doneTasksContainer.innerHTML = '';

        if (tasksToRender.length === 0 && completedTasksToRender.length === 0) {
            tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No favourited tasks yet. Click the heart on a task to favourite it! ❤️</div>';
            doneContainer.style.display = 'none';
            return;
        }
    } else {
        if (!currentTabId) {
            tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No tab selected</div>';
            doneContainer.style.display = 'none';
            return;
        }

        const currentTab = tabs[currentTabId];
        if (!currentTab.tasks.length) {
            tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No tasks yet. Add one below!</div>';
            doneContainer.style.display = 'none';
            return;
        }

        tasksToRender = currentTab.tasks.filter(task => !task.completed);
        completedTasksToRender = currentTab.tasks.filter(task => task.completed);
    }

    // Separate completed and incomplete tasks
    const incompleteTasks = tasksToRender;
    // Sort completed tasks by completion time (most recent first)
    // If completedAt is missing (legacy tasks), fallback to creation time or preserve order
    const completedTasks = completedTasksToRender.sort((a, b) => {
        const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return timeB - timeA;
    });

    // Render incomplete tasks in main tasks container
    tasksContainer.innerHTML = '';
    if (incompleteTasks.length === 0) {
        tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">All tasks completed! 🎉</div>';
    } else {
        incompleteTasks.forEach(task => {
            const taskElement = createTaskElement(task);
            tasksContainer.appendChild(taskElement);
        });

        // Add invisible drag target at bottom
        const bottomDragTarget = document.createElement('div');
        bottomDragTarget.className = 'bottom-drag-target';
        bottomDragTarget.dataset.position = 'bottom';
        bottomDragTarget.addEventListener('dragover', handleBottomDragOver);
        bottomDragTarget.addEventListener('dragleave', handleBottomDragLeave);
        bottomDragTarget.addEventListener('drop', handleBottomDrop);
        tasksContainer.appendChild(bottomDragTarget);
    }

    // Render completed tasks in done container
    doneTasksContainer.innerHTML = '';
    if (completedTasks.length > 0) {
        completedTasks.forEach(task => {
            const taskElement = createTaskElement(task);
            doneTasksContainer.appendChild(taskElement);
        });

        // No drag target for Done section: completed tasks should not be reorderable.

        doneContainer.style.display = 'block';

        // Show "Delete all" button if there's more than one completed task
        // Hide in favourites view to avoid ambiguity about which list is being cleared
        if (completedTasks.length > 1 && currentView !== 'favourites') {
            deleteAllBtn.classList.remove('hidden');
        } else {
            deleteAllBtn.classList.add('hidden');
        }

        // Display task count
        const doneTaskCount = document.getElementById('done-task-count');
        if (doneTaskCount) {
            doneTaskCount.textContent = `${completedTasks.length} task${completedTasks.length !== 1 ? 's' : ''}`;
        }

        // Calculate and display total time spent
        const totalTimeMs = completedTasks.reduce((total, task) => {
            return total + (task.actualDuration || 0);
        }, 0);

        if (totalTimeMs > 0) {
            const totalMinutes = Math.round(totalTimeMs / (1000 * 60));
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;

            let timeString = 'Time spent: ';
            if (hours > 0) {
                timeString += `${hours}hr `;
            }
            timeString += `${minutes}m`;

            doneTimeSpent.textContent = timeString;
            doneTimeSpent.style.display = 'block';
        } else {
            doneTimeSpent.style.display = 'none';
        }
    } else {
        doneContainer.style.display = 'none';
    }
}

function createTaskElement(task) {
    const taskElement = document.createElement('div');
    taskElement.className = `task-item ${task.completed ? 'completed-task' : ''}`;
    // Reordering is supported for incomplete tasks in both lists and favourites views
    const canDragTask = !task.completed;
    taskElement.draggable = canDragTask;
    taskElement.dataset.taskId = task.id;

    const favBtnClass = task.isFavourite ? 'fav-btn active' : 'fav-btn';
    const favBtnHtml = `
        <button class="${favBtnClass}" data-task-id="${task.id}" title="Toggle Favourite">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
        </button>
    `;

    // Build action buttons based on task completion status
    // Notes button HTML
    const notesBtnHtml = `
        <button class="notes-btn ${task.notes ? 'has-notes' : ''}" data-task-id="${task.id}" title="Add/Edit Notes">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
                <path d="M2 6h4" />
                <path d="M2 10h4" />
                <path d="M2 14h4" />
                <path d="M2 18h4" />
                <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
            </svg>
        </button>
    `;

    // Menu button HTML (replaces delete button)
    const menuBtnHtml = `
        <button class="task-menu-btn" data-task-id="${task.id}" title="Task options">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
            </svg>
        </button>
    `;

    // Prepare duration display (existing logic) - now as a button for hover behavior
    let metaHtml = '';
    if (task.completed && task.actualDuration) {
        let timeDisplay;
        if (task.actualDuration < 60000) {
            timeDisplay = '<1m';
        } else {
            timeDisplay = `${Math.round(task.actualDuration / (1000 * 60))}m`;
        }
        metaHtml = `<span class="task-meta actual-time">${timeDisplay}</span>`;
    } else if (task.completed) {
        metaHtml = `<span class="task-meta add-time" title="Add actual duration">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom;">
                <path d="M12 6v6l3.644 1.822" />
                <path d="M16 19h6" />
                <path d="M19 16v6" />
                <path d="M21.92 13.267a10 10 0 1 0-8.653 8.653" />
            </svg>
        </span>`;
    } else if (!task.completed && task.expectedDuration) {
        metaHtml = `<span class="task-meta" title="Click to edit duration">${task.expectedDuration}m</span>`;
    } else if (!task.completed) {
        metaHtml = `<span class="task-meta add-time" title="Add duration">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom;">
                <path d="M12 6v6l3.644 1.822" />
                <path d="M16 19h6" />
                <path d="M19 16v6" />
                <path d="M21.92 13.267a10 10 0 1 0-8.653 8.653" />
            </svg>
        </span>`;
    }

    // Build always-visible buttons (favourite, focus, and duration if set)
    // Duration only takes up space if it has a value
    const hasDuration = task.completed ? task.actualDuration : task.expectedDuration;
    const alwaysMeta = hasDuration ? metaHtml : '';
    const hoverMeta = hasDuration ? '' : metaHtml;

    let alwaysVisibleButtons = '';
    if (!task.completed) {
        const isActiveFocusTask = activeFocusTaskIds.has(task.id);
        alwaysVisibleButtons = `
            ${alwaysMeta}
            ${favBtnHtml}
            <button class="focus-btn ${isActiveFocusTask ? 'active-focus' : ''}" data-task-id="${task.id}" title="${isActiveFocusTask ? 'Exit focus mode' : 'Focus on this task'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="6"/>
                    <circle cx="12" cy="12" r="2"/>
                </svg>
            </button>
        `;
    } else {
        // Completed tasks only show fav button in always-visible section
        alwaysVisibleButtons = `${alwaysMeta}${favBtnHtml}`;
    }

    // Build hover-only buttons (menu, notes if no notes exist, duration if not set)
    // Notes button goes to always-actions if task has notes
    const hoverNotes = task.notes ? '' : notesBtnHtml;
    const alwaysNotes = task.notes ? notesBtnHtml : '';
    const hoverButtons = `${menuBtnHtml}${hoverNotes}${hoverMeta}`;

    // Add notes to always-visible if task has notes
    alwaysVisibleButtons = `${alwaysNotes}${alwaysVisibleButtons}`;

    // Build task menu HTML
    const taskMenuHtml = `
        <div class="task-menu hidden" data-task-id="${task.id}">
            <button class="task-menu-item move-task-item" data-task-id="${task.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 3v12"/>
                    <path d="m8 11 4 4 4-4"/>
                    <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/>
                </svg>
                Move to...
            </button>
            <button class="task-menu-item delete-task-item" data-task-id="${task.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18"/>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
                Delete
            </button>
        </div>
    `;

    // Update innerHTML structure with new button groupings
    taskElement.innerHTML = `
        <div class="task-main-row">
            <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} data-task-id="${task.id}">
            <span class="task-text ${task.completed ? 'completed' : ''}">${task.text}</span>
            <div class="task-actions">
                <div class="hover-actions">${hoverButtons}${taskMenuHtml}</div>
                <div class="always-actions">${alwaysVisibleButtons}</div>
            </div>
        </div>
        <div class="notes-container" id="notes-${task.id}">
            <div class="notes-editor-wrapper">
                <div id="editor-${task.id}"></div>
            </div>
        </div>
    `;

    // Prevent dragging when clicking on interactive elements
    const interactiveElements = taskElement.querySelectorAll('input, button, .ql-container');
    interactiveElements.forEach(el => {
        el.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    });

    const taskTextSpan = taskElement.querySelector('.task-text');
    if (taskTextSpan) {
        taskTextSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            editTaskText(task.id, taskTextSpan);
        });
    }

    const taskMetaSpan = taskElement.querySelector('.task-meta');
    if (taskMetaSpan) {
        taskMetaSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            editTaskDuration(task.id, taskMetaSpan);
        });
    }

    const favBtn = taskElement.querySelector('.fav-btn');
    if (favBtn) {
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTaskFavourite(task.id);
        });
    }

    // Notes Logic
    const notesBtn = taskElement.querySelector('.notes-btn');
    const notesContainer = taskElement.querySelector(`#notes-${task.id}`);

    if (notesBtn && notesContainer) {
        notesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const isOpen = notesContainer.classList.contains('open');

            if (isOpen) {
                notesContainer.classList.remove('open');
                notesBtn.classList.remove('active');
            } else {
                notesContainer.classList.add('open');
                notesBtn.classList.add('active');

                // Initialize Quill if not already initialized
                if (!taskElement.quillInstance) {
                    const editorDiv = document.getElementById(`editor-${task.id}`);
                    if (editorDiv) {
                        taskElement.quillInstance = new Quill(editorDiv, {
                            theme: 'snow',
                            placeholder: 'Add notes...',
                            modules: {
                                toolbar: [
                                    ['bold', 'italic', 'underline', 'strike'],
                                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                                    ['link']
                                ]
                            }
                        });

                        // Add Done button to wrapper (not toolbar - more reliable positioning)
                        const wrapper = notesContainer.querySelector('.notes-editor-wrapper');
                        const toolbar = notesContainer.querySelector('.ql-toolbar');

                        if (wrapper) {
                            const doneBtn = document.createElement('button');
                            doneBtn.className = 'notes-done-btn';
                            doneBtn.title = 'Done editing';
                            doneBtn.innerHTML = `
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            `;
                            doneBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                taskElement.quillInstance.blur();
                                wrapper.classList.remove('active');
                            });
                            doneBtn.addEventListener('mousedown', (e) => e.stopPropagation());
                            wrapper.appendChild(doneBtn);
                        }

                        if (toolbar) {
                            // Prevent drag propagation from toolbar
                            toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
                        }

                        // Set initial content if any (use setTimeout to ensure Quill is fully ready)
                        if (task.notes) {
                            setTimeout(() => {
                                taskElement.quillInstance.clipboard.dangerouslyPasteHTML(task.notes);
                            }, 0);
                        }

                        // Handle focus/blur to show/hide toolbar
                        taskElement.quillInstance.on('selection-change', (range) => {
                            if (range) {
                                // Focused
                                wrapper.classList.add('active');
                            } else {
                                // Blurred - wait brief moment in case clicking toolbar
                                // But done button handles explicit close. 
                                // Actually, if we click outside, range becomes null.
                                // We might want to keep it simple: only selection-change triggers active class?
                                // If range is null, we typically want to hide, BUT specific clicks (like toolbar buttons) 
                                // shouldn't hide it immediately or it breaks interaction.
                                // The user requirement says: "checkmark that if clicked deselects ... and hides".
                                // So we only hide on checkmark (or blur?)
                                // "only appear when your cursor is in the notes field" -> implies focus.
                                if (!range) {
                                    wrapper.classList.remove('active');
                                }
                            }
                        });

                        // Save handler
                        taskElement.quillInstance.on('text-change', () => {
                            const content = taskElement.quillInstance.root.innerHTML;
                            task.notes = content;
                            task.notesChangedAt = new Date().toISOString(); // Track when notes changed
                            if (content && content !== '<p><br></p>') {
                                notesBtn.classList.add('has-notes');
                            } else {
                                notesBtn.classList.remove('has-notes');
                            }

                            // Debounce save
                            if (taskElement.saveTimeout) clearTimeout(taskElement.saveTimeout);
                            taskElement.saveTimeout = setTimeout(() => {
                                saveData();
                            }, 1000);
                        });

                        // Prevent drag propagation from editor
                        taskElement.quillInstance.root.addEventListener('mousedown', (e) => e.stopPropagation());
                    }
                } else {
                    // Quill already exists - reload notes content in case it was updated by sync
                    const currentContent = taskElement.quillInstance.root.innerHTML;
                    const isEmpty = !currentContent || currentContent === '<p><br></p>';
                    if (task.notes && (isEmpty || currentContent !== task.notes)) {
                        taskElement.quillInstance.clipboard.dangerouslyPasteHTML(task.notes);
                    }
                }
            }
        });
    }

    // Drag event listeners (only on reorderable tasks)
    if (canDragTask) {
        taskElement.addEventListener('dragstart', handleDragStart);
        taskElement.addEventListener('dragend', handleDragEnd);
        taskElement.addEventListener('dragover', handleDragOver);
        taskElement.addEventListener('drop', handleDrop);
    }

    // Close any open menus when hovering over a different task
    taskElement.addEventListener('mouseenter', () => {
        document.querySelectorAll('.task-menu:not(.hidden)').forEach(menu => {
            // Only close menus that are not part of this task
            if (!taskElement.contains(menu)) {
                menu.classList.add('hidden');
                // Remove active class from corresponding task item
                const parentTask = menu.closest('.task-item');
                if (parentTask) parentTask.classList.remove('has-open-menu');
            }
        });
    });

    return taskElement;
}

// Event listeners
function setupEventListeners() {
    // Focus window dragging in Tauri:
    // - non-interactive areas drag immediately
    // - interactive controls (buttons/inputs/editors) still click normally,
    //   but press-and-hold starts window drag.
    const focusBar = document.querySelector('.focus-bar');
    const focusContainer = document.querySelector('.focus-container');
    if (isFocusPanelWindow && focusBar && focusContainer) {
        // Ensure attribute exists even if template is changed later.
        focusBar.setAttribute('data-tauri-drag-region', '');

        let suppressClickUntil = 0;
        const HOLD_TO_DRAG_MS = 170;
        const MOVE_CANCEL_PX = 6;

        focusContainer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            const target = e.target;
            const interactiveEl = target.closest('button, a, input, textarea, select, [contenteditable="true"], .ql-editor, .ql-toolbar');
            const startX = e.clientX;
            const startY = e.clientY;
            let dragStarted = false;
            let holdTimer = null;

            const cleanup = () => {
                if (holdTimer) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
                window.removeEventListener('mousemove', onMove, true);
                window.removeEventListener('mouseup', onUp, true);
            };

            const startWindowDrag = async () => {
                if (dragStarted) return;
                dragStarted = true;
                // Prevent the pending click from firing after a hold-to-drag gesture.
                suppressClickUntil = Date.now() + 400;
                cleanup();
                try {
                    await tauriAPI.startDrag();
                } catch (err) {
                    console.warn('Failed to start focus-window drag:', err);
                }
            };

            const onMove = (moveEvent) => {
                const dx = Math.abs(moveEvent.clientX - startX);
                const dy = Math.abs(moveEvent.clientY - startY);
                if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
                    // If user moves before hold threshold on an interactive control,
                    // switch to dragging immediately for a natural "click-and-drag".
                    if (interactiveEl) {
                        startWindowDrag();
                    } else {
                        cleanup();
                    }
                }
            };

            const onUp = () => {
                cleanup();
            };

            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);

            if (interactiveEl) {
                holdTimer = setTimeout(startWindowDrag, HOLD_TO_DRAG_MS);
            } else {
                startWindowDrag();
            }
        }, true);

        focusContainer.addEventListener('click', (e) => {
            if (Date.now() < suppressClickUntil) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    // View Switcher Listeners
    if (viewListsBtn) {
        viewListsBtn.addEventListener('click', () => switchView('lists'));
    }
    if (viewFavBtn) {
        viewFavBtn.addEventListener('click', () => switchView('favourites'));
    }
    if (viewPlanBtn) {
        viewPlanBtn.addEventListener('click', () => switchView('plan'));
    }

    // Note: addTabBtn is now dynamically created inside renderTabs

    // Modal buttons
    if (cancelTabBtn) {
        cancelTabBtn.addEventListener('click', () => {
            hideTabNameModal();
        });
    }

    // Color swatch click event - using event delegation for reliability
    const customColorInput = document.getElementById('custom-color-input');

    document.body.addEventListener('click', (e) => {
        const swatch = e.target.closest('.color-swatch');
        if (swatch) {
            console.log('[Color Swatch] Clicked:', swatch.dataset.color);
            const isCustomSwatch = swatch.dataset.color === 'custom';

            if (isCustomSwatch) {
                // Mark custom swatch selected immediately for visual feedback.
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
                // Native picker is opened directly by the real color input inside the swatch label.
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // Remove selected from all swatches
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
            // Add to clicked swatch
            swatch.classList.add('selected');
            console.log('[Color Swatch] Selected:', swatch.classList.contains('selected'));
        }
    });

    // Custom color picker change event
    if (customColorInput) {
        customColorInput.addEventListener('input', (e) => {
            const color = e.target.value;
            const customSwatch = document.querySelector('.color-swatch-custom');

            // Remove selected from all swatches
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));

            // Update custom swatch appearance and select it
            if (customSwatch) {
                customSwatch.style.background = color;
                customSwatch.classList.add('selected');
            }

            console.log('[Color Picker] Custom color selected:', color);
        });
    }

    if (createTabBtn) {
        createTabBtn.addEventListener('click', () => {
            // Check if we are creating a group
            if (tabNameModal.dataset.mode === 'group' || tabNameModal.dataset.mode === 'group-rename') {
                handleModalCreate();
                return;
            }

            let tabName = tabNameInput.value.trim();

            // Get Basecamp selection
            const bcProjectId = bcProjectSelect.value;
            const bcListId = bcListSelect.value;

            // Get Reminders selection
            const remindersListId = remindersListSelect.value;

            // If creating from Basecamp list and name is empty, use list name
            if (bcListId && (!tabName || tabName === '')) {
                const selectedOption = bcListSelect.options[bcListSelect.selectedIndex];
                if (selectedOption) {
                    tabName = selectedOption.text;
                }
            }

            // If creating from Reminders list and name is empty, use list name
            if (remindersListId && (!tabName || tabName === '')) {
                const selectedOption = remindersListSelect.options[remindersListSelect.selectedIndex];
                if (selectedOption) {
                    tabName = selectedOption.text;
                }
            }

            // Get selected color
            let selectedColor = '';
            const activeSwatch = document.querySelector('.color-swatch.selected');
            const customColorInput = document.getElementById('custom-color-input');
            console.log('[Color Save] Active swatch:', activeSwatch);
            if (activeSwatch) {
                if (activeSwatch.dataset.color === 'custom' && customColorInput) {
                    // Use the hex color value directly
                    selectedColor = customColorInput.value;
                } else {
                    selectedColor = activeSwatch.dataset.color || '';
                }
                console.log('[Color Save] Selected color:', selectedColor);
            }

            if (renamingTabId) {
                // Renaming existing tab
                // Update color manually here since renameTab might not handle it (or we update renameTab)
                // Let's update it directly here for simplicity and safety
                if (tabs[renamingTabId]) {
                    tabs[renamingTabId].color = selectedColor;
                    console.log('[Color Save] Tab color updated to:', tabs[renamingTabId].color);
                }
                renameTab(renamingTabId, tabName);
            } else {
                // Creating new tab
                const newTabId = createNewTab(tabName, bcProjectId || null, bcListId || null, remindersListId || null);
                if (tabs[newTabId]) {
                    tabs[newTabId].color = selectedColor;
                    saveData(); // Save usually happens in createNewTab but we modified it
                    console.log('[Color Save] New tab color set to:', tabs[newTabId].color);
                }
                switchToTab(newTabId);
            }

            hideTabNameModal();
        });
    }

    // Settings buttons
    settingsBtn.addEventListener('click', async () => {
        settingsModal.classList.remove('hidden');
        // Set toggle state
        const groupsToggle = document.getElementById('enable-groups-toggle');
        if (groupsToggle) {
            groupsToggle.checked = enableGroups;
        }

        // Set plan toggle state
        const planToggle = document.getElementById('enable-plan-toggle');
        if (planToggle) {
            planToggle.checked = enablePlan;
        }

        // Show current version
        const versionEl = document.getElementById('current-app-version');
        if (versionEl) {
            try {
                console.log('[Version] Fetching app version...');
                const ver = await reddIpc.invoke('get-app-version');
                console.log('[Version] Got version:', ver);
                versionEl.textContent = `${t('yourVersion')}: ${ver || 'Unknown'}`;
            } catch (e) {
                console.error('[Version] Error fetching version:', e);
                versionEl.textContent = `${t('yourVersion')}: Error`;
            }
        }
    });

    // Groups toggle listener
    const groupsToggle = document.getElementById('enable-groups-toggle');
    if (groupsToggle) {
        groupsToggle.addEventListener('change', (e) => {
            enableGroups = e.target.checked;
            saveData();
            renderGroups();
            renderTabs();

            // If we just enabled groups, ensure we are in a valid state
            if (enableGroups) {
                if (!currentGroupId || !groups[currentGroupId]) {
                    // Fallback to first group or create default
                    if (Object.keys(groups).length > 0) {
                        switchToGroup(Object.keys(groups)[0]);
                    } else {
                        createGroup('General');
                    }
                } else {
                    // Re-select current group to filter tabs correctly
                    switchToGroup(currentGroupId);
                }
            }
        });
    }

    // Plan mode toggle listener
    const planToggle = document.getElementById('enable-plan-toggle');
    if (planToggle) {
        planToggle.addEventListener('change', (e) => {
            enablePlan = e.target.checked;
            saveData();
            updatePlanButtonVisibility();

            // If disabling plan mode while in plan view, switch back to lists
            if (!enablePlan && currentView === 'plan') {
                switchView('lists');
            }
        });
    }

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    // Info toggle buttons in Settings
    document.querySelectorAll('.info-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('aria-controls');
            const target = document.getElementById(targetId);
            if (target) {
                const isExpanded = btn.getAttribute('aria-expanded') === 'true';
                btn.setAttribute('aria-expanded', !isExpanded);
                target.classList.toggle('hidden');
            }
        });
    });

    // Delete Confirm Modal buttons
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            hideDeleteConfirmModal();
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', () => {
            if (pendingDeleteTabId) {
                performTabDeletion(pendingDeleteTabId);
            } else if (pendingDeleteGroupId) {
                performGroupDeletion(pendingDeleteGroupId);
            }
            hideDeleteConfirmModal();
        });
    }

    // Close delete confirm modal when clicking outside
    if (deleteConfirmModal) {
        deleteConfirmModal.addEventListener('click', (e) => {
            if (e.target === deleteConfirmModal) {
                hideDeleteConfirmModal();
            }
        });
    }

    // Undo Events
    if (undoBtn) {
        undoBtn.addEventListener('click', performUndo);
    }

    if (closeUndoBtn) {
        closeUndoBtn.addEventListener('click', hideUndoToast);
    }

    connectBcBtn.addEventListener('click', async () => {
        const accountId = bcAccountIdInput.value.trim();
        const token = bcAccessTokenInput.value.trim();
        const refreshToken = bcRefreshTokenInput.value.trim();
        const clientId = bcClientIdInput.value.trim();
        const clientSecret = bcClientSecretInput.value.trim();
        const email = bcEmailInput.value.trim();

        if (accountId && token) {
            basecampConfig.accountId = accountId;
            basecampConfig.accessToken = token;
            basecampConfig.refreshToken = refreshToken || null;
            basecampConfig.clientId = clientId || null;
            basecampConfig.clientSecret = clientSecret || null;
            basecampConfig.email = email;
            basecampConfig.isConnected = true;
            saveData();
            updateBasecampUI();
            updateRemindersUI();
            updateSyncButtonState();
            settingsModal.classList.add('hidden');
        }
    });

    // Reminders Connect Button
    if (remindersConnectBtn) {
        if (platform !== 'darwin') {
            // Disable for non-Mac
            remindersConnectBtn.disabled = true;
            remindersConnectBtn.title = 'Apple Reminders integration is only available on macOS';
            remindersConnectBtn.style.opacity = '0.5';
            remindersConnectBtn.style.cursor = 'not-allowed';

            // Add explanatory text near the button if possible, or just rely on title/alert
            // Let's modify the text to be clear
            remindersConnectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg> Connect Reminders (macOS only)';
        } else {
            const remindersErrorMessage = (error) => {
                if (typeof error === 'string') return error;
                if (error && typeof error.message === 'string') return error.message;
                if (error && typeof error.toString === 'function') return error.toString();
                return '';
            };

            const isRemindersPermissionDenied = (error) =>
                /permission denied/i.test(remindersErrorMessage(error));

            const handleRemindersPermissionDenied = async () => {
                alert(
                    'Reminders access is currently denied.\n\n' +
                    'I will open macOS Privacy settings now. Enable access for this app, then click "Connect Reminders" again.'
                );
                if (reddIsTauri && typeof tauriAPI !== 'undefined') {
                    try {
                        await tauriAPI.openRemindersPrivacySettings();
                    } catch (settingsError) {
                        console.error('Failed to open Reminders privacy settings:', settingsError);
                    }
                }
            };

            remindersConnectBtn.addEventListener('click', async () => {
                try {
                    console.log('[Reminders] Connect clicked');
                    remindersConnectBtn.textContent = 'Connecting...';
                    remindersConnectBtn.disabled = true;

                    // Try to fetch lists to trigger permission prompt
                    const lists = await reddIpc.invoke('fetch-reminders-lists');
                    console.log('[Reminders] fetch-reminders-lists result:', {
                        type: Array.isArray(lists) ? 'array' : typeof lists,
                        length: Array.isArray(lists) ? lists.length : undefined,
                        keys: (lists && typeof lists === 'object' && !Array.isArray(lists)) ? Object.keys(lists) : undefined
                    });

                    // Only treat as connected if we got at least one list.
                    if (Array.isArray(lists) && lists.length > 0) {
                        remindersConfig.isConnected = true;
                        saveData();
                        updateRemindersUI();
                        updateSyncButtonState();
                    } else {
                        if (Array.isArray(lists) && lists.length === 0) {
                            alert(
                                'Connected, but no Reminders lists were returned.\n\n' +
                                'This usually means macOS has not granted this dev process access yet. ' +
                                'Please re-open Reminders privacy settings and ensure access is enabled for the current app/process.'
                            );
                        }
                        const errMsg = (lists && typeof lists === 'object' && lists.error) ? lists.error : null;
                        if (isRemindersPermissionDenied(errMsg || '')) {
                            await handleRemindersPermissionDenied();
                        } else {
                            alert('Could not connect to Reminders. Please check permissions.' + (errMsg ? ` (${errMsg})` : ''));
                        }
                        remindersConnectBtn.disabled = false;
                        remindersConnectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg> Connect Reminders';
                    }
                } catch (error) {
                    console.error(error);
                    if (isRemindersPermissionDenied(error)) {
                        await handleRemindersPermissionDenied();
                    } else {
                        alert('Failed to connect to Reminders: ' + error);
                    }
                    remindersConnectBtn.disabled = false;
                    remindersConnectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg> Connect Reminders';
                }
            });
        }
    }

    // Reminders Disconnect Button
    if (disconnectRemindersBtn) {
        disconnectRemindersBtn.addEventListener('click', () => {
            remindersConfig.isConnected = false;
            saveData();
            updateRemindersUI();
            updateSyncButtonState();

            // Reset connect button state
            remindersConnectBtn.disabled = false;
            remindersConnectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg> Connect Reminders';
        });
    }

    disconnectBcBtn.addEventListener('click', () => {
        basecampConfig.accountId = null;
        basecampConfig.accessToken = null;
        basecampConfig.refreshToken = null;
        basecampConfig.clientId = null;
        basecampConfig.clientSecret = null;
        basecampConfig.email = null;
        basecampConfig.isConnected = false;
        saveData();
        updateBasecampUI();
        updateSyncButtonState();
    });

    if (bcHelpLink) {
        bcHelpLink.addEventListener('click', (e) => {
            e.preventDefault();
            openExternal('https://launchpad.37signals.com/integrations');
        });
    }

    // New OAuth Button
    if (oauthConnectBtn) {
        oauthConnectBtn.addEventListener('click', () => {
            console.log('[Basecamp OAuth] Connect button clicked, starting auth flow...');
            oauthConnectBtn.textContent = 'Connecting...';
            oauthConnectBtn.disabled = true;
            reddIpc.send('start-basecamp-auth');
            console.log('[Basecamp OAuth] IPC message sent to main process');
        });
    } else {
        console.warn('[Basecamp OAuth] OAuth connect button not found in DOM');
    }

    // Toggle Manual Fields
    if (toggleManualAuthBtn) {
        toggleManualAuthBtn.addEventListener('click', (e) => {
            e.preventDefault();
            manualAuthFields.classList.toggle('hidden');
        });
    }

    // Sync Button
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            // Handle favourites view - sync all synced lists with favourited tasks
            if (currentView === 'favourites') {
                const syncedTabsWithFavs = getSyncedTabsWithFavourites();

                if (syncedTabsWithFavs.length === 0) return;

                // Check for disconnected services
                let hasDisconnectedBasecamp = false;
                let hasDisconnectedReminders = false;

                syncedTabsWithFavs.forEach(tabId => {
                    const tab = tabs[tabId];
                    if (tab.basecampListId && !basecampConfig.isConnected) hasDisconnectedBasecamp = true;
                    if (tab.remindersListId && !remindersConfig.isConnected) hasDisconnectedReminders = true;
                });

                if (hasDisconnectedBasecamp || hasDisconnectedReminders) {
                    // Handle reconnection similar to single tab case
                    const services = [];
                    if (hasDisconnectedBasecamp) services.push('Basecamp');
                    if (hasDisconnectedReminders) services.push('Apple Reminders');

                    const message = `Some favourited tasks are synced with ${services.join(' & ')}, but the connection is not active.\n\nYour changes are saved locally and will sync when you reconnect.`;

                    const reconnect = await showConfirmModal(
                        'Connection Required',
                        message,
                        'Reconnect',
                        'Cancel'
                    );

                    if (reconnect) {
                        if (hasDisconnectedReminders && platform === 'darwin') {
                            try {
                                const lists = await reddIpc.invoke('fetch-reminders-lists');
                                if (Array.isArray(lists)) {
                                    remindersConfig.isConnected = true;
                                    saveData();
                                    updateRemindersUI();
                                    updateSyncButtonState();
                                    syncBtn.click();
                                }
                            } catch (e) {
                                console.error('Failed to reconnect to Reminders:', e);
                            }
                        } else if (hasDisconnectedBasecamp) {
                            reddIpc.send('start-basecamp-auth');
                        }
                    }
                    return;
                }

                // Sync all relevant lists
                syncBtn.classList.add('spinning');

                const promises = [];
                syncedTabsWithFavs.forEach(tabId => {
                    const tab = tabs[tabId];
                    if (tab.basecampListId && basecampConfig.isConnected) {
                        promises.push(syncBasecampList(tabId));
                    }
                    if (tab.remindersListId && remindersConfig.isConnected) {
                        promises.push(syncRemindersList(tabId));
                    }
                });

                Promise.all(promises).finally(() => {
                    setTimeout(() => syncBtn.classList.remove('spinning'), 500);
                });

                return;
            }

            // Original logic for lists view
            if (!currentTabId) return;

            const tab = tabs[currentTabId];

            // Check if any required connections are missing
            const basecampDisconnected = tab.basecampListId && !basecampConfig.isConnected;
            const remindersDisconnected = tab.remindersListId && !remindersConfig.isConnected;

            if (basecampDisconnected || remindersDisconnected) {
                // Determine which service to reconnect to
                const services = [];
                if (basecampDisconnected) services.push('Basecamp');
                if (remindersDisconnected) services.push('Apple Reminders');

                const message = `This list is synced with ${services.join(' & ')}, but the connection is not active.\n\nYour changes are saved locally and will sync when you reconnect.`;

                const reconnect = await showConfirmModal(
                    'Connection Required',
                    message,
                    'Reconnect',
                    'Cancel'
                );

                if (reconnect) {
                    // Directly trigger reconnection
                    if (remindersDisconnected && platform === 'darwin') {
                        // Reconnect to Apple Reminders
                        try {
                            const lists = await reddIpc.invoke('fetch-reminders-lists');
                            if (Array.isArray(lists)) {
                                remindersConfig.isConnected = true;
                                saveData();
                                updateRemindersUI();
                                updateSyncButtonState();
                                // Now trigger the sync
                                syncBtn.click();
                            }
                        } catch (e) {
                            console.error('Failed to reconnect to Reminders:', e);
                        }
                    } else if (basecampDisconnected) {
                        // Reconnect to Basecamp via OAuth
                        reddIpc.send('start-basecamp-auth');
                    }
                }
                return;
            }

            syncBtn.classList.add('spinning');

            const promises = [];

            if (tab.basecampListId && basecampConfig.isConnected) {
                promises.push(syncBasecampList(currentTabId));
            }
            if (tab.remindersListId && remindersConfig.isConnected) {
                promises.push(syncRemindersList(currentTabId));
            }

            Promise.all(promises).finally(() => {
                setTimeout(() => syncBtn.classList.remove('spinning'), 500);
            });
        });
    }

    // Basecamp Project Selection
    bcProjectSelect.addEventListener('change', () => {
        const projectId = bcProjectSelect.value;
        const isGroupMode = tabNameModal.dataset.mode === 'group';

        if (projectId) {
            if (isGroupMode) {
                // In group mode, keep Basecamp and Reminders-group imports mutually exclusive.
                if (remindersListSelect) remindersListSelect.value = '';
                // Group creation: Pre-fill name and change button text
                const projectOption = bcProjectSelect.options[bcProjectSelect.selectedIndex];
                if (projectOption && (!tabNameInput.value || tabNameInput.value === '')) {
                    tabNameInput.value = projectOption.text;
                }
                // Don't fetch lists into the dropdown for groups
                bcListWrapper.classList.add('hidden');
                updateGroupImportButtonLabel();
            } else {
                // Tab creation: fetch lists into dropdown
                fetchBasecampTodoLists(projectId);
                bcListWrapper.classList.remove('hidden');
            }
        } else {
            bcListWrapper.classList.add('hidden');
            if (isGroupMode) {
                updateGroupImportButtonLabel();
            }
        }
    });

    // Auto-fill tab name when Basecamp list is selected
    bcListSelect.addEventListener('change', () => {
        const selectedOption = bcListSelect.options[bcListSelect.selectedIndex];
        if (selectedOption && bcListSelect.value) {
            const projectOption = bcProjectSelect.options[bcProjectSelect.selectedIndex];
            let prefix = '';

            if (projectOption) {
                const projectName = projectOption.text;
                const firstWord = projectName.trim().split(/\s+/)[0]; // Handle multiple spaces
                if (firstWord) {
                    prefix = `${firstWord}: `;
                }
            }

            tabNameInput.value = prefix + selectedOption.text;
        }
    });

    // Auto-fill name when Reminders list is selected
    if (remindersListSelect) {
        remindersListSelect.addEventListener('change', () => {
            const isGroupMode = tabNameModal.dataset.mode === 'group';
            const selectedOption = remindersListSelect.options[remindersListSelect.selectedIndex];

            if (isGroupMode) {
                if (remindersListSelect.value && bcProjectSelect.value) {
                    bcProjectSelect.value = '';
                    bcListWrapper.classList.add('hidden');
                }
                if (selectedOption && remindersListSelect.value && (!tabNameInput.value || tabNameInput.value === '')) {
                    tabNameInput.value = selectedOption.text.replace(/\s+\(\d+\s+lists?\)\s*$/, '');
                }
                updateGroupImportButtonLabel();
                return;
            }

            if (selectedOption && (!tabNameInput.value || tabNameInput.value === '')) {
                tabNameInput.value = selectedOption.text;
            }
        });
    }

    // Close modal on Enter key
    if (tabNameInput) {
        tabNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                createTabBtn.click();
            }
        });
    }

    // Handle all external links
    document.addEventListener('click', (event) => {
        if (event.target.tagName === 'A' && event.target.href.startsWith('http')) {
            event.preventDefault();
            openExternal(event.target.href);
        }
    });

    // Close modal or exit fullscreen on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!tabNameModal.classList.contains('hidden')) {
                hideTabNameModal();
                return;
            }
            if (!settingsModal.classList.contains('hidden')) {
                settingsModal.classList.add('hidden');
                return;
            }
            if (!deleteConfirmModal.classList.contains('hidden')) {
                hideDeleteConfirmModal();
                return;
            }

            // Exit fullscreen focus mode if active
            const focusContainer = document.querySelector('.focus-container');
            if (focusContainer && focusContainer.classList.contains('fullscreen')) {
                focusContainer.classList.remove('fullscreen');
                updateFullscreenButtonState(false);
                // Restore standard width (similar to logic in fullscreen button handler)
                reddIpc.send('set-focus-window-size', Math.min(Math.max(focusContainer.offsetWidth, 280), 500));
            }
        }
    });

    // Close modal when clicking outside
    if (tabNameModal) {
        tabNameModal.addEventListener('click', (e) => {
            if (e.target === tabNameModal) {
                hideTabNameModal();
            }
        });
    }

    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
    }

    // Done section - click handler for expand/collapse functionality
    const doneToggle = document.querySelector('.done-toggle');
    if (doneToggle) {
        doneToggle.addEventListener('click', () => {
            // Calculate target height: 3.5 tasks or all completed tasks if fewer
            const completedTasks = currentTabId && tabs[currentTabId]
                ? tabs[currentTabId].tasks.filter(t => t.completed)
                : [];

            const taskCount = completedTasks.length;
            if (taskCount === 0) return;

            // Approximate height per task item (including margins)
            const taskItemHeight = 60; // ~48px content + 8px margin + padding
            const headingHeight = 32; // height of the done heading only
            const summaryHeight = 24; // height of summary line
            const padding = 24; // top + bottom padding

            // Calculate target height for 3.5 tasks or all tasks if fewer
            const tasksToShow = Math.min(3.5, taskCount);
            const expandedHeight = headingHeight + summaryHeight + padding + (tasksToShow * taskItemHeight);
            const collapsedHeight = 24; // Minimal height, just showing the heading

            const currentHeight = parseInt(window.getComputedStyle(doneContainer).maxHeight) || doneMaxHeight;

            // Toggle: if already at or above expanded height, collapse; otherwise expand
            if (currentHeight >= expandedHeight - 10) { // -10 for tolerance
                // Collapse to just show heading
                doneMaxHeight = collapsedHeight;
                doneContainer.style.maxHeight = `${collapsedHeight}px`;
                doneContainer.style.paddingTop = '0';
                doneContainer.style.paddingBottom = '0';
            } else {
                // Expand to show tasks
                doneMaxHeight = Math.min(expandedHeight, window.innerHeight - 150);
                doneContainer.style.maxHeight = `${doneMaxHeight}px`;
                doneContainer.style.paddingTop = '8px';
                doneContainer.style.paddingBottom = '16px';
            }
            saveData();
        });
    }

    // Task events for active tasks
    tasksContainer.addEventListener('click', (e) => {
        const taskId = e.target.dataset.taskId || e.target.closest('[data-task-id]')?.dataset.taskId;

        if (!taskId) {
            return;
        }

        // Task menu button - toggle menu
        if (e.target.classList.contains('task-menu-btn') || e.target.closest('.task-menu-btn')) {
            e.stopPropagation();
            const taskItem = e.target.closest('.task-item');
            const menu = taskItem?.querySelector('.task-menu');
            if (menu) {
                // Close all other menus first
                document.querySelectorAll('.task-menu:not(.hidden)').forEach(m => {
                    if (m !== menu) {
                        m.classList.add('hidden');
                        const p = m.closest('.task-item');
                        if (p) p.classList.remove('has-open-menu');
                    }
                });
                menu.classList.toggle('hidden');
                if (menu.classList.contains('hidden')) {
                    taskItem.classList.remove('has-open-menu');
                } else {
                    taskItem.classList.add('has-open-menu');
                }
            }
        }
        // Delete action from menu
        else if (e.target.classList.contains('delete-task-item') || e.target.closest('.delete-task-item')) {
            deleteTask(taskId);
            // Close menu
            const menu = e.target.closest('.task-menu');
            if (menu) menu.classList.add('hidden');
        }
        // Move action from menu
        else if (e.target.classList.contains('move-task-item') || e.target.closest('.move-task-item')) {
            showMoveTaskModal(taskId);
            // Close menu
            const menu = e.target.closest('.task-menu');
            if (menu) menu.classList.add('hidden');
        }
        else if (e.target.classList.contains('focus-btn') || e.target.closest('.focus-btn')) {
            focusTask(taskId, e.target.closest('.focus-btn'));
        } else if (e.target.classList.contains('task-checkbox') || e.target.closest('.task-checkbox')) {
            toggleTask(taskId);
        } else if (e.target.classList.contains('task-text')) {
            // Edit task text
            editTaskText(taskId, e.target);
        }
    });

    // Drag events for task container (handles placeholder positioning)
    tasksContainer.addEventListener('dragover', (e) => {
        // If we have a placeholder from cross-tab drag, handle its positioning
        if (dragTargetTabId && draggedTaskId) {
            handlePlaceholderDragOver(e);
            return;
        }

        // Handle same-tab dragging in blank space below tasks
        // This fixes the animation glitch when dropping in the empty area
        if (draggedTaskId && !dragTargetTabId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const draggable = tasksContainer.querySelector('.task-item.dragging');
            if (!draggable) return;

            // Check if we're below all task items
            const taskItems = Array.from(tasksContainer.querySelectorAll('.task-item:not(.dragging)'));
            const bottomTarget = tasksContainer.querySelector('.bottom-drag-target');

            // If mouse is below the last task item (or no task items), move to end
            if (taskItems.length === 0 || e.clientY > taskItems[taskItems.length - 1].getBoundingClientRect().bottom) {
                if (bottomTarget) {
                    tasksContainer.insertBefore(draggable, bottomTarget);
                } else {
                    tasksContainer.appendChild(draggable);
                }
            }
        }
    });

    tasksContainer.addEventListener('drop', (e) => {
        // If we have a placeholder from cross-tab drag, handle the drop
        if (dragTargetTabId && draggedTaskId) {
            handlePlaceholderDrop(e);
            return;
        }

        // Handle same-tab drop in blank space
        if (draggedTaskId && !dragTargetTabId) {
            e.preventDefault();
            persistTaskOrderFromDOM();
        }
    });

    // Task events for completed tasks (done section)
    doneTasksContainer.addEventListener('click', (e) => {
        const taskId = e.target.dataset.taskId || e.target.closest('[data-task-id]')?.dataset.taskId;
        if (!taskId) return;

        // Task menu button - toggle menu
        if (e.target.classList.contains('task-menu-btn') || e.target.closest('.task-menu-btn')) {
            e.stopPropagation();
            const taskItem = e.target.closest('.task-item');
            const menu = taskItem?.querySelector('.task-menu');
            if (menu) {
                // Close all other menus first
                document.querySelectorAll('.task-menu:not(.hidden)').forEach(m => {
                    if (m !== menu) {
                        m.classList.add('hidden');
                        const p = m.closest('.task-item');
                        if (p) p.classList.remove('has-open-menu');
                    }
                });
                menu.classList.toggle('hidden');
                if (menu.classList.contains('hidden')) {
                    taskItem.classList.remove('has-open-menu');
                } else {
                    taskItem.classList.add('has-open-menu');
                }
            }
        }
        // Delete action from menu
        else if (e.target.classList.contains('delete-task-item') || e.target.closest('.delete-task-item')) {
            deleteTask(taskId);
            const menu = e.target.closest('.task-menu');
            if (menu) menu.classList.add('hidden');
        }
        // Move action from menu
        else if (e.target.classList.contains('move-task-item') || e.target.closest('.move-task-item')) {
            showMoveTaskModal(taskId);
            const menu = e.target.closest('.task-menu');
            if (menu) menu.classList.add('hidden');
        }
        else if (e.target.classList.contains('task-checkbox') || e.target.closest('.task-checkbox')) {
            toggleTask(taskId);
        } else if (e.target.classList.contains('task-text')) {
            // Edit task text for completed tasks
            editTaskText(taskId, e.target);
        } else if (e.target.classList.contains('task-meta') || e.target.closest('.task-meta')) {
            // Edit task duration for completed tasks
            const metaEl = e.target.classList.contains('task-meta') ? e.target : e.target.closest('.task-meta');
            editTaskDuration(taskId, metaEl);
        }
    });

    // Add task events
    addTaskBtn.addEventListener('click', () => {
        addTask(newTaskInput.value);
    });

    newTaskInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTask(newTaskInput.value);
        }
    });

    newTaskInput.addEventListener('input', () => {
        const hasText = newTaskInput.value.trim().length > 0;
        addTaskBtn.disabled = !hasText;

        if (hasText) {
            addTaskBtn.classList.remove('hidden');
            durationInputContainer.classList.add('visible');
        } else {
            addTaskBtn.classList.add('hidden');
            durationInputContainer.classList.remove('visible');
        }
    });

    taskDurationInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTask(newTaskInput.value);
        }
    });

    // Toggle label visibility based on input
    taskDurationInput.addEventListener('input', () => {
        if (taskDurationInput.value.length > 0) {
            durationInputContainer.classList.add('has-value');
        } else {
            durationInputContainer.classList.remove('has-value');
        }
    });

    const durationTriggerBtn = document.getElementById('duration-trigger-btn');
    if (durationTriggerBtn) {
        // Click: Set default 5 mins, show input, focus
        durationTriggerBtn.addEventListener('click', () => {
            durationTriggerBtn.classList.add('hidden');
            taskDurationInput.classList.remove('hidden');
            taskDurationInput.value = 5;
            durationInputContainer.classList.add('has-value');
            taskDurationInput.focus();
        });

        // Focus (Tab): Just show input (default 5m), focus
        durationTriggerBtn.addEventListener('focus', () => {
            durationTriggerBtn.classList.add('hidden');
            taskDurationInput.classList.remove('hidden');
            if (!taskDurationInput.value) {
                taskDurationInput.value = 5;
            }
            durationInputContainer.classList.add('has-value');
            taskDurationInput.focus();
        });
    }

    // Handle blur: if empty, hiding input and showing button again
    taskDurationInput.addEventListener('blur', () => {
        if (!taskDurationInput.value) {
            taskDurationInput.classList.add('hidden');
            if (durationTriggerBtn) {
                durationTriggerBtn.classList.remove('hidden');
            }
            durationInputContainer.classList.remove('has-value');
        }
    });

    // Handle Enter key in duration input: blur instead of adding task
    taskDurationInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            taskDurationInput.blur();
        }
    });

    // Duration spinner buttons
    const durationIncrement = document.getElementById('duration-increment');
    const durationDecrement = document.getElementById('duration-decrement');

    if (durationIncrement) {
        durationIncrement.addEventListener('click', () => {
            const currentVal = parseInt(taskDurationInput.value, 10);
            const snapped = snapDurationToStep(Number.isFinite(currentVal) ? currentVal : 0, 'up', 5);
            const newVal = Math.min(Math.max(snapped, 0), 999);
            taskDurationInput.value = newVal;
            durationInputContainer.classList.add('has-value');
        });
    }

    if (durationDecrement) {
        durationDecrement.addEventListener('click', () => {
            const currentVal = parseInt(taskDurationInput.value, 10);
            const snapped = snapDurationToStep(Number.isFinite(currentVal) ? currentVal : 0, 'down', 5);
            const newVal = Math.min(Math.max(snapped, 0), 999); // Allow 0
            taskDurationInput.value = newVal;

            // Update container state based on value
            if (newVal === 0 && document.activeElement !== taskDurationInput) {
                // If it becomes 0 and is not focused (rare with click on spinner, but good check), maybe hide? 
                // Actually, if clicked spinner, we want to see "0".
            }
            durationInputContainer.classList.add('has-value');
        });
    }

    if (durationDecrement) {
        durationDecrement.addEventListener('click', () => {
            const currentVal = parseInt(taskDurationInput.value, 10);
            if (!Number.isFinite(currentVal) || currentVal <= 0) return;

            const snapped = snapDurationToStep(currentVal, 'down', 5);
            const newVal = Math.min(Math.max(snapped, 1), 999);
            taskDurationInput.value = newVal;
            durationInputContainer.classList.add('has-value');
        });
    }

    // Focus mode events
    exitFocusBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Check if we are in fullscreen mode
        const focusContainer = document.querySelector('.focus-container');
        if (focusContainer && focusContainer.classList.contains('fullscreen')) {
            if (reddIsTauri && platform === 'darwin' && isNativeFullscreenFocusWindow && focusedTaskId) {
                // Match the user's expected behavior:
                // "exit fullscreen first, then home".
                await reddIpc.send('exit-fullscreen-focus-to-home', { taskId: focusedTaskId });
                return;
            }
            // First exit fullscreen locally
            focusContainer.classList.remove('fullscreen');
            document.body.classList.remove('is-fullscreen');
            // Restore standard width so IPC doesn't get confused
            reddIpc.send('set-focus-window-size', Math.min(Math.max(focusContainer.offsetWidth, 280), 500));
            // Then continue to standard exit
        }

        exitFocusMode();
    });

    completeFocusBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Check if we are in fullscreen mode and exit it correctly
        const focusContainer = document.querySelector('.focus-container');
        if (focusContainer && focusContainer.classList.contains('fullscreen')) {
            // First exit fullscreen locally
            focusContainer.classList.remove('fullscreen');
            // Restore standard width so IPC doesn't get confused
            reddIpc.send('set-focus-window-size', Math.min(Math.max(focusContainer.offsetWidth, 280), 500));
        }

        // Calculate elapsed time
        const elapsed = Date.now() - focusStartTime;

        // Apply strikethrough styling to the task name immediately for satisfying feedback
        if (focusTaskName) {
            focusTaskName.classList.add('completed');
        }

        if (focusedTaskId) {
            // Always resolve the task across tabs (focus panel may not share currentTabId)
            const context = getTaskContext(focusedTaskId);
            if (context) {
                context.task.actualDuration = elapsed;
                saveData();
                toggleTask(focusedTaskId);
            }
        } else {
            // Legacy fallback: find by visible name across tabs
            const name = focusTaskName?.textContent;
            if (name) {
                for (const tabId in tabs) {
                    const t = tabs[tabId].tasks.find(task => task.text === name && !task.completed);
                    if (t) {
                        t.actualDuration = elapsed;
                        saveData();
                        toggleTask(t.id);
                        break;
                    }
                }
            }
        }

        // Wait 300ms before exiting focus mode (same delay as task completion animation)
        setTimeout(() => {
            // Ensure the main window updates (important on macOS focus panel)
            reddIpc.send('refresh-main-window');
            exitFocusMode();

            // Clean up the completed class for next focus session
            if (focusTaskName) {
                focusTaskName.classList.remove('completed');
            }
        }, 300);
    });

    if (resetFocusBtn) {
        resetFocusBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Save current state before reset
            previousFocusStartTime = focusStartTime;

            // Reset timer to start from 0
            focusStartTime = Date.now();
            updateFocusTimer();

            // Hide buttons immediately to show timer clearly
            const buttonsContainer = document.querySelector('.focus-buttons-container');
            const focusTimer = document.getElementById('focus-timer');

            if (buttonsContainer) {
                buttonsContainer.style.opacity = '0';
                buttonsContainer.style.pointerEvents = 'none';

                // Also force timer to be visible (overriding CSS hover state)
                if (focusTimer) {
                    focusTimer.style.opacity = '1';
                }

                // Allow them to reappear on hover after a short delay
                setTimeout(() => {
                    buttonsContainer.style.opacity = '';
                    buttonsContainer.style.pointerEvents = '';

                    if (focusTimer) {
                        focusTimer.style.opacity = '';
                    }
                }, 500);
            }

            // Visual feedback via toast
            const toast = document.getElementById('focus-toast');
            if (toast) {
                toast.classList.remove('hidden'); // Ensure it's in DOM layout

                // Force reflow
                void toast.offsetWidth;

                toast.classList.add('visible');

                // Clear any existing timeout to prevent early dismissal if clicking multiple times
                if (toast.dataset.timeoutId) {
                    clearTimeout(parseInt(toast.dataset.timeoutId));
                }

                const timeoutId = setTimeout(() => {
                    toast.classList.remove('visible');
                    // wait for transition to finish before hiding
                    setTimeout(() => {
                        toast.classList.add('hidden');
                    }, 300);
                }, 4000); // Increased to 4s to give time to undo

                toast.dataset.timeoutId = timeoutId.toString();
            }
        });
    }

    // Undo button handler
    const focusUndoBtn = document.getElementById('focus-undo-btn');
    if (focusUndoBtn) {
        focusUndoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (previousFocusStartTime) {
                focusStartTime = previousFocusStartTime;
                updateFocusTimer();

                // Hide toast immediately
                const toast = document.getElementById('focus-toast');
                if (toast) {
                    toast.classList.remove('visible');
                    setTimeout(() => {
                        toast.classList.add('hidden');
                    }, 300);
                }
            }
        });
    }

    if (fullscreenFocusBtn) {
        let preFullscreenWidth = 320; // Store width before entering fullscreen

        fullscreenFocusBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const focusContainer = document.querySelector('.focus-container');
            const currentTimeSpent = focusStartTime ? (Date.now() - focusStartTime) : 0;
            const currentTaskName = (focusTaskName?.textContent || '').trim() || 'Task';
            if (focusContainer.classList.contains('fullscreen')) {
                if (reddIsTauri && platform === 'darwin' && isNativeFullscreenFocusWindow && focusedTaskId) {
                    reddIpc.send('exit-fullscreen-focus-handoff', {
                        taskId: focusedTaskId,
                        taskName: currentTaskName,
                        duration: focusDuration ?? null,
                        initialTimeSpent: currentTimeSpent
                    });
                    return;
                }
                // Exit fullscreen - restore previous width
                focusContainer.classList.remove('fullscreen');
                document.body.classList.remove('is-fullscreen');
                updateFullscreenButtonState(false);
                reddIpc.send('set-focus-window-size', preFullscreenWidth);
            } else {
                if (reddIsTauri && platform === 'darwin' && isFocusPanelWindow && !isNativeFullscreenFocusWindow && focusedTaskId) {
                    reddIpc.send('enter-fullscreen-focus-handoff', {
                        taskId: focusedTaskId,
                        taskName: currentTaskName,
                        duration: focusDuration ?? null,
                        initialTimeSpent: currentTimeSpent
                    });
                    return;
                }
                // Enter fullscreen - save current width first
                preFullscreenWidth = focusContainer.offsetWidth || 320;
                focusContainer.classList.add('fullscreen');
                document.body.classList.add('is-fullscreen');
                updateFullscreenButtonState(true);
                reddIpc.send('enter-fullscreen-focus');
            }
        });
    }

    // Focus mode notes button
    const notesFocusBtn = document.getElementById('notes-focus-btn');
    const focusNotesContainer = document.getElementById('focus-notes-container');
    const focusNotesWrapper = document.querySelector('.focus-notes-editor-wrapper');
    const focusNotesDoneBtn = document.getElementById('focus-notes-done-btn');
    let focusQuillInstance = null;
    const canResizeFocusWindowHeight = () => {
        const container = document.querySelector('.focus-container');
        return !!container && !container.classList.contains('fullscreen') && !isNativeFullscreenFocusWindow;
    };

    if (notesFocusBtn && focusNotesContainer) {
        notesFocusBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const isOpen = !focusNotesContainer.classList.contains('hidden');

            if (isOpen) {
                // Close notes
                focusNotesContainer.classList.add('hidden');
                notesFocusBtn.classList.remove('active');
                if (focusNotesWrapper) focusNotesWrapper.classList.remove('active');

                // Only resize when not in fullscreen mode.
                if (canResizeFocusWindowHeight()) {
                    reddIpc.send('set-focus-window-height', 48);
                }
            } else {
                // Open notes
                focusNotesContainer.classList.remove('hidden');
                notesFocusBtn.classList.add('active');

                // Initialize Quill if not done
                if (!focusQuillInstance) {
                    const editorDiv = document.getElementById('focus-notes-editor');
                    if (editorDiv) {
                        focusQuillInstance = new Quill(editorDiv, {
                            theme: 'snow',
                            placeholder: 'Add notes...',
                            modules: {
                                toolbar: [
                                    ['bold', 'italic', 'underline', 'strike'],
                                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                                    ['link']
                                ]
                            }
                        });

                        // Focus/blur handling
                        focusQuillInstance.on('selection-change', (range) => {
                            if (range) {
                                focusNotesWrapper.classList.add('active');
                            } else {
                                focusNotesWrapper.classList.remove('active');
                            }
                            // Recalculate height as toolbar visibility changes
                            setTimeout(() => {
                                const focusBar = document.querySelector('.focus-bar');
                                const barHeight = focusBar ? focusBar.offsetHeight : 48;
                                const totalHeight = barHeight + focusNotesContainer.offsetHeight;
                                if (canResizeFocusWindowHeight()) {
                                    reddIpc.send('set-focus-window-height', Math.min(totalHeight + 20, 600));
                                }
                            }, 50);
                        });

                        // Save handler
                        focusQuillInstance.on('text-change', () => {
                            const content = focusQuillInstance.root.innerHTML;
                            // Find and update the actual task
                            if (focusedTaskId) {
                                const context = getTaskContext(focusedTaskId);
                                if (context) {
                                    context.task.notes = content;
                                    context.task.notesChangedAt = new Date().toISOString(); // Track when notes changed
                                    if (content && content !== '<p><br></p>') {
                                        notesFocusBtn.classList.add('has-notes');
                                    } else {
                                        notesFocusBtn.classList.remove('has-notes');
                                    }
                                    // Debounce save
                                    if (focusQuillInstance.saveTimeout) clearTimeout(focusQuillInstance.saveTimeout);
                                    focusQuillInstance.saveTimeout = setTimeout(() => {
                                        saveData();
                                    }, 1000);
                                }
                            }

                            // Resize window to fit content as user types
                            const focusBar = document.querySelector('.focus-bar');
                            const barHeight = focusBar ? focusBar.offsetHeight : 48;
                            const totalHeight = barHeight + focusNotesContainer.offsetHeight;
                            if (canResizeFocusWindowHeight()) {
                                reddIpc.send('set-focus-window-height', Math.min(totalHeight + 20, 800));
                            }
                        });

                        focusQuillInstance.root.addEventListener('mousedown', (e) => e.stopPropagation());
                        const toolbar = focusNotesContainer.querySelector('.ql-toolbar');
                        if (toolbar) toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
                    }
                }

                // Load task notes if we have a focused task
                if (focusedTaskId) {
                    const context = getTaskContext(focusedTaskId);
                    if (context && context.task.notes) {
                        focusQuillInstance.root.innerHTML = context.task.notes;
                        notesFocusBtn.classList.add('has-notes');
                    } else {
                        focusQuillInstance.root.innerHTML = '';
                        notesFocusBtn.classList.remove('has-notes');
                    }
                }

                // Resize window to fit notes
                setTimeout(() => {
                    const focusBar = document.querySelector('.focus-bar');
                    const barHeight = focusBar ? focusBar.offsetHeight : 48;
                    const totalHeight = barHeight + focusNotesContainer.offsetHeight;
                    if (canResizeFocusWindowHeight()) {
                        reddIpc.send('set-focus-window-height', Math.min(totalHeight + 20, 600));
                    }
                }, 50);
            }
        });
    }

    // Done button for focus notes
    if (focusNotesDoneBtn) {
        focusNotesDoneBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (focusQuillInstance) {
                focusQuillInstance.blur();
            }
            if (focusNotesWrapper) {
                focusNotesWrapper.classList.remove('active');
            }
        });
    }

    // Delete all completed tasks
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', () => {
            if (!currentTabId || !tabs[currentTabId]) return;

            const currentTab = tabs[currentTabId];
            const completedTasksLocal = currentTab.tasks.filter(task => task.completed);
            if (completedTasksLocal.length === 0) return;

            // Save for undo (deep copy)
            lastDeletedItem = {
                type: 'tasks_bulk',
                data: JSON.parse(JSON.stringify(completedTasksLocal)),
                tabId: currentTabId,
                basecampListId: currentTab.basecampListId,
                remindersListId: currentTab.remindersListId
            };
            showUndoToast(`${completedTasksLocal.length} completed task${completedTasksLocal.length === 1 ? '' : 's'} deleted`);

            // If connected to Basecamp, delete all completed tasks remotely
            if (currentTab.basecampListId && basecampConfig.isConnected) {
                const completedTasks = currentTab.tasks.filter(task => task.completed && task.basecampId);
                completedTasks.forEach(task => {
                    deleteBasecampTodo(currentTabId, task.basecampId);
                });
            }

            // Keep only incomplete tasks
            tabs[currentTabId].tasks = tabs[currentTabId].tasks.filter(task => !task.completed);
            saveData();
            renderTasks();
        });
    }

    // Custom drag implementation removed in favor of -webkit-app-region: drag
    /* 
    const focusContainer = document.querySelector('.focus-container');
    if (focusContainer) {
        // Drag logic removed
    } 
    */

    // Window controls (Min/Max/Close)
    const minBtn = document.getElementById('min-btn');
    const maxBtn = document.getElementById('max-btn');
    const closeBtn = document.getElementById('close-btn');

    if (minBtn) {
        minBtn.addEventListener('click', () => {
            reddIpc.send('window-minimize');
        });
    }

    if (maxBtn) {
        maxBtn.addEventListener('click', () => {
            reddIpc.send('window-maximize');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            reddIpc.send('window-close');
        });
    }

    // Add Task Resizer
    const resizer = document.getElementById('add-task-resizer');
    if (resizer) {
        let startY, startMaxHeight;

        resizer.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            // Ensure we have a number
            startMaxHeight = parseInt(window.getComputedStyle(doneContainer).maxHeight) || doneMaxHeight;

            document.documentElement.style.cursor = 'grabbing';
            resizer.classList.add('dragging');

            // Disable interaction with tasks during resize
            tasksContainer.style.pointerEvents = 'none';

            const handleMouseMove = (e) => {
                const deltaY = startY - e.clientY; // Drag up = positive delta
                // If dragging up, max height increases. If dragging down, decreases.
                // Dragging UP means e.clientY is SMALLER than startY. So startY - clientY > 0.
                // This matches: dragging up increases done section size.

                let newHeight = startMaxHeight + deltaY;

                // Constraints
                if (newHeight < 15) {
                    newHeight = 0; // Snap to closed
                } else if (newHeight < 32 && newHeight >= 15) {
                    newHeight = 32; // Minimum visible height (heading + padding)
                }

                if (newHeight > window.innerHeight - 150) newHeight = window.innerHeight - 150; // Max constraint

                doneMaxHeight = newHeight;
                doneContainer.style.maxHeight = `${newHeight}px`;

                // If fully hidden, we might want to ensure padding doesn't show
                if (newHeight === 0) {
                    doneContainer.style.paddingTop = '0';
                    doneContainer.style.paddingBottom = '0';
                } else {
                    doneContainer.style.paddingTop = '8px';
                    doneContainer.style.paddingBottom = '16px';
                }
            };

            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.documentElement.style.cursor = '';
                resizer.classList.remove('dragging');

                // Re-enable interaction with tasks
                tasksContainer.style.pointerEvents = '';

                saveData(); // Persist the new preference
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
    }
}

// Focus mode functions
function updateFullscreenButtonState(isFullscreen) {
    const btn = document.getElementById('fullscreen-focus-btn');
    if (!btn) return;

    const path = btn.querySelector('path');
    if (isFullscreen) {
        // Collapse icon (arrows pointing inwards)
        path.setAttribute('d', 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7');
        btn.title = 'Exit fullscreen';
    } else {
        // Expand icon (arrows pointing outwards)
        path.setAttribute('d', 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
        btn.title = 'Enter fullscreen';
    }
}

function enterFocusMode(taskName, duration = null, initialTimeSpent = 0, preserveWindowGeometry = false) {
    console.log('enterFocusMode called with taskName:', taskName, 'duration:', duration, 'initialTimeSpent:', initialTimeSpent);
    // If we re-enter focus mode (e.g. switching tasks), avoid duplicating timer intervals.
    stopFocusTimer();
    isFocusMode = true;
    focusDuration = duration; // Set the duration

    console.log('Hiding normal mode, showing focus mode');
    normalMode.classList.add('hidden');
    focusMode.classList.remove('hidden');

    // Reset fullscreen state if present (ensure we start fresh)
    const container = document.querySelector('.focus-container');
    if (container) {
        if (isNativeFullscreenFocusWindow) {
            container.classList.add('fullscreen');
            document.body.classList.add('is-fullscreen');
            updateFullscreenButtonState(true);
        } else {
            container.classList.remove('fullscreen');
            document.body.classList.remove('is-fullscreen');
            updateFullscreenButtonState(false);
        }

        // Draw attention to the focus window location (useful when it pops up).
        container.classList.remove('attention-ring');
        // Force reflow so restarting the class retriggers the animation
        void container.offsetWidth;
        container.classList.add('attention-ring');
        setTimeout(() => {
            container.classList.remove('attention-ring');
        }, 1000);
    }

    focusTaskName.textContent = taskName;
    focusTaskName.title = taskName;

    console.log('Starting focus timer');
    startFocusTimer(initialTimeSpent);

    // Calculate appropriate window width based on content
    setTimeout(() => {
        if (container && !isNativeFullscreenFocusWindow && !preserveWindowGeometry) {
            const containerWidth = Math.min(Math.max(container.offsetWidth, 280), 500);
            console.log('Calculated container width:', containerWidth);
            reddIpc.send('set-focus-window-size', containerWidth);
        }
    }, 50); // Small delay to ensure DOM is updated

    // Legacy Electron compatibility path; in Tauri this causes an invalid
    // open_focus_window invoke without taskId, so skip it.
    if (!reddIsTauri) {
        console.log('Sending enter-focus-mode IPC');
        reddIpc.send('enter-focus-mode', taskName);
    }
}

function exitFocusMode() {
    const closingTaskId = focusedTaskId;

    // Save progress if we have a focused task
    if (focusedTaskId && currentTabId && isFocusMode && focusStartTime) {
        const elapsed = Date.now() - focusStartTime;
        const task = tabs[currentTabId].tasks.find(t => t.id === focusedTaskId);
        if (task) {
            task.timeSpent = elapsed;
            saveData();
        }
    }

    isFocusMode = false;
    focusedTaskId = null; // Clear focused task ID
    // Only clear the "active focus" indicator in this window if we're not the main window on macOS.
    // On macOS the main process will broadcast focus-status-changed when the panel closes.
    if (!isFocusPanelWindow && platform !== 'darwin') {
        activeFocusTaskIds.clear();
    }
    focusDuration = null; // Reset duration
    stopFocusTimer();

    // Reset overtime style
    if (focusTimer) {
        focusTimer.classList.remove('overtime');
    }

    // If this is the focus panel window, just call the backend to close it
    // Don't switch to normal mode as that would show main app content in the panel
    if (isFocusPanelWindow) {
        reddIpc.send('exit-focus-mode', { taskId: closingTaskId });
        return;
    }

    // For main window, switch UI modes
    focusMode.classList.add('hidden');
    normalMode.classList.remove('hidden');

    reddIpc.send('exit-focus-mode', { taskId: closingTaskId });
}

function startFocusTimer(initialTimeSpent = 0) {
    focusStartTime = Date.now() - initialTimeSpent;
    // Update immediately
    updateFocusTimer();
    focusTimerInterval = setInterval(updateFocusTimer, 1000);
}

function stopFocusTimer() {
    if (focusTimerInterval) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
    }
}

function updateFocusTimer() {
    if (!isFocusMode || !focusStartTime) return;

    const elapsed = Date.now() - focusStartTime;
    let displayMs = elapsed;
    let isOvertime = false;

    if (focusDuration) {
        const totalMs = focusDuration * 60 * 1000;
        if (elapsed >= totalMs) {
            isOvertime = true;
            displayMs = elapsed - totalMs;
        } else {
            displayMs = totalMs - elapsed;
            // Round up for countdown behavior (so 100ms left shows 1s)
            displayMs = Math.ceil(displayMs / 1000) * 1000;
        }
    }

    const hours = Math.floor(displayMs / (1000 * 60 * 60));
    const minutes = Math.floor((displayMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((displayMs % (1000 * 60)) / 1000);

    let timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (isOvertime && focusDuration) {
        timeString = `-${timeString}`;
        focusTimer.classList.add('overtime');
    } else {
        focusTimer.classList.remove('overtime');
    }

    focusTimer.textContent = timeString;
}

// Drag and drop functions
function handleDragStart(e) {
    // Use currentTarget so we always refer to the .task-item (not a child)
    draggedTaskId = e.currentTarget?.dataset?.taskId;

    // For favourites view, find the actual tab containing this task
    if (currentView === 'favourites' && draggedTaskId) {
        dragSourceTabId = null; // Will be null for favourites reordering
        for (const tabId in tabs) {
            if (tabs[tabId].tasks.find(t => t.id === draggedTaskId)) {
                dragSourceTabId = tabId;
                break;
            }
        }
    } else {
        dragSourceTabId = currentTabId; // Store the source tab for cross-tab moves
    }

    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
    e.dataTransfer.setData('text/plain', draggedTaskId); // For cross-tab detection
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging', 'drag-over-tab');

    // If we were dragging to a different tab with a placeholder, finalize the move
    if (dragTargetTabId && draggedTaskId && dragSourceTabId) {
        // Get the placeholder position
        const container = tasksContainer;
        const placeholder = container.querySelector('.task-placeholder');

        if (placeholder) {
            // Find where the placeholder is
            let insertPosition = 0;
            const children = Array.from(container.children);
            for (let i = 0; i < children.length; i++) {
                if (children[i] === placeholder) break;
                if (children[i].classList.contains('task-item') && !children[i].dataset.isPlaceholder) {
                    insertPosition++;
                }
            }

            // Move the task to the target tab at the specified position
            moveTaskToTabAtPosition(draggedTaskId, dragSourceTabId, dragTargetTabId, insertPosition);
        }

        // Clean up placeholder state
        dragTargetTabId = null;
        dragPlaceholderPosition = 0;
    } else {
        // Normal same-tab reordering
        persistTaskOrderFromDOM();
    }

    // Clean up cross-tab drag state
    draggedTaskId = null;
    dragSourceTabId = null;
    lastHoveredTabId = null;
    if (tabHoverTimeout) {
        clearTimeout(tabHoverTimeout);
        tabHoverTimeout = null;
    }

    // Remove any tab hover indicators
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('task-drop-target', 'task-drop-incompatible');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Live reordering: move the dragged element in the DOM as we hover.
    // (This is the same UX as tab reordering.)
    // Support both lists and favourites views
    if (!draggedTaskId) return;
    // In lists view, only allow when actually in lists view
    // In favourites view, allow reordering of favourites
    if (currentView === 'lists' && dragTargetTabId) return; // Cross-tab drag, handled differently

    const container = tasksContainer;
    const draggable = container.querySelector('.task-item.dragging');
    if (!draggable) return;

    const afterElement = getDragAfterElementVertical(container, e.clientY, '.task-item');
    const bottomTarget = container.querySelector('.bottom-drag-target');

    if (afterElement == null) {
        // Insert before bottom target if present, otherwise append.
        if (bottomTarget) {
            container.insertBefore(draggable, bottomTarget);
        } else {
            container.appendChild(draggable);
        }
    } else if (afterElement !== draggable) {
        container.insertBefore(draggable, afterElement);
    }
}

function handleDrop(e) {
    e.preventDefault();
    // DOM already reflects the new order; just persist it.
    persistTaskOrderFromDOM();
}

function persistTaskOrderFromDOM() {
    const domTaskIds = Array.from(tasksContainer.querySelectorAll('.task-item'))
        .map(el => el.dataset.taskId)
        .filter(Boolean);

    // If there are no rendered tasks (e.g. empty state), don't mutate.
    if (domTaskIds.length === 0) return;

    if (currentView === 'favourites') {
        // For favourites view, update the favouritesOrder array
        // Only track incomplete favourites in the DOM order
        favouritesOrder = domTaskIds.filter(id => {
            // Find the task and check if it's incomplete and a favourite
            for (const tabId in tabs) {
                const task = tabs[tabId].tasks.find(t => t.id === id);
                if (task && task.isFavourite && !task.completed) {
                    return true;
                }
            }
            return false;
        });
        saveData();
        renderTasks();
        return;
    }

    // Lists view handling
    if (!currentTabId || !tabs[currentTabId]) return;

    const currentTab = tabs[currentTabId];
    const byId = new Map(currentTab.tasks.map(t => [t.id, t]));
    const incompletesInDomOrder = domTaskIds
        .map(id => byId.get(id))
        .filter(t => t && !t.completed);
    const completed = currentTab.tasks.filter(t => t.completed);

    // Replace the tab's tasks array with incompletes in DOM order, plus completed tasks.
    currentTab.tasks = [...incompletesInDomOrder, ...completed];

    saveData();
    renderTasks();
}

// Bottom drag handlers
function handleBottomDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!draggedTaskId) return;
    const container = tasksContainer;
    const draggable = container.querySelector('.task-item.dragging');
    const bottomTarget = e.currentTarget;
    if (!draggable || !bottomTarget) return;

    // While hovering the bottom target, keep the dragged item at the end.
    container.insertBefore(draggable, bottomTarget);
}

function handleBottomDragLeave(e) {
    // no-op (we don't use the drag-over indicator anymore)
}

function handleBottomDrop(e) {
    e.preventDefault();
    persistTaskOrderFromDOM();
}

// Cross-tab task drag handlers
let lastHoveredTabId = null; // Track which tab we're hovering to prevent flickering

function handleTaskDragOverTab(e) {
    e.preventDefault();

    // Only handle if a task is being dragged (not a tab)
    if (!draggedTaskId || draggedTabId) return;

    const targetTab = e.currentTarget;
    const targetTabId = targetTab.dataset.tabId;

    // Don't do anything if hovering over the current tab or already switched to target
    if (targetTabId === dragSourceTabId || targetTabId === dragTargetTabId) {
        targetTab.classList.remove('task-drop-target', 'task-drop-incompatible');
        return;
    }

    // Check compatibility
    const isCompatible = areTabsCompatible(dragSourceTabId, targetTabId);

    // Shrink the dragged task when over a compatible tab
    const draggedElement = document.querySelector('.task-item.dragging');
    if (draggedElement && isCompatible) {
        draggedElement.classList.add('drag-over-tab');
    }

    if (isCompatible) {
        e.dataTransfer.dropEffect = 'move';
        targetTab.classList.add('task-drop-target');
        targetTab.classList.remove('task-drop-incompatible');

        // Set up a timer to switch to this tab after hovering for 500ms
        // Only set up if we're hovering a new tab
        if (lastHoveredTabId !== targetTabId) {
            lastHoveredTabId = targetTabId;
            if (tabHoverTimeout) {
                clearTimeout(tabHoverTimeout);
            }
            tabHoverTimeout = setTimeout(() => {
                // Switch to the target tab (but don't move the task yet)
                switchToTabForDrag(targetTabId);
                tabHoverTimeout = null;

                // Remove tab highlight
                targetTab.classList.remove('task-drop-target');
            }, 500);
        }
    } else {
        e.dataTransfer.dropEffect = 'none';
        targetTab.classList.add('task-drop-incompatible');
        targetTab.classList.remove('task-drop-target');
    }
}

function handleTaskDragLeaveTab(e) {
    const targetTab = e.currentTarget;
    const targetTabId = targetTab.dataset.tabId;

    // Only clear if we're actually leaving this tab (not just moving within it)
    // Check if the related target is still within the tab
    const relatedTarget = e.relatedTarget;
    if (relatedTarget && targetTab.contains(relatedTarget)) {
        return; // Still within the tab, don't clear
    }

    targetTab.classList.remove('task-drop-target', 'task-drop-incompatible');

    // Restore the dragged task to full size when leaving a tab
    const draggedElement = document.querySelector('.task-item.dragging');
    if (draggedElement) {
        draggedElement.classList.remove('drag-over-tab');
    }

    // Clear the tab switch timer and reset hover tracking
    if (lastHoveredTabId === targetTabId) {
        lastHoveredTabId = null;
    }
    if (tabHoverTimeout) {
        clearTimeout(tabHoverTimeout);
        tabHoverTimeout = null;
    }
}

function handleTaskDropOnTab(e) {
    e.preventDefault();
    e.stopPropagation();

    // Only handle if a task is being dragged
    if (!draggedTaskId || draggedTabId) return;

    const targetTab = e.currentTarget;
    const targetTabId = targetTab.dataset.tabId;

    // Don't do anything if dropping on the same tab (might have already been moved by hover)
    if (targetTabId === dragSourceTabId) return;

    // Check compatibility
    if (!areTabsCompatible(dragSourceTabId, targetTabId)) return;

    // Clear any pending tab switch
    if (tabHoverTimeout) {
        clearTimeout(tabHoverTimeout);
        tabHoverTimeout = null;
    }

    // Move the task to the new tab (at top since dropped directly on tab)
    moveTaskToTab(draggedTaskId, dragSourceTabId, targetTabId, true);

    // Clean up
    targetTab.classList.remove('task-drop-target', 'task-drop-incompatible');
    const draggedElement = document.querySelector('.task-item.dragging');
    if (draggedElement) {
        draggedElement.classList.remove('drag-over-tab');
    }
}

// Move a task from one tab to another
// If addToTop is true, adds to the beginning of incomplete tasks (default when dropping on tab)
function moveTaskToTab(taskId, sourceTabId, targetTabId, addToTop = true) {
    const sourceTab = tabs[sourceTabId];
    const targetTab = tabs[targetTabId];

    if (!sourceTab || !targetTab) return;

    // Find the task in the source tab
    const taskIndex = sourceTab.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    // Remove from source tab
    const [task] = sourceTab.tasks.splice(taskIndex, 1);

    // Add to the target tab
    if (addToTop) {
        // Add to the very beginning (top of incomplete tasks)
        targetTab.tasks.unshift(task);
    } else {
        // Add at the end of incomplete tasks (before completed)
        const firstCompletedIndex = targetTab.tasks.findIndex(t => t.completed);
        if (firstCompletedIndex === -1) {
            targetTab.tasks.push(task);
        } else {
            targetTab.tasks.splice(firstCompletedIndex, 0, task);
        }
    }

    handleTaskSyncOnMove(task, sourceTab, targetTab);

    // Switch to target tab and render
    switchToTab(targetTabId);
    saveData();
}

// Move a task to a specific position in the target tab
function moveTaskToTabAtPosition(taskId, sourceTabId, targetTabId, position) {
    const sourceTab = tabs[sourceTabId];
    const targetTab = tabs[targetTabId];

    if (!sourceTab || !targetTab) return;

    // Find the task in the source tab
    const taskIndex = sourceTab.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    // Remove from source tab
    const [task] = sourceTab.tasks.splice(taskIndex, 1);

    // Insert at the specified position (among incomplete tasks)
    const incompleteTasks = targetTab.tasks.filter(t => !t.completed);
    const completedTasks = targetTab.tasks.filter(t => t.completed);

    // Clamp position to valid range
    const clampedPosition = Math.max(0, Math.min(position, incompleteTasks.length));

    // Insert task at position
    incompleteTasks.splice(clampedPosition, 0, task);

    // Rebuild the tasks array
    targetTab.tasks = [...incompleteTasks, ...completedTasks];

    handleTaskSyncOnMove(task, sourceTab, targetTab);

    // Already on target tab, just re-render
    saveData();
    renderTasks();
}

// Handle sync-related updates when moving a task between tabs
async function handleTaskSyncOnMove(task, sourceTab, targetTab) {
    // Handle sync-related ID updates
    // For Reminders: need to delete from source list and create in target list
    if (sourceTab.remindersListId && task.remindersId && remindersConfig.isConnected) {
        // Delete from source Reminders list
        deleteRemindersTask(task.remindersId);
        // Create in target Reminders list
        if (targetTab.remindersListId) {
            createRemindersTask(targetTab.remindersListId, task.text).then(newId => {
                if (newId) {
                    task.remindersId = newId;
                    if (task.completed) {
                        updateRemindersCompletion(newId, true);
                    }
                    saveData();
                }
            });
        }
        task.remindersId = null; // Clear until new ID is set
    }

    // For Basecamp: move the todo to the new list (preserves the todo, no duplicates)
    if (sourceTab.basecampListId && task.basecampId && targetTab.basecampListId) {
        if (!basecampConfig.isConnected || !basecampConfig.accessToken) {
            console.warn('Basecamp not connected or no access token - skipping Basecamp move');
            return;
        }
        console.log('Moving Basecamp todo:', task.basecampId, 'from list', sourceTab.basecampListId, 'to list', targetTab.basecampListId);
        await moveBasecampTodo(task, sourceTab, targetTab);
    }
}

// Move task to bottom function
function moveTaskToBottom(taskId) {
    if (!currentTabId) return;

    const currentTab = tabs[currentTabId];
    const taskIndex = currentTab.tasks.findIndex(task => task.id === taskId);

    if (taskIndex === -1) return;

    // Remove task and add to end
    const [task] = currentTab.tasks.splice(taskIndex, 1);
    currentTab.tasks.push(task);

    // Save and re-render
    saveData();
    renderTasks();
}

function editTaskText(taskId, textElement) {
    const context = getTaskContext(taskId);
    if (!context) return;

    const { task, tabId, tab } = context;

    // Create textarea element (auto-sizes to content)
    const textarea = document.createElement('textarea');
    textarea.value = task.text;
    textarea.className = 'task-edit-input';
    textarea.rows = 1; // Start with 1 row, will auto-resize

    // Auto-resize function
    function autoResize() {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }

    // Prevent drag start on textarea
    textarea.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    // Replace text with textarea
    textElement.replaceWith(textarea);
    autoResize(); // Size to content immediately
    textarea.focus();
    // Place cursor at end of text
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // Auto-resize on input
    textarea.addEventListener('input', autoResize);

    // Save on blur
    function saveEdit() {
        const newText = textarea.value.trim();
        if (newText) {
            task.text = newText;

            // If connected to Basecamp and task has a remote ID, sync the change
            if (tab.basecampListId && basecampConfig.isConnected && task.basecampId) {
                updateBasecampTodoText(tabId, task);
            }

            // If connected to Reminders, sync text change
            if (tab.remindersListId && remindersConfig.isConnected && task.remindersId) {
                updateRemindersTitle(task.remindersId, task.text);
            }

            saveData();

            // Sync to other windows (e.g. macOS focus panel)
            reddIpc.send('task-updated', { taskId, text: task.text });
        }
        renderTasks(); // Re-render to restore span and update UI
    }

    textarea.addEventListener('blur', saveEdit);
    textarea.addEventListener('keydown', (e) => {
        // Save on Enter (without Shift), allow Shift+Enter for newlines
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            saveEdit();
        }
    });
}

function editTaskDuration(taskId, metaElement) {
    const context = getTaskContext(taskId);
    if (!context) return;

    const { task } = context;
    const isAddTimeClick = metaElement.classList && metaElement.classList.contains('add-time');

    // Determine what value to show: actualDuration (ms) converted to minutes, or expectedDuration
    let initialValue = '';
    if (isAddTimeClick) {
        // Clicking the "+" should start with a default duration
        initialValue = 5;
    } else if (task.completed && task.actualDuration) {
        initialValue = Math.round(task.actualDuration / (1000 * 60));
    } else {
        initialValue = task.expectedDuration || '';
    }

    // Build the same UI as the "new task" duration input (input + "m" + steppers).
    const container = document.createElement('span');
    container.className = 'duration-input-container visible task-duration-edit';
    if (String(initialValue).length > 0) container.classList.add('has-value');

    const input = document.createElement('input');
    input.type = 'number';
    input.value = initialValue;
    input.className = 'task-duration-input';
    input.min = '1';
    input.max = '999';
    input.placeholder = '15m';

    const label = document.createElement('span');
    label.className = 'duration-label';
    label.textContent = 'm';

    const spinners = document.createElement('div');
    spinners.className = 'duration-spinners';

    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = 'duration-spinner-btn';
    incBtn.tabIndex = -1;
    incBtn.setAttribute('aria-label', 'Increase duration');
    incBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';

    const decBtn = document.createElement('button');
    decBtn.type = 'button';
    decBtn.className = 'duration-spinner-btn';
    decBtn.tabIndex = -1;
    decBtn.setAttribute('aria-label', 'Decrease duration');
    decBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    spinners.appendChild(incBtn);
    spinners.appendChild(decBtn);

    container.appendChild(input);
    container.appendChild(label);
    container.appendChild(spinners);

    // Prevent drag / accidental blur-save when clicking steppers
    container.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    incBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    decBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });

    // Toggle label + spinner visibility
    input.addEventListener('input', () => {
        if (input.value.length > 0) container.classList.add('has-value');
        else container.classList.remove('has-value');
    });

    // Spinner behavior for existing tasks: 1-minute increments
    incBtn.addEventListener('click', () => {
        const currentVal = parseInt(input.value, 10);
        const base = Number.isFinite(currentVal) ? currentVal : 0;
        const newVal = Math.min(Math.max(base + 1, 0), 999);
        input.value = newVal;
        container.classList.add('has-value');
    });

    decBtn.addEventListener('click', () => {
        const currentVal = parseInt(input.value, 10);
        if (!Number.isFinite(currentVal) || currentVal <= 0) {
            input.value = 0; // Ensure it goes to 0 if invalid or < 0
            return;
        }
        const newVal = Math.min(Math.max(currentVal - 1, 0), 999);
        input.value = newVal;
        container.classList.add('has-value');
    });

    // Replace meta span with widget
    metaElement.replaceWith(container);
    input.focus();

    // Save on blur or enter
    function saveEdit() {
        const newVal = input.value.trim();
        if (newVal) {
            const minutes = parseInt(newVal, 10);
            if (task.completed) {
                // If completed, update actualDuration (store as ms)
                task.actualDuration = minutes * 60 * 1000;
            } else {
                // If not completed, update expectedDuration
                task.expectedDuration = minutes;
            }
        } else {
            // If empty, clear value
            if (task.completed) {
                task.actualDuration = null;
            } else {
                task.expectedDuration = null;
            }
        }
        saveData();
        renderTasks(); // Re-render to restore span and update UI
    }

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveEdit();
        }
    });
}

// Color selection helper functions
// Color order matching the HTML order: blue, gray, green, yellow, pink, orange, red, purple
const COLOR_ORDER = ['blue', 'gray', 'green', 'yellow', 'pink', 'orange', 'red', 'purple'];
const TAB_COLOR_HEX = {
    red: '#FF9E9E',
    orange: '#FFC09F',
    yellow: '#FFEE93',
    green: '#ADF7B6',
    blue: '#81B1D1',
    purple: '#B19CD9',
    pink: '#FFD1DC',
    gray: '#A0CED9'
};

function normalizeHexColor(color) {
    if (typeof color !== 'string' || !color.startsWith('#')) return null;
    let hex = color.slice(1).trim();
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return `#${hex.toUpperCase()}`;
}

function resolveTabColorHex(color) {
    if (!color) return null;
    if (color.startsWith('#')) return normalizeHexColor(color);
    return TAB_COLOR_HEX[color] || null;
}

function hexToRgba(hex, alpha) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    const raw = normalized.slice(1);
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Finds the next color in sequence based on used colors.
 * If colors 1, 2, 3 are used, returns color 4.
 * If all colors are used, wraps around to color 1.
 * @param {Array<string>} usedColors - Array of color names/values that are already used
 * @returns {string} - The next color name in sequence, or '' if no colors available
 */
function findNextColor(usedColors) {
    // Filter to only include colors from our palette (exclude empty string and custom hex colors)
    const usedPaletteColors = usedColors.filter(color =>
        color && !color.startsWith('#') && COLOR_ORDER.includes(color)
    );

    if (usedPaletteColors.length === 0) {
        // No colors used, return first color
        return COLOR_ORDER[0];
    }

    // Find the highest index used
    const usedIndices = usedPaletteColors.map(color => COLOR_ORDER.indexOf(color));
    const maxUsedIndex = Math.max(...usedIndices);

    // Return the next color (wrap around if needed)
    const nextIndex = (maxUsedIndex + 1) % COLOR_ORDER.length;
    return COLOR_ORDER[nextIndex];
}

// Modal functions
function showTabNameModal() {
    renamingTabId = null;
    modalTitle.textContent = 'Enter list name';
    createTabBtn.textContent = 'Create';
    tabNameInput.value = '';
    tabNameInput.placeholder = 'My to-do list';
    tabNameModal.classList.remove('hidden');
    tabNameModal.dataset.mode = 'tab'; // Ensure default mode

    // Handle Basecamp visibility
    if (basecampConfig.isConnected) {
        basecampSelection.classList.remove('hidden');
        bcProjectSelect.innerHTML = '<option value="">Select a project...</option>';
        bcListSelect.innerHTML = '<option value="">Select a list...</option>';
        bcListWrapper.classList.add('hidden');

        fetchBasecampProjects().then(projects => {
            if (projects.length === 0) {
                bcProjectSelect.innerHTML = '<option value="">No projects found</option>';
            } else {
                projects.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    bcProjectSelect.appendChild(opt);
                });
            }
        });
    } else {
        basecampSelection.classList.add('hidden');
    }

    // Handle Reminders visibility
    if (remindersConfig.isConnected) {
        remindersSelection.classList.remove('hidden');
        if (remindersSelectionLabel) remindersSelectionLabel.textContent = 'Reminders List';
        remindersGroupsForImport = new Map();
        remindersListSelect.innerHTML = '<option value="">Select a list...</option>';

        fetchRemindersLists().then(lists => {
            if (lists.length === 0) {
                remindersListSelect.innerHTML = '<option value="">No lists found</option>';
            } else {
                lists.forEach(l => {
                    const opt = document.createElement('option');
                    opt.value = l.id;
                    opt.textContent = l.name;
                    remindersListSelect.appendChild(opt);
                });
            }
        });
    } else {
        remindersSelection.classList.add('hidden');
    }

    // Reset color picker and select next available color
    const colorSwatches = document.querySelectorAll('.color-swatch');
    colorSwatches.forEach(swatch => {
        swatch.classList.remove('selected');
    });

    // Find next color for tabs in current group
    let nextColor = '';
    if (enableGroups && currentGroupId) {
        // Get all tabs in the current group
        const tabsInGroup = Object.values(tabs).filter(tab => tab.groupId === currentGroupId);
        const usedColors = tabsInGroup.map(tab => tab.color).filter(Boolean);
        nextColor = findNextColor(usedColors);
    } else if (!enableGroups) {
        // Groups disabled - get all tabs
        const usedColors = Object.values(tabs).map(tab => tab.color).filter(Boolean);
        nextColor = findNextColor(usedColors);
    } else {
        // No group selected, default to first color
        nextColor = COLOR_ORDER[0];
    }

    // Select the next color swatch
    const nextColorSwatch = Array.from(colorSwatches).find(swatch => swatch.dataset.color === nextColor);
    if (nextColorSwatch) {
        nextColorSwatch.classList.add('selected');
    } else {
        // Fallback to "none" if color not found
        const noneSwatch = Array.from(colorSwatches).find(swatch => swatch.dataset.color === '');
        if (noneSwatch) {
            noneSwatch.classList.add('selected');
        }
    }

    tabNameInput.focus();
}

function updateGroupImportButtonLabel() {
    if (tabNameModal.dataset.mode !== 'group') return;

    const hasBasecampProject = !!bcProjectSelect.value;
    const hasRemindersGroup = !!remindersListSelect.value;

    if (hasBasecampProject) {
        createTabBtn.textContent = 'Import to-do lists from project';
    } else if (hasRemindersGroup) {
        createTabBtn.textContent = 'Import to-do lists from reminders group';
    } else {
        createTabBtn.textContent = 'Create Group';
    }
}

function showRenameModal(tabId) {
    renamingTabId = tabId;
    const tab = tabs[tabId];
    if (tab) {
        modalTitle.textContent = 'Edit list';
        createTabBtn.textContent = 'Save';
        tabNameInput.value = tab.name;
        basecampSelection.classList.remove('hidden'); // allow moving connections
        remindersSelection.classList.remove('hidden'); // allow moving connections
        tabNameModal.classList.remove('hidden');

        // Select logic for color
        const colorSwatches = document.querySelectorAll('.color-swatch');
        const customColorInput = document.getElementById('custom-color-input');
        const customSwatch = document.querySelector('.color-swatch-custom');

        colorSwatches.forEach(swatch => {
            swatch.classList.remove('selected');
            if (swatch.dataset.color === (tab.color || '')) {
                swatch.classList.add('selected');
            }
        });

        // Handle custom hex color
        if (tab.color && tab.color.startsWith('#')) {
            if (customColorInput) customColorInput.value = tab.color;
            if (customSwatch) {
                customSwatch.style.background = tab.color;
                customSwatch.classList.add('selected');
            }
        } else {
            // Reset custom swatch to rainbow gradient
            if (customSwatch) {
                customSwatch.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
            }
        }

        tabNameInput.focus();
        tabNameInput.select();
    }
}

function hideTabNameModal() {
    tabNameModal.classList.add('hidden');
    tabNameInput.value = '';
    renamingTabId = null;
}

function showDeleteConfirmModal(tabId, message) {
    pendingDeleteTabId = tabId;
    pendingDeleteGroupId = null;
    deleteConfirmMessage.innerHTML = message;
    deleteConfirmModal.classList.remove('hidden');
}

function showGroupDeleteConfirmModal(groupId, message) {
    pendingDeleteGroupId = groupId;
    pendingDeleteTabId = null;
    deleteConfirmMessage.innerHTML = message;
    deleteConfirmModal.classList.remove('hidden');
}

function hideDeleteConfirmModal() {
    deleteConfirmModal.classList.add('hidden');
    pendingDeleteTabId = null;
    pendingDeleteGroupId = null;
}

// IPC listeners
reddIpc.on('enter-focus-mode', (event, payload) => {
    // Focus-mode events are for the dedicated focus window only.
    if (!isFocusPanelWindow) return;

    if (payload && typeof payload === 'object') {
        if (payload.taskId) {
            focusedTaskId = payload.taskId;
        }
        enterFocusMode(
            payload.taskName,
            payload.duration ?? null,
            payload.initialTimeSpent ?? 0,
            payload.preserveWindowGeometry ?? false
        );
        return;
    }

    // Backwards compatibility (string taskName)
    enterFocusMode(payload);
});

reddIpc.on('exit-focus-mode', () => {
    if (!isFocusPanelWindow) return;
    exitFocusMode();
});

// Used by main process to force the main window to re-load state
reddIpc.on('refresh-data', () => {
    if (isFocusPanelWindow) return;
    loadData();
    renderGroups();
    renderTabs();
    renderTasks();
    updateBasecampUI();
    updateRemindersUI();
});

reddIpc.on('focus-status-changed', (event, payload) => {
    if (isFocusPanelWindow) return;
    const openedTaskId = payload?.openedTaskId;
    const closedTaskId = payload?.closedTaskId;

    if (openedTaskId) activeFocusTaskIds.add(openedTaskId);
    if (closedTaskId) activeFocusTaskIds.delete(closedTaskId);
    if (!openedTaskId && !closedTaskId && payload?.activeTaskId == null) {
        activeFocusTaskIds.clear();
    }
    renderTasks();
});

reddIpc.on('task-updated', (event, payload) => {
    const taskId = payload?.taskId;
    const text = payload?.text;
    if (!taskId || typeof text !== 'string') return;

    // Update the focus window display immediately if the focused task is renamed in the main window.
    if (isFocusPanelWindow) {
        if (focusedTaskId === taskId) {
            focusTaskName.textContent = text;
            focusTaskName.title = text;
        }
        return;
    }

    // If an update comes from the focus window (or elsewhere), refresh from storage.
    // (We intentionally reload instead of mutating to avoid diverging state.)
    loadData();
    renderTasks();
});

// Basecamp Authentication Logic

// Handle deep link callback from Tauri (redddo://oauth-callback?...)
if (reddIsTauri && typeof tauriAPI !== 'undefined') {
    tauriAPI.onEvent('deep-link-received', async (url) => {
        console.log('[Basecamp OAuth] Deep link received:', url);

        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'redddo:' || parsed.hostname !== 'oauth-callback') {
                console.log('[Basecamp OAuth] Ignoring non-OAuth deep link');
                return;
            }

            // Check for error
            const error = parsed.searchParams.get('error');
            if (error) {
                console.error('[Basecamp OAuth] Error from callback:', error);
                const errorDesc = parsed.searchParams.get('error_description') || error;
                alert(`Basecamp authentication failed: ${errorDesc}`);
                return;
            }

            // Extract tokens
            const accessToken = parsed.searchParams.get('access_token');
            const refreshToken = parsed.searchParams.get('refresh_token');
            const expiresIn = parsed.searchParams.get('expires_in');

            if (accessToken) {
                console.log('[Basecamp OAuth] SUCCESS - Tokens received via deep link');

                basecampConfig.accessToken = accessToken;
                basecampConfig.refreshToken = refreshToken;

                // Fetch identity and save
                try {
                    await fetchBasecampIdentity();
                    console.log('[Basecamp OAuth] Identity fetched, account ID:', basecampConfig.accountId);
                    saveData();
                    updateBasecampUI();
                } catch (e) {
                    console.error('[Basecamp OAuth] Failed to fetch identity:', e);
                }
            } else {
                console.error('[Basecamp OAuth] No access token in callback');
            }
        } catch (e) {
            console.error('[Basecamp OAuth] Error parsing deep link:', e);
        }
    });
}

reddIpc.on('basecamp-auth-success', async (event, data) => {
    console.log('[Basecamp OAuth] SUCCESS - Tokens received from main process');
    console.log('[Basecamp OAuth] Access token received:', !!data.access_token);
    console.log('[Basecamp OAuth] Refresh token received:', !!data.refresh_token);

    basecampConfig.accessToken = data.access_token;
    basecampConfig.refreshToken = data.refresh_token;
    basecampConfig.clientId = data.client_id;
    basecampConfig.clientSecret = data.client_secret;

    // Now we need to get the account ID (Identity)
    console.log('[Basecamp OAuth] Fetching Basecamp identity...');
    try {
        await fetchBasecampIdentity();
        console.log('[Basecamp OAuth] Identity fetched successfully, account ID:', basecampConfig.accountId);
    } catch (e) {
        console.error('[Basecamp OAuth] Failed to fetch identity:', e);
    }

    basecampConfig.isConnected = true;
    saveData();
    updateBasecampUI();
    updateSyncButtonState();
    console.log('[Basecamp OAuth] Connection complete! UI updated.');

    // Reset button
    if (oauthConnectBtn) {
        oauthConnectBtn.innerHTML = '<img src="images/basecamp_logo_icon_147315.png" width="16" height="16" style="filter: brightness(0) invert(1); margin-right: 8px;"> Connect with Basecamp';
        oauthConnectBtn.disabled = false;
    }
});

reddIpc.on('basecamp-auth-error', (event, errorMessage) => {
    console.error('[Basecamp OAuth] ERROR - Authentication failed:', errorMessage);
    alert('Authentication failed: ' + errorMessage);
    if (oauthConnectBtn) {
        oauthConnectBtn.textContent = 'Connect with Basecamp';
        oauthConnectBtn.disabled = false;
    }
});

// Data persistence
function saveData() {
    const data = {
        tabs: tabs,
        currentTabId: currentTabId,
        taskCounter: taskCounter,
        basecampConfig: basecampConfig,
        remindersConfig: remindersConfig,
        isDoneCollapsed: isDoneCollapsed,
        doneMaxHeight: doneMaxHeight,
        groups: groups,
        currentGroupId: currentGroupId,
        enableGroups: enableGroups,
        enablePlan: enablePlan,
        favouritesOrder: favouritesOrder
    };
    localStorage.setItem('redd-todo-data', JSON.stringify(data));
}

function loadData() {
    try {
        // Try loading new data key first
        let data = JSON.parse(localStorage.getItem('redd-todo-data'));

        // Fallback to old key for migration (if we are in the same storage context)
        if (!data) {
            data = JSON.parse(localStorage.getItem('redd-task-data'));
            if (data) {
                // Migrate to new key
                localStorage.setItem('redd-todo-data', JSON.stringify(data));
                // Optional: localStorage.removeItem('redd-task-data');
            }
        }

        if (data) {
            tabs = data.tabs || {};
            currentTabId = data.currentTabId || null;
            taskCounter = data.taskCounter || 0;
            basecampConfig = data.basecampConfig || {
                accountId: null,
                accessToken: null,
                refreshToken: null,
                clientId: null,
                clientSecret: null,
                email: null,
                isConnected: false
            };

            // Load Reminders Config
            remindersConfig = data.remindersConfig || {
                isConnected: false
            };

            isDoneCollapsed = data.isDoneCollapsed || false;
            doneMaxHeight = data.doneMaxHeight !== undefined && data.doneMaxHeight !== null ? data.doneMaxHeight : 140;
            groups = data.groups || {};
            currentGroupId = data.currentGroupId || null;
            enableGroups = data.enableGroups !== undefined ? data.enableGroups : (Object.keys(groups).length > 0); // Default to true if groups exist, else false
            enablePlan = data.enablePlan !== undefined ? data.enablePlan : false; // Default to false
            favouritesOrder = data.favouritesOrder || [];
        }
    } catch (e) {
        console.error('Failed to load data:', e);
    }
}

// New function to fetch identity/accounts
async function fetchBasecampIdentity() {
    try {

        // Use Tauri HTTP client if available (bypasses CORS)
        const fetchFn = (reddIsTauri && typeof tauriAPI !== 'undefined' && tauriAPI.fetch)
            ? tauriAPI.fetch.bind(tauriAPI)
            : fetch;

        const response = await fetchFn('https://launchpad.37signals.com/authorization.json', {
            headers: {
                'Authorization': `Bearer ${basecampConfig.accessToken}`
            }
        });



        if (!response.ok) throw new Error('Failed to fetch identity');

        const data = await response.json();

        const accounts = data.accounts;

        if (accounts && accounts.length > 0) {
            // For now, default to the first account. 
            // Ideally we'd let the user choose if > 1, but this is a good start.
            const account = accounts[0];
            basecampConfig.accountId = account.id;
            basecampConfig.email = data.identity.email_address;
            console.log(`[Basecamp] Connected to account: ${account.name} (${account.id})`);
        } else {
            throw new Error('No Basecamp accounts found for this user.');
        }
    } catch (e) {
        console.error('[Basecamp] Identity Error:', e);
        alert('Could not fetch Basecamp account details. Please try again.');
    }
}

// Basecamp API Logic
function updateBasecampUI() {
    if (basecampConfig.isConnected) {
        bcConnectionStatus.classList.remove('hidden');
        bcLoginForm.classList.add('hidden');
        disconnectBcBtn.classList.remove('hidden');

        // Hide the main OAuth button row when connected
        const bcConnectRow = document.getElementById('basecamp-connect-row');
        if (bcConnectRow) bcConnectRow.classList.add('hidden');

        // Show account info if available
        if (bcAccountInfo && basecampConfig.accountId) {
            bcAccountInfo.textContent = `Account ID: ${basecampConfig.accountId} ${basecampConfig.email ? `(${basecampConfig.email})` : ''}`;
        }

        // Fill hidden inputs (legacy support)
        bcAccountIdInput.value = basecampConfig.accountId || '';
        bcAccessTokenInput.value = basecampConfig.accessToken || '';
        bcRefreshTokenInput.value = basecampConfig.refreshToken || '';
        bcClientIdInput.value = basecampConfig.clientId || '';
        bcClientSecretInput.value = basecampConfig.clientSecret || '';
        bcEmailInput.value = basecampConfig.email || '';
    } else {
        bcConnectionStatus.classList.add('hidden');
        bcLoginForm.classList.remove('hidden');
        disconnectBcBtn.classList.add('hidden');

        // Show the main OAuth button row when disconnected
        const bcConnectRow = document.getElementById('basecamp-connect-row');
        if (bcConnectRow) bcConnectRow.classList.remove('hidden');

        bcAccountIdInput.value = '';
        bcAccessTokenInput.value = '';
        bcRefreshTokenInput.value = '';
        bcClientIdInput.value = '';
        bcClientSecretInput.value = '';
        bcEmailInput.value = '';
    }
}

let basecampRefreshPromise = null;

async function refreshBasecampToken() {
    if (basecampRefreshPromise) {
        return basecampRefreshPromise;
    }

    basecampRefreshPromise = (async () => {
    if (!basecampConfig.refreshToken) {
        console.warn('Cannot refresh token: Missing refresh token.');
        return false;
    }

    try {
        const fetchFn = (reddIsTauri && typeof tauriAPI !== 'undefined' && tauriAPI.fetch)
            ? tauriAPI.fetch.bind(tauriAPI)
            : fetch;

        // Use Netlify function to refresh token (keeps client_secret server-side)
        const response = await fetchFn('https://redd-todo.netlify.app/.netlify/functions/auth', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                refresh_token: basecampConfig.refreshToken
            })
        });

        if (!response.ok) {
            console.error(`Token refresh failed: ${response.status} ${response.statusText}`);
            return false;
        }

        const data = await response.json();
        if (data.access_token) {
            basecampConfig.accessToken = data.access_token;
            // Update refresh token if provided (rare but possible)
            if (data.refresh_token) {
                basecampConfig.refreshToken = data.refresh_token;
            }
            saveData();
            updateBasecampUI();
            console.log('Basecamp token refreshed successfully via Netlify.');
            return true;
        }
    } catch (e) {
        console.error('Error refreshing Basecamp token:', e);
    }
    return false;
    })();

    try {
        return await basecampRefreshPromise;
    } finally {
        basecampRefreshPromise = null;
    }
}

async function basecampFetch(url, options = {}) {
    // Ensure headers exist
    if (!options.headers) options.headers = {};

    // Add Authorization header
    options.headers['Authorization'] = `Bearer ${basecampConfig.accessToken}`;

    // Use Tauri HTTP client if available (bypasses CORS)
    const fetchFn = (reddIsTauri && typeof tauriAPI !== 'undefined' && tauriAPI.fetch)
        ? tauriAPI.fetch.bind(tauriAPI)
        : fetch;

    // First attempt
    let response = await fetchFn(url, options);

    // If 401, try to refresh
    if (response.status === 401) {
        console.log('Received 401 from Basecamp. Attempting to refresh token...');
        const refreshed = await refreshBasecampToken();

        if (refreshed) {
            // Update header with new token
            options.headers['Authorization'] = `Bearer ${basecampConfig.accessToken}`;
            // Retry request
            response = await fetchFn(url, options);
        } else {
            console.error('Failed to refresh token or no refresh credentials available.');
        }
    }

    return response;
}

async function checkProjectAccess(projectId, email) {
    try {
        const response = await basecampFetch(`https://3.basecampapi.com/${basecampConfig.accountId}/projects/${projectId}/people.json`, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) return false;
        const people = await response.json();
        return people.some(p => p.email_address && p.email_address.toLowerCase() === email.toLowerCase());
    } catch (e) {
        console.error(`Error checking access for project ${projectId}:`, e);
        return false;
    }
}

async function fetchBasecampProjects() {
    if (!basecampConfig.isConnected) return [];
    try {
        // Basecamp 3 API: GET /projects.json
        const response = await basecampFetch(`https://3.basecampapi.com/${basecampConfig.accountId}/projects.json`, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error('Failed to fetch projects');
        let projects = await response.json();

        // Filter by email if provided
        if (basecampConfig.email && basecampConfig.email.trim()) {
            const email = basecampConfig.email.trim();

            // Check access for all projects in parallel
            // Note: This might hit rate limits if there are many projects
            const accessResults = await Promise.all(
                projects.map(async (p) => {
                    const hasAccess = await checkProjectAccess(p.id, email);
                    return hasAccess ? p : null;
                })
            );
            projects = accessResults.filter(p => p !== null);
        }

        return projects;
    } catch (e) {
        console.error('Basecamp Error:', e);
        return [];
    }
}

async function getBasecampTodoLists(projectId) {
    try {
        // 1. Get the "todoset" (dock) for the project
        const projectResp = await basecampFetch(`https://3.basecampapi.com/${basecampConfig.accountId}/projects/${projectId}.json`);
        const projectData = await projectResp.json();

        const todoset = projectData.dock.find(d => d.name === 'todoset');
        if (!todoset) return [];

        // 2. Get the todolists in that set
        // In BC3, we need to follow the url to get the set details which contains 'todolists_url'
        // Actually: GET /buckets/1/todosets/1/todolists.json is the pattern
        const realListsUrl = todoset.url.replace('.json', '/todolists.json');

        const finalListsResp = await basecampFetch(realListsUrl);
        const finalLists = await finalListsResp.json();

        return finalLists;
    } catch (e) {
        console.error('Basecamp Lists Error:', e);
        return [];
    }
}

async function fetchBasecampTodoLists(projectId) {
    const lists = await getBasecampTodoLists(projectId);

    // Populate select
    bcListSelect.innerHTML = '<option value="">Select a list...</option>';

    lists.forEach(list => {
        const opt = document.createElement('option');
        opt.value = list.id;
        opt.textContent = list.name;
        bcListSelect.appendChild(opt);
    });
}

async function syncBasecampList(tabId) {
    const tab = tabs[tabId];
    if (!tab || !tab.basecampListId || !basecampConfig.isConnected) return;

    try {
        // Fetch both active (default) and completed todos
        const baseUrl = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todolists/${tab.basecampListId}/todos.json`;

        const [activeResp, completedResp] = await Promise.all([
            basecampFetch(baseUrl),
            basecampFetch(`${baseUrl}?completed=true`)
        ]);

        const activeTodos = await activeResp.json();
        const completedTodos = await completedResp.json();
        const remoteTodos = [
            ...(Array.isArray(activeTodos) ? activeTodos : []),
            ...(Array.isArray(completedTodos) ? completedTodos : [])
        ];

        // Merge logic: 
        // 1. Add new remote todos to local
        // 2. Update status of linked todos

        let changes = false;
        const remoteIds = new Set();

        remoteTodos.forEach(remote => {
            remoteIds.add(remote.id);
            const localTask = tab.tasks.find(t => t.basecampId === remote.id);

            if (localTask) {
                // Timestamp-based conflict resolution for completion status
                if (localTask.completed !== remote.completed) {
                    // Use statusChangedAt for local (tracks any status change), fallback to completedAt
                    const localTime = localTask.statusChangedAt ? new Date(localTask.statusChangedAt).getTime() :
                        (localTask.completedAt ? new Date(localTask.completedAt).getTime() : 0);
                    // Basecamp: use updated_at for any change, or completion.created_at for completion
                    const remoteCompletedAt = remote.completion?.created_at;
                    const remoteTime = remote.updated_at ? new Date(remote.updated_at).getTime() :
                        (remoteCompletedAt ? new Date(remoteCompletedAt).getTime() : 0);

                    // Debug logging
                    console.log('Basecamp sync conflict for:', localTask.text);
                    console.log('  Local:', localTask.completed, 'statusChangedAt:', localTask.statusChangedAt, 'time:', localTime);
                    console.log('  Remote:', remote.completed, 'updated_at:', remote.updated_at, 'time:', remoteTime);

                    // Determine which one wins based on timestamps
                    let useRemote = false;

                    if (localTime > 0 && remoteTime > 0) {
                        // Both have timestamps - most recent wins
                        useRemote = remoteTime > localTime;
                    } else if (remoteTime > 0 && localTime === 0) {
                        // Remote has timestamp, local doesn't - remote wins
                        // (remote was actively completed at a known time)
                        useRemote = true;
                    } else if (localTime > 0 && remoteTime === 0) {
                        // Local has timestamp, remote doesn't - local wins
                        useRemote = false;
                    } else {
                        // Neither has timestamps - prefer completed state to avoid losing work
                        useRemote = remote.completed && !localTask.completed;
                    }

                    console.log('  Decision: useRemote =', useRemote);

                    if (useRemote) {
                        localTask.completed = remote.completed;
                        localTask.completedAt = remoteCompletedAt || null;
                        localTask.statusChangedAt = remote.updated_at || remoteCompletedAt || null;
                        changes = true;
                    } else {
                        updateBasecampCompletion(tabId, localTask);
                    }
                }
                // Update text if remote changed
                if (localTask.text !== remote.content) {
                    localTask.text = remote.content;
                    changes = true;
                }

                // Timestamp-based conflict resolution for notes/description
                // Normalize notes for comparison (empty string, null, undefined are all "no notes")
                const localNotes = localTask.notes || '';
                const remoteDescription = remote.description || '';

                if (localNotes !== remoteDescription) {
                    // Use notesChangedAt for local, updated_at for remote
                    const localNotesTime = localTask.notesChangedAt ? new Date(localTask.notesChangedAt).getTime() : 0;
                    const remoteTime = remote.updated_at ? new Date(remote.updated_at).getTime() : 0;

                    // Debug logging
                    console.log('Basecamp notes sync conflict for:', localTask.text);
                    console.log('  Local notes:', localNotes.substring(0, 50), 'notesChangedAt:', localTask.notesChangedAt, 'time:', localNotesTime);
                    console.log('  Remote description:', remoteDescription.substring(0, 50), 'updated_at:', remote.updated_at, 'time:', remoteTime);

                    let useRemoteNotes = false;

                    if (localNotesTime > 0 && remoteTime > 0) {
                        // Both have timestamps - most recent wins
                        useRemoteNotes = remoteTime > localNotesTime;
                    } else if (remoteTime > 0 && localNotesTime === 0) {
                        // Remote has timestamp, local doesn't - remote wins
                        useRemoteNotes = true;
                    } else if (localNotesTime > 0 && remoteTime === 0) {
                        // Local has timestamp, remote doesn't - local wins
                        useRemoteNotes = false;
                    } else {
                        // Neither has timestamps - prefer having content to avoid losing work
                        useRemoteNotes = remoteDescription && !localNotes;
                    }

                    console.log('  Decision: useRemoteNotes =', useRemoteNotes);

                    if (useRemoteNotes) {
                        localTask.notes = remoteDescription;
                        localTask.notesChangedAt = remote.updated_at || null;
                        changes = true;
                    } else if (localNotes) {
                        // Push local notes to Basecamp as description
                        updateBasecampTodoDescription(tabId, localTask);
                    }
                }
            } else {
                // New task from remote
                tab.tasks.push({
                    id: `task_${++taskCounter}`,
                    text: remote.content,
                    completed: remote.completed,
                    completedAt: remote.completion?.created_at || null,
                    statusChangedAt: remote.updated_at || remote.completion?.created_at || null,
                    createdAt: remote.created_at,
                    expectedDuration: null,
                    actualDuration: null,
                    basecampId: remote.id,
                    notes: remote.description || null,
                    notesChangedAt: remote.description ? (remote.updated_at || null) : null
                });
                changes = true;
            }
        });

        // 3. Remove local tasks that are linked to Basecamp but no longer exist remotely
        const initialCount = tab.tasks.length;
        tab.tasks = tab.tasks.filter(t => !t.basecampId || remoteIds.has(t.basecampId));

        if (tab.tasks.length !== initialCount) {
            changes = true;
        }

        // 4. Push local tasks without basecampId to Basecamp (created offline)
        for (const task of tab.tasks) {
            if (!task.basecampId) {
                await createBasecampTodo(tabId, task);
                // If task is completed, update remote status
                if (task.completed) {
                    updateBasecampCompletion(tabId, task);
                }
                changes = true;
            }
        }

        if (changes) {
            renderTasks();
            saveData();
        }
    } catch (e) {
        console.error('Sync Error:', e);
        alert('Failed to sync with Basecamp. Check your connection.');
    }
}

async function updateBasecampCompletion(tabId, task) {
    const tab = tabs[tabId];
    if (!tab || !task.basecampId) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todos/${task.basecampId}/completion.json`;

        const method = task.completed ? 'POST' : 'DELETE';

        await basecampFetch(url, {
            method: method
        });
    } catch (e) {
        console.error('Update BC Error:', e);
    }
}

async function updateBasecampTodoText(tabId, task) {
    const tab = tabs[tabId];
    if (!tab || !task.basecampId) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todos/${task.basecampId}.json`;

        await basecampFetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: task.text })
        });
    } catch (e) {
        console.error('Update BC Text Error:', e);
    }
}

async function updateBasecampTodoDescription(tabId, task) {
    const tab = tabs[tabId];
    if (!tab || !task.basecampId) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todos/${task.basecampId}.json`;

        console.log('Pushing notes to Basecamp:', task.text, 'description:', task.notes);

        // Basecamp API requires content field when updating - include both content and description
        const response = await basecampFetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: task.text,
                description: task.notes || ''
            })
        });

        console.log('Basecamp description update response:', response.status, response.ok);
    } catch (e) {
        console.error('Update BC Description Error:', e);
    }
}

async function deleteBasecampTodo(tabId, basecampId) {
    const tab = tabs[tabId];
    if (!tab || !tab.basecampProjectId || !basecampConfig.isConnected) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todos/${basecampId}.json`;

        await basecampFetch(url, {
            method: 'DELETE'
        });
    } catch (e) {
        console.error('Delete BC Error:', e);
    }
}

async function createBasecampTodo(tabId, task) {
    const tab = tabs[tabId];
    if (!tab || !tab.basecampListId) return;

    try {
        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${tab.basecampProjectId}/todolists/${tab.basecampListId}/todos.json`;

        // Build request body with content and optional description (notes)
        const body = { content: task.text };
        if (task.notes) {
            body.description = task.notes;
        }

        const response = await basecampFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();

        // Link local task to remote ID
        task.basecampId = data.id;
        saveData();
    } catch (e) {
        console.error('Create BC Error:', e);
    }
}

// Move a Basecamp todo to a different list (possibly in a different project)
async function moveBasecampTodo(task, sourceTab, targetTab) {
    if (!task.basecampId) {
        console.warn('moveBasecampTodo: No basecampId on task');
        return;
    }
    if (!basecampConfig.isConnected || !basecampConfig.accessToken) {
        console.warn('moveBasecampTodo: Not connected to Basecamp');
        return;
    }

    try {
        // Basecamp 3 API: To move a recording to a different parent, use PUT on the recordings/parent endpoint
        // PUT /buckets/{bucket_id}/recordings/{recording_id}/parent.json
        // Body: { "parent": { "id": target_todolist_id, "type": "Todolist" } }
        // If moving to a different project, also include "bucket_id" in the parent object

        const sourceBucketId = sourceTab.basecampProjectId;
        const targetBucketId = targetTab.basecampProjectId;
        const targetListId = targetTab.basecampListId;

        console.log('Attempting Basecamp move via parent endpoint...');
        console.log('  Source bucket:', sourceBucketId, 'Target bucket:', targetBucketId);
        console.log('  Target list:', targetListId, 'Todo ID:', task.basecampId);

        const url = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${sourceBucketId}/recordings/${task.basecampId}/parent.json`;

        const parentData = {
            parent: {
                id: parseInt(targetListId),
                type: "Todolist"
            }
        };

        // If moving to a different project, include bucket_id
        if (sourceBucketId !== targetBucketId) {
            parentData.parent.bucket_id = parseInt(targetBucketId);
        }

        const response = await basecampFetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(parentData)
        });

        if (response.ok) {
            console.log('✓ Successfully moved Basecamp todo to new list');
        } else {
            // Log the error response for debugging
            const errorText = await response.text();
            console.warn('Move endpoint failed with status:', response.status, errorText);
            console.log('Falling back to copy+delete...');
            await fallbackMoveBasecampTodo(task, sourceTab, targetTab);
        }
    } catch (e) {
        console.error('Move BC Error:', e);
        // Fall back to copy+delete on error
        console.log('Falling back to copy+delete due to error...');
        await fallbackMoveBasecampTodo(task, sourceTab, targetTab);
    }
}

// Fallback: Create in new list, then delete from old (creates archived copy but at least works)
async function fallbackMoveBasecampTodo(task, sourceTab, targetTab) {
    try {
        const oldBasecampId = task.basecampId;
        console.log('Fallback move: Creating todo in target list...');

        // Create in new list
        const createUrl = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${targetTab.basecampProjectId}/todolists/${targetTab.basecampListId}/todos.json`;
        const createResponse = await basecampFetch(createUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: task.text })
        });

        if (createResponse.ok) {
            const data = await createResponse.json();
            task.basecampId = data.id;
            console.log('✓ Created new todo with ID:', task.basecampId);

            // If the task was completed, mark the new one as completed too
            if (task.completed) {
                console.log('Marking new todo as completed...');
                const completeUrl = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${targetTab.basecampProjectId}/todos/${task.basecampId}/completion.json`;
                await basecampFetch(completeUrl, { method: 'POST' });
            }

            // Delete the old one (this will archive it in Basecamp)
            console.log('Deleting old todo:', oldBasecampId);
            const deleteUrl = `https://3.basecampapi.com/${basecampConfig.accountId}/buckets/${sourceTab.basecampProjectId}/todos/${oldBasecampId}.json`;
            const deleteResponse = await basecampFetch(deleteUrl, { method: 'DELETE' });

            if (deleteResponse.ok) {
                console.log('✓ Fallback move completed successfully');
            } else {
                console.warn('Delete returned status:', deleteResponse.status);
            }

            saveData();
        } else {
            const errorText = await createResponse.text();
            console.error('Failed to create todo in target list:', createResponse.status, errorText);
            // Don't clear basecampId - keep the old one so the task stays linked to source
        }
    } catch (e) {
        console.error('Fallback move BC Error:', e);
        // Don't clear basecampId on error - leave it linked to old location
    }
}

// Reminders Logic

function updateRemindersUI() {
    const connectRow = document.getElementById('reminders-connect-row');

    if (remindersConfig.isConnected) {
        remindersStatus.classList.remove('hidden');
        if (connectRow) connectRow.classList.add('hidden');
        if (disconnectRemindersBtn) disconnectRemindersBtn.classList.remove('hidden');
    } else {
        remindersStatus.classList.add('hidden');
        if (connectRow) connectRow.classList.remove('hidden');
        if (disconnectRemindersBtn) disconnectRemindersBtn.classList.add('hidden');
    }
}

async function fetchRemindersLists() {
    try {
        const lists = await reddIpc.invoke('fetch-reminders-lists');
        if (!Array.isArray(lists)) {
            console.warn('[Reminders] fetchRemindersLists expected array but got:', lists);
            return [];
        }
        return lists;
    } catch (e) {
        console.error('Failed to fetch Reminders lists:', e);
        return [];
    }
}

async function syncRemindersList(tabId) {
    const tab = tabs[tabId];
    if (!tab || !tab.remindersListId || !remindersConfig.isConnected) return;

    try {
        const remoteTasks = await reddIpc.invoke('fetch-reminders-tasks', tab.remindersListId);
        if (!remoteTasks) return;

        let changes = false;

        // 1. Update/Add tasks from Reminders
        const remoteIds = new Set();
        remoteTasks.forEach(rTask => {
            remoteIds.add(rTask.id);
            const existingTask = tab.tasks.find(t => t.remindersId === rTask.id);

            if (existingTask) {
                // Timestamp-based conflict resolution for completion status
                if (existingTask.completed !== rTask.completed) {
                    // Use statusChangedAt for local (tracks any status change)
                    // Use lastModifiedDate for remote (tracks any modification including un-completing)
                    const localTime = existingTask.statusChangedAt ? new Date(existingTask.statusChangedAt).getTime() :
                        (existingTask.completedAt ? new Date(existingTask.completedAt).getTime() : 0);
                    // lastModifiedDate is Unix timestamp in seconds, convert to ms
                    const remoteTime = rTask.lastModifiedDate ? rTask.lastModifiedDate * 1000 : 0;

                    // Debug logging
                    console.log('Reminders sync conflict for:', existingTask.text);
                    console.log('  Local:', existingTask.completed, 'statusChangedAt:', existingTask.statusChangedAt, 'time:', localTime);
                    console.log('  Remote:', rTask.completed, 'lastModifiedDate:', rTask.lastModifiedDate, 'time:', remoteTime);

                    // Determine which one wins based on timestamps
                    let useRemote = false;

                    if (localTime > 0 && remoteTime > 0) {
                        // Both have timestamps - most recent wins
                        useRemote = remoteTime > localTime;
                    } else if (remoteTime > 0 && localTime === 0) {
                        // Remote has timestamp, local doesn't - remote wins
                        useRemote = true;
                    } else if (localTime > 0 && remoteTime === 0) {
                        // Local has timestamp, remote doesn't - local wins
                        useRemote = false;
                    } else {
                        // Neither has timestamps - prefer completed state to avoid losing work
                        useRemote = rTask.completed && !existingTask.completed;
                    }

                    console.log('  Decision: useRemote =', useRemote);

                    if (useRemote) {
                        existingTask.completed = rTask.completed;
                        existingTask.completedAt = rTask.completionDate ? new Date(rTask.completionDate * 1000).toISOString() : null;
                        existingTask.statusChangedAt = rTask.lastModifiedDate ? new Date(rTask.lastModifiedDate * 1000).toISOString() : null;
                        changes = true;
                    } else {
                        updateRemindersCompletion(existingTask.remindersId, existingTask.completed);
                    }
                }
                // Update text if changed remotely
                if (existingTask.text !== rTask.name) {
                    existingTask.text = rTask.name;
                    changes = true;
                }

                // Timestamp-based conflict resolution for notes
                // Normalize notes for comparison (empty string, null, undefined are all "no notes")
                const localNotes = existingTask.notes || '';
                const remoteNotes = rTask.notes || '';

                // Extract plain text from local notes for comparison (local may have HTML from Quill)
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = localNotes;
                const localPlainText = (tempDiv.textContent || tempDiv.innerText || '').trim();
                const remotePlainText = remoteNotes.trim();

                // Only consider it a conflict if the plain text content actually differs
                // This preserves local HTML formatting when we push to Reminders and it comes back as plain text
                if (localPlainText !== remotePlainText) {
                    // Use notesChangedAt for local, lastModifiedDate for remote
                    const localNotesTime = existingTask.notesChangedAt ? new Date(existingTask.notesChangedAt).getTime() : 0;
                    const remoteTime = rTask.lastModifiedDate ? rTask.lastModifiedDate * 1000 : 0;

                    // Debug logging
                    console.log('Reminders notes sync conflict for:', existingTask.text);
                    console.log('  Local plain text:', localPlainText.substring(0, 50), 'notesChangedAt:', existingTask.notesChangedAt, 'time:', localNotesTime);
                    console.log('  Remote plain text:', remotePlainText.substring(0, 50), 'lastModifiedDate:', rTask.lastModifiedDate, 'time:', remoteTime);

                    let useRemoteNotes = false;

                    if (localNotesTime > 0 && remoteTime > 0) {
                        // Both have timestamps - most recent wins
                        useRemoteNotes = remoteTime > localNotesTime;
                    } else if (remoteTime > 0 && localNotesTime === 0) {
                        // Remote has timestamp, local doesn't - remote wins
                        useRemoteNotes = true;
                    } else if (localNotesTime > 0 && remoteTime === 0) {
                        // Local has timestamp, remote doesn't - local wins
                        useRemoteNotes = false;
                    } else {
                        // Neither has timestamps - prefer having content to avoid losing work
                        useRemoteNotes = remotePlainText && !localPlainText;
                    }

                    console.log('  Decision: useRemoteNotes =', useRemoteNotes);

                    if (useRemoteNotes) {
                        existingTask.notes = remoteNotes;
                        existingTask.notesChangedAt = rTask.lastModifiedDate ? new Date(rTask.lastModifiedDate * 1000).toISOString() : null;
                        changes = true;
                    } else if (localNotes) {
                        // Push local notes to remote
                        updateRemindersNotes(existingTask.remindersId, localNotes);
                    }
                }
            } else {
                // Add new task
                // Only add if not completed, or if we want to sync completed too?
                // Let's import all
                tab.tasks.push({
                    id: `task_${++taskCounter}`,
                    text: rTask.name,
                    completed: rTask.completed,
                    completedAt: rTask.completionDate ? new Date(rTask.completionDate * 1000).toISOString() : null,
                    statusChangedAt: rTask.lastModifiedDate ? new Date(rTask.lastModifiedDate * 1000).toISOString() : null,
                    createdAt: new Date().toISOString(),
                    expectedDuration: null,
                    actualDuration: null,
                    basecampId: null,
                    remindersId: rTask.id,
                    notes: rTask.notes || null,
                    notesChangedAt: rTask.notes ? (rTask.lastModifiedDate ? new Date(rTask.lastModifiedDate * 1000).toISOString() : null) : null
                });
                changes = true;
            }
        });

        // 2. Remove local tasks that are linked to Reminders but no longer exist remotely
        const initialCount = tab.tasks.length;
        tab.tasks = tab.tasks.filter(t => !t.remindersId || remoteIds.has(t.remindersId));

        if (tab.tasks.length !== initialCount) {
            changes = true;
        }

        // 3. Push local tasks without remindersId to Reminders (created offline)
        for (const task of tab.tasks) {
            if (!task.remindersId) {
                const newId = await createRemindersTask(tab.remindersListId, task.text);
                if (newId) {
                    task.remindersId = newId;
                    // If task is completed, update remote status
                    if (task.completed) {
                        updateRemindersCompletion(newId, true);
                    }
                    // If task has notes, push them to Reminders
                    if (task.notes) {
                        updateRemindersNotes(newId, task.notes);
                    }
                    changes = true;
                }
            }
        }

        if (changes) {
            renderTasks();
            saveData();
        }

    } catch (e) {
        console.error('Sync Reminders Error:', e);
    }
}

async function updateRemindersCompletion(remindersId, completed) {
    try {
        await reddIpc.invoke('update-reminders-status', remindersId, completed);
    } catch (e) {
        console.error('Failed to update Reminder status:', e);
    }
}

async function updateRemindersTitle(remindersId, title) {
    try {
        await reddIpc.invoke('update-reminders-title', remindersId, title);
    } catch (e) {
        console.error('Failed to update Reminder title:', e);
    }
}

async function updateRemindersNotes(remindersId, notes) {
    try {
        // Convert HTML to readable plain text since Apple Reminders only supports plain text
        const plainText = htmlToPlainText(notes || '');
        await reddIpc.invoke('update-reminders-notes', remindersId, plainText);
    } catch (e) {
        console.error('Failed to update Reminder notes:', e);
    }
}

// Convert Quill HTML to readable plain text
function htmlToPlainText(html) {
    if (!html) return '';

    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Process ordered lists - add numbers
    temp.querySelectorAll('ol').forEach(ol => {
        const items = ol.querySelectorAll('li');
        items.forEach((li, index) => {
            li.textContent = `${index + 1}. ${li.textContent}`;
        });
    });

    // Process unordered lists - add bullets
    temp.querySelectorAll('ul').forEach(ul => {
        ul.querySelectorAll('li').forEach(li => {
            li.textContent = `• ${li.textContent}`;
        });
    });

    // Add line breaks after block elements
    temp.querySelectorAll('p, li, div, br, h1, h2, h3, h4, h5, h6').forEach(el => {
        if (el.tagName === 'BR') {
            el.replaceWith('\n');
        } else {
            el.appendChild(document.createTextNode('\n'));
        }
    });

    // Get text content and clean up
    let text = temp.textContent || temp.innerText || '';

    // Normalize multiple newlines to double newline (paragraph break)
    text = text.replace(/\n{3,}/g, '\n\n');

    // Trim whitespace
    text = text.trim();

    return text;
}

async function createRemindersTask(listId, title) {
    try {
        const result = await reddIpc.invoke('create-reminders-task', listId, title);
        return result?.id;
    } catch (e) {
        console.error('Failed to create Reminder:', e);
        return null;
    }
}

async function deleteRemindersTask(remindersId) {
    try {
        await reddIpc.invoke('delete-reminders-task', remindersId);
    } catch (e) {
        console.error('Failed to delete Reminder:', e);
    }
}

// Data Management
// Plan mode storage prefix (must match plan.js)
const PLAN_STORAGE_PREFIX = 'redd-do-plan-';

function safeParseStorageValue(rawValue) {
    if (rawValue == null) return null;
    try {
        return JSON.parse(rawValue);
    } catch {
        return rawValue;
    }
}

function collectPlanDataForBackup() {
    const planData = {};
    for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i);
        if (!fullKey || !fullKey.startsWith(PLAN_STORAGE_PREFIX)) continue;
        const shortKey = fullKey.slice(PLAN_STORAGE_PREFIX.length);
        planData[shortKey] = safeParseStorageValue(localStorage.getItem(fullKey));
    }
    return planData;
}

function clearAllPlanStorage() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PLAN_STORAGE_PREFIX)) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
}

function collectUiPrefsForBackup() {
    return {
        theme: localStorage.getItem('theme') || 'system',
        language: localStorage.getItem('language') || 'en',
        // Keep current view preference even if key does not exist yet.
        currentView: localStorage.getItem('currentView') || currentView || 'lists'
    };
}

function restoreUiPrefsFromBackup(uiPrefs) {
    if (!uiPrefs || typeof uiPrefs !== 'object') return;

    if (typeof uiPrefs.theme === 'string' && uiPrefs.theme.length > 0) {
        localStorage.setItem('theme', uiPrefs.theme);
    }
    if (typeof uiPrefs.language === 'string' && uiPrefs.language.length > 0) {
        localStorage.setItem('language', uiPrefs.language);
    }
    if (typeof uiPrefs.currentView === 'string' && uiPrefs.currentView.length > 0) {
        localStorage.setItem('currentView', uiPrefs.currentView);
    }
}

function exportData() {
    try {
        const todoData = localStorage.getItem('redd-todo-data');
        if (!todoData) {
            alert('No data to export!');
            return;
        }

        // Parse the main data
        const exportObj = JSON.parse(todoData);

        // Add all plan mode data (manual notes/lines/groups and calendar sync config).
        exportObj.planData = collectPlanDataForBackup();
        // Add UI preferences.
        exportObj.uiPrefs = collectUiPrefsForBackup();

        const blob = new Blob([JSON.stringify(exportObj)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        // Format date: YYYY-MM-DD
        const date = new Date().toISOString().split('T')[0];
        a.download = `redd-do-backup-${date}.json`;
        a.href = url;
        a.click();

        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Export failed:', e);
        alert('Failed to export data.');
    }
}

function importData(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const content = e.target.result;
            const data = JSON.parse(content);

            // Simple validation: check if it looks like our data structure
            // Just checking if 'tabs' exists is a decent heuristic for now
            if (!data.tabs) {
                throw new Error('Invalid backup file format.');
            }

            const confirmRestore = await showConfirmModal(
                'Restore Backup',
                'This will overwrite all your current data with the backup.\n\nAre you sure you want to proceed?',
                'Restore',
                'Cancel'
            );

            if (confirmRestore) {
                // Extract plan data before saving main data
                const planData = data.planData;
                const uiPrefs = data.uiPrefs;
                delete data.planData; // Remove from main data object
                delete data.uiPrefs; // Remove from main data object

                // Save main to-do data to localStorage
                localStorage.setItem('redd-todo-data', JSON.stringify(data));

                // Clear old key too just in case to avoid confusion
                localStorage.removeItem('redd-task-data');

                // Restore plan mode data if present
                clearAllPlanStorage();
                if (planData) {
                    Object.keys(planData).forEach(shortKey => {
                        const fullKey = PLAN_STORAGE_PREFIX + shortKey;
                        const value = planData[shortKey];
                        localStorage.setItem(
                            fullKey,
                            typeof value === 'string' ? value : JSON.stringify(value)
                        );
                    });
                }

                // Restore UI preferences if present
                restoreUiPrefsFromBackup(uiPrefs);

                alert('Backup restored successfully! The app will now reload.');
                window.location.reload();
            } else {
                // Reset file input so same file can be selected again if needed
                document.getElementById('import-file-input').value = '';
            }

        } catch (err) {
            console.error('Import failed:', err);
            alert('Failed to import data: ' + err.message);
            document.getElementById('import-file-input').value = '';
        }
    };
    reader.readAsText(file);
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initApp();

    // Data Management Listeners
    const exportBtn = document.getElementById('export-data-btn');
    const importBtn = document.getElementById('import-data-btn');
    const fileInput = document.getElementById('import-file-input');

    if (exportBtn) {
        exportBtn.addEventListener('click', exportData);
    }

    if (importBtn) {
        importBtn.addEventListener('click', () => {
            if (fileInput) fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importData(e.target.files[0]);
            }
        });
    }
});

// Close task menus when clicking outside
document.addEventListener('click', (e) => {
    // If click is not on a menu button or inside a menu, close all menus
    if (!e.target.closest('.task-menu-btn') && !e.target.closest('.task-menu')) {
        document.querySelectorAll('.task-menu:not(.hidden)').forEach(menu => {
            menu.classList.add('hidden');
            const parentTask = menu.closest('.task-item');
            if (parentTask) parentTask.classList.remove('has-open-menu');
        });
    }
});
