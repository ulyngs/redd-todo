// ReDD Plan - Danish 6-Month Calendar App
// Main application logic (PWA version)

// State
let currentYear = new Date().getFullYear();
let currentHalf = new Date().getMonth() < 6 ? 1 : 2;
let currentLanguage = 'en'; // 'da' or 'en'
let freeformNotes = []; // Array of {id, text, html, x, y, year, half, snapToDate, group}
let freeformLines = []; // Array of {id, x1, y1, x2, y2, year, half, color, width, group}
let groups = []; // Array of {id, name, color, visible}
let activeGroup = 'personal'; // Currently selected group for new items

// Editor/Selection State
let selectedElement = null; // { type: 'note'|'line', id: string, element: HTMLElement }
let lastDeletedItem = null; // { type: 'note'|'line', data: object }
let undoTimeout = null;

// Undo/Redo History
let undoStack = []; // Array of state snapshots
let redoStack = []; // Array of state snapshots
const MAX_HISTORY = 50; // Maximum number of undo steps

// Danish month names
const MONTHS_DA = [
    'Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'December'
];

// Danish weekday abbreviations (Monday = 0)
const WEEKDAYS_DA = ['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø'];

// English month names
const MONTHS_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// English weekday abbreviations (Monday = 0)
const WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// UI Text translations
const UI_TEXT = {
    da: {
        settings: 'Indstillinger',
        theme: 'Tema',
        language: 'Sprog',
        newItems: 'Nye elementer:',
        addGroup: 'Tilføj gruppe',
        renameGroup: 'Omdøb gruppe',
        deleteGroup: 'Slet gruppe',
        cannotDelete: 'Kan ikke slette',
        cannotDeleteLast: 'Du kan ikke slette den sidste gruppe.',
        deleteConfirm: 'Slet gruppe',
        deleteMessage: 'Elementer i denne gruppe flyttes til Personal.',
        add: 'Tilføj',
        rename: 'Omdøb',
        delete: 'Slet',
        cancel: 'Annuller',
        personal: 'Personligt',
        work: 'Arbejde',
        data: 'Data',
        exportData: 'Eksporter',
        importData: 'Importer',
        exportSuccess: 'Kalender eksporteret!',
        importSuccess: 'Kalender importeret!',
        importError: 'Kunne ikke importere fil'
    },
    en: {
        settings: 'Settings',
        theme: 'Theme',
        language: 'Language',
        newItems: 'New items:',
        addGroup: 'Add Group',
        renameGroup: 'Rename Group',
        deleteGroup: 'Delete Group',
        cannotDelete: 'Cannot Delete',
        cannotDeleteLast: 'You cannot delete the last group.',
        deleteConfirm: 'Delete Group',
        deleteMessage: 'Items in this group will be moved to Personal.',
        add: 'Add',
        rename: 'Rename',
        delete: 'Delete',
        cancel: 'Cancel',
        personal: 'Personal',
        work: 'Work',
        data: 'Data',
        exportData: 'Export',
        importData: 'Import',
        exportSuccess: 'Calendar exported!',
        importSuccess: 'Calendar imported!',
        importError: 'Could not import file'
    }
};

// Calculate Easter Sunday using the Anonymous Gregorian algorithm
function getEasterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
}

// Get Danish holidays for a given year
function getDanishHolidays(year) {
    const easter = getEasterSunday(year);
    const holidays = {};

    const addDays = (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };

    const formatKey = (date) => {
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${m}-${d}`;
    };

    if (currentLanguage === 'da') {
        // Danish mode - show all Danish holidays
        holidays[formatKey(addDays(easter, -7))] = 'Palmesøndag';
        holidays[formatKey(addDays(easter, -3))] = 'Skærtorsdag';
        holidays[formatKey(addDays(easter, -2))] = 'Langfredag';
        holidays[formatKey(easter)] = 'Påskedag';
        holidays[formatKey(addDays(easter, 1))] = '2. påskedag';
        holidays[formatKey(addDays(easter, 39))] = 'Kr. himmelfartsdag';
        holidays[formatKey(addDays(easter, 49))] = 'Pinsedag';
        holidays[formatKey(addDays(easter, 50))] = '2. pinsedag';
        holidays[`${year}-01-01`] = 'Nytårsdag';
        holidays[`${year}-06-05`] = 'Grundlovsdag';
        holidays[`${year}-12-24`] = 'Juleaften';
        holidays[`${year}-12-25`] = 'Juledag';
        holidays[`${year}-12-26`] = '2. Juledag';
    } else {
        // English mode - show only universal holidays
        holidays[formatKey(addDays(easter, -7))] = 'Palm Sunday';
        holidays[formatKey(addDays(easter, -3))] = 'Maundy Thursday';
        holidays[formatKey(addDays(easter, -2))] = 'Good Friday';
        holidays[formatKey(easter)] = 'Easter Sunday';
        holidays[formatKey(addDays(easter, 1))] = 'Easter Monday';
        holidays[`${year}-01-01`] = 'New Year\'s Day';
        holidays[`${year}-12-24`] = 'Christmas Eve';
        holidays[`${year}-12-25`] = 'Christmas Day';
    }

    return holidays;
}

// Cache holidays (invalidate on language change)
let cachedHolidaysYear = null;
let cachedHolidaysLang = null;
let cachedHolidays = {};

function getHolidays(year) {
    if (cachedHolidaysYear !== year || cachedHolidaysLang !== currentLanguage) {
        cachedHolidaysYear = year;
        cachedHolidaysLang = currentLanguage;
        cachedHolidays = getDanishHolidays(year);
    }
    return cachedHolidays;
}

// Find the closest date row's note-area and return snapped position
function findClosestDateRowPosition(xPosition, yPosition) {
    const calendarGrid = document.getElementById('calendar-grid');
    if (!calendarGrid) return { x: xPosition, y: yPosition };

    const dayRows = calendarGrid.querySelectorAll('.day-row');
    if (dayRows.length === 0) return { x: xPosition, y: yPosition };

    const canvasRect = canvasLayer.getBoundingClientRect();
    const containerScrollTop = calendarContainer.scrollTop;

    let closestRow = null;
    let closestNoteArea = null;
    let minDistance = Infinity;

    // Find closest row considering both X and Y using FULL ROW bounds
    dayRows.forEach(row => {
        const noteArea = row.querySelector('.note-area');
        if (!noteArea) return;

        const rowRect = row.getBoundingClientRect();

        // Use full row bounds for finding closest row (includes day abbrev/number)
        const rowLeft = rowRect.left - canvasRect.left;
        const rowRight = rowRect.right - canvasRect.left;
        const rowTextY = rowRect.top - canvasRect.top + containerScrollTop + 4;

        // Calculate X distance to the full row (0 if within the row)
        let xDistance = 0;
        if (xPosition < rowLeft) {
            xDistance = rowLeft - xPosition;
        } else if (xPosition > rowRight) {
            xDistance = xPosition - rowRight;
        }

        const yDistance = Math.abs(yPosition - rowTextY);

        // Combined distance (weight X more to allow column changes)
        const distance = xDistance * 0.5 + yDistance;

        if (distance < minDistance) {
            minDistance = distance;
            closestRow = row;
            closestNoteArea = noteArea;
        }
    });

    // Snap to the closest note-area
    let snappedX = xPosition;
    let snappedY = yPosition;

    if (closestRow && closestNoteArea) {
        const rowRect = closestRow.getBoundingClientRect();
        const noteAreaRect = closestNoteArea.getBoundingClientRect();

        snappedY = rowRect.top - canvasRect.top + containerScrollTop + 4;

        const noteAreaLeft = noteAreaRect.left - canvasRect.left;
        const noteAreaRight = noteAreaRect.right - canvasRect.left;

        // Snap X to be within the note area (with small padding)
        snappedX = Math.max(noteAreaLeft + 4, Math.min(xPosition, noteAreaRight - 20));
    }

    return { x: snappedX, y: snappedY };
}

// Legacy wrapper for Y-only snapping
function findClosestDateRowY(yPosition) {
    const result = findClosestDateRowPosition(0, yPosition);
    return result.y;
}

// Storage keys
const NOTES_KEY = 'redd-map-freeform-notes';
const LINES_KEY = 'redd-map-freeform-lines';
const THEME_KEY = 'redd-map-theme';
const LANGUAGE_KEY = 'redd-map-language';
const GROUPS_KEY = 'redd-map-groups';
const ACTIVE_GROUP_KEY = 'redd-map-active-group';

// Default groups (use translationKey for built-in groups)
const DEFAULT_GROUPS = [
    { id: 'personal', translationKey: 'personal', color: '#667eea', visible: true },
    { id: 'work', translationKey: 'work', color: '#f59e0b', visible: true }
];

// DOM Elements
let calendarContainer;
let canvasLayer;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    calendarContainer = document.getElementById('calendar-container');
    canvasLayer = document.getElementById('canvas-layer');

    loadData();
    loadTheme();
    loadLanguage();
    setupWindowControls();
    setupEventListeners();
    setupCanvasInteraction();
    updatePeriodDisplay();
    renderCalendar();
    renderGroupsUI();
    renderFreeformElements();
});

// Load data from localStorage
function loadData() {
    try {
        const storedNotes = localStorage.getItem(NOTES_KEY);
        if (storedNotes) {
            freeformNotes = JSON.parse(storedNotes);
        }
        const storedLines = localStorage.getItem(LINES_KEY);
        if (storedLines) {
            freeformLines = JSON.parse(storedLines);
        }
        const storedGroups = localStorage.getItem(GROUPS_KEY);
        if (storedGroups) {
            groups = JSON.parse(storedGroups);
        } else {
            groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
        }
        const storedActiveGroup = localStorage.getItem(ACTIVE_GROUP_KEY);
        if (storedActiveGroup) {
            activeGroup = storedActiveGroup;
        }
    } catch (e) {
        console.error('Failed to load data:', e);
        freeformNotes = [];
        freeformLines = [];
        groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
    }
}

// Save data to localStorage (no history tracking - call pushHistory before modifying data)
function saveData() {
    try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(freeformNotes));
        localStorage.setItem(LINES_KEY, JSON.stringify(freeformLines));
        localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
        localStorage.setItem(ACTIVE_GROUP_KEY, activeGroup);
    } catch (e) {
        console.error('Failed to save data:', e);
    }
}

// Push current state to undo history - call this BEFORE modifying data
function pushHistory() {
    const currentState = JSON.stringify({ notes: freeformNotes, lines: freeformLines });

    // Don't push if state hasn't changed (avoid duplicates)
    if (undoStack.length > 0) {
        const lastState = JSON.stringify(undoStack[undoStack.length - 1]);
        if (currentState === lastState) return;
    }

    undoStack.push({
        notes: JSON.parse(JSON.stringify(freeformNotes)),
        lines: JSON.parse(JSON.stringify(freeformLines))
    });

    // Limit history size
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }

    // Clear redo stack when new action is taken
    redoStack = [];

    updateUndoRedoButtons();
}

// Undo last action
function undoAction() {
    if (undoStack.length === 0) return;

    // Save current state to redo stack
    redoStack.push({
        notes: JSON.parse(JSON.stringify(freeformNotes)),
        lines: JSON.parse(JSON.stringify(freeformLines))
    });

    // Pop and restore previous state
    const previousState = undoStack.pop();
    freeformNotes = previousState.notes;
    freeformLines = previousState.lines;

    // Save without adding to history
    saveData(true);

    // Re-render
    deselectElement();
    renderFreeformElements();

    updateUndoRedoButtons();
}

// Redo previously undone action
function redoAction() {
    if (redoStack.length === 0) return;

    // Save current state to undo stack
    undoStack.push({
        notes: JSON.parse(JSON.stringify(freeformNotes)),
        lines: JSON.parse(JSON.stringify(freeformLines))
    });

    // Pop and restore redo state
    const redoState = redoStack.pop();
    freeformNotes = redoState.notes;
    freeformLines = redoState.lines;

    // Save without adding to history
    saveData(true);

    // Re-render
    deselectElement();
    renderFreeformElements();

    updateUndoRedoButtons();
}

// Update undo/redo button states
function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-action-btn');
    const redoBtn = document.getElementById('redo-action-btn');

    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// Custom modal dialog helper
function showModal({ title, message, inputPlaceholder = '', showInput = false, confirmText = 'OK', confirmDanger = false }) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modal-overlay');
        const titleEl = document.getElementById('modal-title');
        const messageEl = document.getElementById('modal-message');
        const inputEl = document.getElementById('modal-input');
        const confirmBtn = document.getElementById('modal-confirm');
        const cancelBtn = document.getElementById('modal-cancel');
        const closeBtn = document.getElementById('modal-close');

        titleEl.textContent = title;
        messageEl.textContent = message || '';
        messageEl.classList.toggle('hidden', !message);
        inputEl.value = '';
        inputEl.placeholder = inputPlaceholder;
        inputEl.classList.toggle('hidden', !showInput);
        confirmBtn.textContent = confirmText;
        confirmBtn.className = 'modal-btn ' + (confirmDanger ? 'modal-btn-danger' : 'modal-btn-primary');

        overlay.classList.remove('hidden');

        if (showInput) {
            setTimeout(() => inputEl.focus(), 50);
        }
        // Click outside to close
        const onOverlayClick = (e) => {
            if (e.target === overlay) {
                onCancel();
            }
        };

        const cleanup = () => {
            overlay.classList.add('hidden');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
            inputEl.removeEventListener('keydown', onKeydown);
            overlay.removeEventListener('click', onOverlayClick);
        };

        const onConfirm = () => {
            cleanup();
            resolve(showInput ? inputEl.value.trim() : true);
        };

        const onCancel = () => {
            cleanup();
            resolve(showInput ? null : false);
        };

        const onKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
            }
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlayClick);

        if (showInput) {
            inputEl.addEventListener('keydown', onKeydown);
        }
    });
}

// Get display name for a group - translates built-in groups, uses name for custom ones
function getGroupDisplayName(group) {
    if (group.translationKey && UI_TEXT[currentLanguage][group.translationKey]) {
        return UI_TEXT[currentLanguage][group.translationKey];
    }
    return group.name || group.id;
}

// Render groups UI - toggles, selectors
function renderGroupsUI() {
    const togglesContainer = document.getElementById('groups-toggles');
    const activeGroupSelect = document.getElementById('active-group-select');
    const noteGroupSelect = document.getElementById('note-group-select');
    const lineGroupSelect = document.getElementById('line-group-select');

    // Clear existing
    togglesContainer.innerHTML = '';
    activeGroupSelect.innerHTML = '';
    noteGroupSelect.innerHTML = '';
    lineGroupSelect.innerHTML = '';

    // Create toggle for each group
    groups.forEach((group, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'group-toggle';
        wrapper.draggable = true;
        wrapper.dataset.groupIndex = index;
        // Get display name - translate if it's a built-in group, otherwise use custom name
        const displayName = getGroupDisplayName(group);

        wrapper.innerHTML = `
            <label>
                <input type="checkbox" data-group-id="${group.id}" ${group.visible ? 'checked' : ''}>
                <span class="group-name">${displayName}</span>
            </label>
            <button class="group-delete-btn" data-group-id="${group.id}" title="Delete group">×</button>
        `;
        togglesContainer.appendChild(wrapper);

        // Drag handlers for reordering (live reorder like redd-do)
        wrapper.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', group.id);
            setTimeout(() => wrapper.classList.add('dragging'), 0);
        });

        wrapper.addEventListener('dragend', () => {
            wrapper.classList.remove('dragging');
            // Save order from DOM on drag end
            const groupElements = Array.from(togglesContainer.querySelectorAll('.group-toggle'));
            const newOrder = groupElements.map(el => {
                const checkbox = el.querySelector('input[data-group-id]');
                return checkbox ? checkbox.dataset.groupId : null;
            }).filter(Boolean);

            // Reorder groups array to match DOM
            const reorderedGroups = [];
            newOrder.forEach(id => {
                const grp = groups.find(g => g.id === id);
                if (grp) reorderedGroups.push(grp);
            });
            if (reorderedGroups.length === groups.length) {
                groups = reorderedGroups;
                saveData();
            }
        });

        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const dragging = togglesContainer.querySelector('.dragging');
            if (!dragging || dragging === wrapper) return;

            // Get all group toggles and find insert position
            const siblings = [...togglesContainer.querySelectorAll('.group-toggle:not(.dragging)')];
            const nextSibling = siblings.find(sibling => {
                const rect = sibling.getBoundingClientRect();
                return e.clientX < rect.left + rect.width / 2;
            });

            if (nextSibling) {
                togglesContainer.insertBefore(dragging, nextSibling);
            } else {
                togglesContainer.appendChild(dragging);
            }
        });

        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
        });

        // Toggle visibility handler
        wrapper.querySelector('input').addEventListener('change', (e) => {
            const grp = groups.find(g => g.id === group.id);
            if (grp) {
                grp.visible = e.target.checked;
                saveData();
                renderFreeformElements();
            }
        });

        // Rename group handler (click on name)
        wrapper.querySelector('.group-name').addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const newName = await showModal({
                title: 'Rename Group',
                inputPlaceholder: group.name,
                showInput: true,
                confirmText: 'Rename'
            });

            if (newName) {
                const grp = groups.find(g => g.id === group.id);
                if (grp) {
                    grp.name = newName;
                    saveData();
                    renderGroupsUI();
                }
            }
        });

        // Delete group handler
        wrapper.querySelector('.group-delete-btn').addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (groups.length <= 1) {
                await showModal({
                    title: 'Cannot Delete',
                    message: 'You cannot delete the last group.',
                    confirmText: 'OK'
                });
                return;
            }

            const confirmed = await showModal({
                title: 'Delete Group',
                message: `Delete group "${group.name}"? Items in this group will be moved to Personal.`,
                confirmText: 'Delete',
                confirmDanger: true
            });

            if (confirmed) {
                // Move items to 'personal' group
                freeformNotes.forEach(n => { if (n.group === group.id) n.group = 'personal'; });
                freeformLines.forEach(l => { if (l.group === group.id) l.group = 'personal'; });

                // Remove group
                groups = groups.filter(g => g.id !== group.id);

                // If active group was deleted, switch to first available
                if (activeGroup === group.id) {
                    activeGroup = groups[0]?.id || 'personal';
                }

                saveData();
                renderGroupsUI();
                renderFreeformElements();
            }
        });
    });

    // Populate selectors
    groups.forEach(group => {
        const displayName = getGroupDisplayName(group);

        const option1 = document.createElement('option');
        option1.value = group.id;
        option1.textContent = displayName;
        activeGroupSelect.appendChild(option1);

        const option2 = document.createElement('option');
        option2.value = group.id;
        option2.textContent = displayName;
        noteGroupSelect.appendChild(option2);

        const option3 = document.createElement('option');
        option3.value = group.id;
        option3.textContent = displayName;
        lineGroupSelect.appendChild(option3);
    });

    // Set current active group
    activeGroupSelect.value = activeGroup;

    // Active group change handler
    activeGroupSelect.addEventListener('change', (e) => {
        activeGroup = e.target.value;
        saveData();
    });

    // Add group button handler
    document.getElementById('add-group-btn').addEventListener('click', async () => {
        const t = UI_TEXT[currentLanguage];
        const name = await showModal({
            title: t.addGroup,
            inputPlaceholder: 'Group name',
            showInput: true,
            confirmText: t.add
        });
        if (name) {
            const id = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
            const colors = ['#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];
            const color = colors[groups.length % colors.length];
            groups.push({ id, name: name.trim(), color, visible: true });
            saveData();
            renderGroupsUI();
        }
    });

    // Settings button handler
    setupSettings();
}

// Settings modal setup
function setupSettings() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsOverlay = document.getElementById('settings-overlay');
    const settingsClose = document.getElementById('settings-close');
    const themeLight = document.getElementById('theme-light');
    const themeDark = document.getElementById('theme-dark');
    const languageSelect = document.getElementById('language-select');

    // Open settings
    settingsBtn.addEventListener('click', () => {
        updateSettingsUI();
        settingsOverlay.classList.remove('hidden');
    });

    // Close settings
    settingsClose.addEventListener('click', () => {
        settingsOverlay.classList.add('hidden');
    });

    // Close on overlay click
    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.classList.add('hidden');
        }
    });

    // Theme buttons
    themeLight.addEventListener('click', () => {
        document.body.classList.remove('dark-mode');
        localStorage.setItem(THEME_KEY, 'light');
        updateSettingsUI();
    });

    themeDark.addEventListener('click', () => {
        document.body.classList.add('dark-mode');
        localStorage.setItem(THEME_KEY, 'dark');
        updateSettingsUI();
    });

    // Language select
    languageSelect.addEventListener('change', (e) => {
        currentLanguage = e.target.value;
        localStorage.setItem(LANGUAGE_KEY, currentLanguage);
        updateUIText();
        renderCalendar();
        renderGroupsUI();
        updateSettingsUI();
    });

    // Export button
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const importFile = document.getElementById('import-file');

    exportBtn.addEventListener('click', () => {
        const t = UI_TEXT[currentLanguage];
        const data = {
            version: 1,
            exportDate: new Date().toISOString(),
            notes: freeformNotes,
            lines: freeformLines,
            groups: groups
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `redd-plan-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        // Show success briefly
        const originalText = exportBtn.querySelector('#export-text').textContent;
        exportBtn.querySelector('#export-text').textContent = '✓';
        setTimeout(() => {
            exportBtn.querySelector('#export-text').textContent = originalText;
        }, 1500);
    });

    importBtn.addEventListener('click', () => {
        importFile.click();
    });

    importFile.addEventListener('change', (e) => {
        const t = UI_TEXT[currentLanguage];
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.notes) freeformNotes = data.notes;
                if (data.lines) freeformLines = data.lines;
                if (data.groups) groups = data.groups;

                saveData();
                renderCalendar();
                renderFreeformElements();
                renderGroupsUI();

                // Show success briefly
                const originalText = importBtn.querySelector('#import-text').textContent;
                importBtn.querySelector('#import-text').textContent = '✓';
                setTimeout(() => {
                    importBtn.querySelector('#import-text').textContent = originalText;
                }, 1500);
            } catch (err) {
                alert(t.importError);
            }
        };
        reader.readAsText(file);
        importFile.value = ''; // Reset for same file selection
    });
}

// Update settings UI to reflect current state
function updateSettingsUI() {
    const isDark = document.body.classList.contains('dark-mode');
    document.getElementById('theme-light').classList.toggle('active', !isDark);
    document.getElementById('theme-dark').classList.toggle('active', isDark);
    document.getElementById('language-select').value = currentLanguage;

    // Update settings labels
    const t = UI_TEXT[currentLanguage];
    document.getElementById('settings-title').textContent = t.settings;
    document.getElementById('theme-label').textContent = t.theme;
    document.getElementById('language-label').textContent = t.language;
    document.getElementById('data-label').textContent = t.data;
    document.getElementById('export-text').textContent = t.exportData;
    document.getElementById('import-text').textContent = t.importData;
}

// Update all UI text based on current language
function updateUIText() {
    const t = UI_TEXT[currentLanguage];
    // Update "New items:" label
    const newItemsLabel = document.querySelector('.group-selector label');
    if (newItemsLabel) newItemsLabel.textContent = t.newItems;
}

// Load theme preference
function loadTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
}

// Load language preference
function loadLanguage() {
    const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
    if (savedLanguage) {
        currentLanguage = savedLanguage;
    }
    updateUIText();
}

// Toggle theme
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
}

// Window controls removed - not needed for PWA
function setupWindowControls() {
    // No-op for browser/PWA
}

// Setup event listeners
function setupEventListeners() {
    const periodDisplay = document.getElementById('period-display');
    const prevPeriodBtn = document.getElementById('prev-period-btn');
    const nextPeriodBtn = document.getElementById('next-period-btn');

    prevPeriodBtn.addEventListener('click', () => {
        if (currentHalf === 1) {
            currentYear--;
            currentHalf = 2;
        } else {
            currentHalf = 1;
        }
        updatePeriodDisplay();
        renderCalendar();
        renderFreeformElements();
    });

    nextPeriodBtn.addEventListener('click', () => {
        if (currentHalf === 2) {
            currentYear++;
            currentHalf = 1;
        } else {
            currentHalf = 2;
        }
        updatePeriodDisplay();
        renderCalendar();
        renderFreeformElements();
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        // Don't navigate if editing text
        if (e.target.classList.contains('note-input-inline')) return;
        if (e.target.getAttribute('contenteditable') === 'true') return;

        if (e.key === 'ArrowLeft') {
            prevPeriodBtn.click();
        } else if (e.key === 'ArrowRight') {
            nextPeriodBtn.click();
        }
    });
}

// Update period display
function updatePeriodDisplay() {
    const periodDisplay = document.getElementById('period-display');
    const periodText = currentHalf === 1 ? `Jan – Jun ${currentYear}` : `Jul – Dec ${currentYear}`;
    periodDisplay.textContent = periodText;
}

// Get week number (week 1 contains January 1)
function getWeekNumber(date) {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const startDay = startOfYear.getDay();
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    const firstMonday = new Date(startOfYear);
    firstMonday.setDate(startOfYear.getDate() + mondayOffset);

    const daysSinceFirstMonday = Math.floor((date - firstMonday) / 86400000);
    let weekNum = Math.floor(daysSinceFirstMonday / 7) + 1;
    if (weekNum < 1) weekNum = 1;

    return weekNum;
}

// Get weekday index (Monday = 0, Sunday = 6)
function getWeekdayIndex(date) {
    const day = date.getDay();
    return day === 0 ? 6 : day - 1;
}

// Get days in month
function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

// Format date key
function formatDateKey(year, month, day) {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
}

// Check if date is today
function isToday(year, month, day) {
    const today = new Date();
    return year === today.getFullYear() &&
        month === today.getMonth() &&
        day === today.getDate();
}

// Render the calendar grid
function renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    calendarGrid.innerHTML = '';

    const startMonth = currentHalf === 1 ? 0 : 6;
    const endMonth = currentHalf === 1 ? 5 : 11;

    for (let month = startMonth; month <= endMonth; month++) {
        const monthColumn = createMonthColumn(month);
        calendarGrid.appendChild(monthColumn);
    }
}

// Create a month column
function createMonthColumn(month) {
    const column = document.createElement('div');
    column.className = 'month-column';

    const header = document.createElement('div');
    header.className = 'month-header';
    header.textContent = currentLanguage === 'da' ? MONTHS_DA[month] : MONTHS_EN[month];
    column.appendChild(header);

    const daysContainer = document.createElement('div');
    daysContainer.className = 'days-container';

    const daysInMonth = getDaysInMonth(currentYear, month);

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, month, day);
        const weekdayIndex = getWeekdayIndex(date);
        const isWeekend = weekdayIndex >= 5;
        const dateKey = formatDateKey(currentYear, month, day);
        const todayClass = isToday(currentYear, month, day) ? ' today' : '';
        const weekendClass = isWeekend ? ' weekend' : '';

        const dayRow = document.createElement('div');
        dayRow.className = `day-row${todayClass}${weekendClass}`;
        dayRow.dataset.dateKey = dateKey;

        const dayName = document.createElement('span');
        dayName.className = 'day-name';
        dayName.textContent = currentLanguage === 'da' ? WEEKDAYS_DA[weekdayIndex] : WEEKDAYS_EN[weekdayIndex];
        dayRow.appendChild(dayName);

        const dayNumber = document.createElement('span');
        dayNumber.className = 'day-number';
        dayNumber.textContent = day;
        dayRow.appendChild(dayNumber);

        // Holiday display area
        const holidays = getHolidays(currentYear);
        const holiday = holidays[dateKey];

        const noteArea = document.createElement('div');
        noteArea.className = 'note-area';

        if (holiday) {
            const holidayEl = document.createElement('span');
            holidayEl.className = 'note-text holiday';
            holidayEl.textContent = holiday;
            holidayEl.style.left = '0px';
            noteArea.appendChild(holidayEl);
        }

        dayRow.appendChild(noteArea);

        // Week number on Sunday
        if (weekdayIndex === 6) {
            const weekNum = document.createElement('span');
            weekNum.className = 'week-number';
            weekNum.textContent = getWeekNumber(date);
            dayRow.appendChild(weekNum);
        }

        daysContainer.appendChild(dayRow);
    }

    column.appendChild(daysContainer);
    return column;
}

// Setup canvas interaction for freeform notes and lines
function setupCanvasInteraction() {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let tempLine = null;

    calendarContainer.addEventListener('mousedown', (e) => {
        // Don't interact if clicking on certain elements
        if (e.target.classList.contains('note-text') ||
            e.target.classList.contains('note-input-inline') ||
            e.target.classList.contains('note-line') ||
            e.target.classList.contains('month-header') ||
            e.target.closest('.title-bar') ||
            e.target.closest('.footer') ||
            e.target.closest('.inline-toolbar')) {
            return;
        }

        // If an note input is open, close it instead of creating new elements
        const existingInput = canvasLayer.querySelector('.note-input-inline');
        if (existingInput) {
            existingInput.blur();
            return;
        }

        // If an editor is open, close it instead of creating new elements
        if (selectedElement) {
            deselectElement();
            return;
        }

        // Use canvas layer rect for accurate positioning
        const canvasRect = canvasLayer.getBoundingClientRect();
        startX = e.clientX - canvasRect.left;
        startY = e.clientY - canvasRect.top + calendarContainer.scrollTop;
        isDragging = false;

        // Create temporary line
        tempLine = document.createElement('div');
        tempLine.className = 'note-line temp';
        tempLine.style.left = startX + 'px';
        tempLine.style.top = startY + 'px';
        tempLine.style.width = '0px';
        canvasLayer.appendChild(tempLine);

        const onMouseMove = (moveEvent) => {
            const currentX = moveEvent.clientX - canvasRect.left;
            const currentY = moveEvent.clientY - canvasRect.top + calendarContainer.scrollTop;
            const dx = currentX - startX;
            const dy = currentY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 5) {
                isDragging = true;
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                tempLine.style.width = distance + 'px';
                tempLine.style.transform = `rotate(${angle}deg)`;
                tempLine.style.transformOrigin = '0 50%';
            }
        };

        const onMouseUp = (upEvent) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (tempLine) {
                tempLine.remove();
                tempLine = null;
            }

            const endX = upEvent.clientX - canvasRect.left;
            const endY = upEvent.clientY - canvasRect.top + calendarContainer.scrollTop;
            const dx = endX - startX;
            const dy = endY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (isDragging && distance > 10) {
                // Create line with start/end points
                const lineId = Date.now().toString();
                const defaultColor = '#333333';
                const defaultWidth = 8;
                pushHistory(); // Save state before adding line
                freeformLines.push({
                    id: lineId,
                    x1: startX,
                    y1: startY,
                    x2: endX,
                    y2: endY,
                    color: defaultColor,
                    width: defaultWidth,
                    year: currentYear,
                    half: currentHalf,
                    group: activeGroup
                });
                saveData();

                const lineEl = createFreeformLine(lineId, startX, startY, endX, endY, defaultColor, defaultWidth);
                canvasLayer.appendChild(lineEl);
            } else {
                // Check if there's an existing input - if so, just close it (blur triggers save)
                const existingInput = canvasLayer.querySelector('.note-input-inline');
                if (existingInput) {
                    existingInput.blur();
                } else {
                    // Create text input
                    createFreeformInput(startX, startY);
                }
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// Render freeform elements for current period
function renderFreeformElements() {
    canvasLayer.innerHTML = '';

    // Get visible group IDs
    const visibleGroups = groups.filter(g => g.visible).map(g => g.id);

    freeformNotes
        .filter(note => note.year === currentYear && note.half === currentHalf)
        .filter(note => !note.group || visibleGroups.includes(note.group))
        .forEach(note => {
            const noteEl = createFreeformNote(note.id, note.text, note.x, note.y, note.html, note.fontColor, note.bgColor);
            canvasLayer.appendChild(noteEl);
        });

    freeformLines
        .filter(line => line.year === currentYear && line.half === currentHalf)
        .filter(line => !line.group || visibleGroups.includes(line.group))
        .forEach(line => {
            // Support both old (x1, x2, y) and new (x1, y1, x2, y2) format
            const y1 = line.y1 !== undefined ? line.y1 : line.y;
            const y2 = line.y2 !== undefined ? line.y2 : line.y;
            const lineEl = createFreeformLine(line.id, line.x1, y1, line.x2, y2, line.color, line.width);
            canvasLayer.appendChild(lineEl);
        });
}

// Create freeform note element
function createFreeformNote(id, text, x, y, html = null, fontColor = null, bgColor = null) {
    const noteEl = document.createElement('span');
    noteEl.className = 'note-text freeform';

    // Use HTML if available, otherwise plain text
    if (html) {
        noteEl.innerHTML = html;
    } else {
        noteEl.textContent = text || 'New note';
    }

    noteEl.style.left = x + 'px';
    noteEl.style.top = y + 'px';
    noteEl.dataset.noteId = id;

    // Apply saved colors
    if (fontColor) noteEl.style.color = fontColor;
    if (bgColor) noteEl.style.backgroundColor = bgColor;

    // Track if we're dragging (to distinguish from click)
    let hasDragged = false;

    // Mousedown starts potential drag
    noteEl.addEventListener('mousedown', (e) => {
        // Don't start drag if we're editing (contenteditable)
        if (noteEl.getAttribute('contenteditable') === 'true') {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        hasDragged = false;
        const mouseStartX = e.clientX;
        const mouseStartY = e.clientY;
        const startLeft = parseInt(noteEl.style.left) || 0;
        const startTop = parseInt(noteEl.style.top) || 0;

        noteEl.classList.add('dragging');

        const onMouseMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - mouseStartX;
            const deltaY = moveEvent.clientY - mouseStartY;

            // Only consider it a drag if moved more than 5 pixels
            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                hasDragged = true;
            }

            noteEl.style.left = Math.max(0, startLeft + deltaX) + 'px';
            noteEl.style.top = Math.max(0, startTop + deltaY) + 'px';
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            noteEl.classList.remove('dragging');

            const note = freeformNotes.find(n => n.id === id);
            if (note) {
                let newX = parseInt(noteEl.style.left) || 0;
                let newY = parseInt(noteEl.style.top) || 0;

                // Snap to closest date row and note area if enabled (default is true)
                if (note.snapToDate !== false) {
                    const snapped = findClosestDateRowPosition(newX, newY);
                    newX = snapped.x;
                    newY = snapped.y;
                    noteEl.style.left = newX + 'px';
                    noteEl.style.top = newY + 'px';
                }

                note.x = newX;
                note.y = newY;
                saveData();
            }

            // If it was a click (not drag), show editor
            if (!hasDragged) {
                showNoteEditor(id, noteEl);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Handle input for inline editing
    noteEl.addEventListener('input', () => {
        const note = freeformNotes.find(n => n.id === id);
        if (note) {
            note.html = noteEl.innerHTML;
            note.text = noteEl.textContent.trim();
            saveData();
        }
    });

    return noteEl;
}

// Create freeform input
function createFreeformInput(x, y, existingText = '', existingId = null) {
    const existingInput = canvasLayer.querySelector('.note-input-inline');
    if (existingInput) existingInput.remove();

    // Snap position to closest date row's note area for new notes
    let snappedX = x;
    let snappedY = y;
    if (!existingId) {
        const snapped = findClosestDateRowPosition(x, y);
        snappedX = snapped.x;
        snappedY = snapped.y;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-input-inline';
    input.style.left = snappedX + 'px';
    input.style.top = snappedY + 'px';
    input.value = existingText;
    input.placeholder = 'Type here...';

    const finishEditing = () => {
        document.body.classList.remove('editor-open');
        calendarContainer.style.cursor = ''; // Restore default (pencil from CSS)
        const text = input.value.trim();
        input.remove();

        if (text) {
            let noteId = existingId;
            if (existingId) {
                const note = freeformNotes.find(n => n.id === existingId);
                if (note) {
                    pushHistory(); // Save state before editing
                    note.text = text;
                }
            } else {
                noteId = Date.now().toString();
                pushHistory(); // Save state before adding note
                freeformNotes.push({
                    id: noteId,
                    text, x: snappedX, y: snappedY,
                    year: currentYear,
                    half: currentHalf,
                    snapToDate: true,
                    group: activeGroup
                });
            }
            saveData();

            const noteEl = createFreeformNote(noteId, text, snappedX, snappedY);
            canvasLayer.appendChild(noteEl);
        } else if (existingId) {
            pushHistory(); // Save state before deleting
            freeformNotes = freeformNotes.filter(n => n.id !== existingId);
            saveData();
        }
    };

    input.addEventListener('blur', finishEditing);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            input.value = existingText;
            input.blur();
        }
    });

    canvasLayer.appendChild(input);
    document.body.classList.add('editor-open'); // Change cursor to normal
    console.log('editor-open class added:', document.body.classList.contains('editor-open'));

    // Keep editor-open while input is focused
    // Keep editor-open while input is focused
    input.addEventListener('focus', () => {
        document.body.classList.add('editor-open');
        calendarContainer.style.cursor = 'default'; // Override pencil cursor
    });

    calendarContainer.style.cursor = 'default'; // Override pencil cursor via inline style
    input.focus();
}

// Create freeform line (supports diagonal)
function createFreeformLine(id, x1, y1, x2, y2, color, width) {
    // Container for line and handles
    const container = document.createElement('div');
    container.className = 'note-line-container';
    container.dataset.lineId = id;

    // Use defaults if not specified
    color = color || '#333333';
    width = width || 8;

    // Update line geometry
    function updateLineGeometry() {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        lineEl.style.left = x1 + 'px';
        lineEl.style.top = y1 + 'px';
        lineEl.style.width = length + 'px';
        lineEl.style.transform = `rotate(${angle}deg)`;

        // Update handle positions
        startHandle.style.left = (x1 - 5) + 'px';
        startHandle.style.top = (y1 - 5) + 'px';
        endHandle.style.left = (x2 - 5) + 'px';
        endHandle.style.top = (y2 - 5) + 'px';
    }

    // The line element
    const lineEl = document.createElement('div');
    lineEl.className = 'note-line';
    lineEl.style.transformOrigin = '0 50%';
    lineEl.style.background = color;
    lineEl.style.height = width + 'px';
    lineEl.title = 'Click to edit, drag to move';

    // Start handle (at x1, y1)
    const startHandle = document.createElement('div');
    startHandle.className = 'line-handle start';
    startHandle.title = 'Drag to resize';

    // End handle (at x2, y2)
    const endHandle = document.createElement('div');
    endHandle.className = 'line-handle end';
    endHandle.title = 'Drag to resize';

    container.appendChild(lineEl);
    container.appendChild(startHandle);
    container.appendChild(endHandle);

    updateLineGeometry();

    // Track dragging to distinguish from click
    let hasDragged = false;

    // Drag line to move (mousedown)
    lineEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        hasDragged = false;
        const mouseStartX = e.clientX;
        const mouseStartY = e.clientY;
        const origX1 = x1, origY1 = y1, origX2 = x2, origY2 = y2;

        lineEl.classList.add('dragging');

        const onMouseMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - mouseStartX;
            const deltaY = moveEvent.clientY - mouseStartY;

            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                hasDragged = true;
            }

            x1 = origX1 + deltaX;
            y1 = origY1 + deltaY;
            x2 = origX2 + deltaX;
            y2 = origY2 + deltaY;
            updateLineGeometry();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            lineEl.classList.remove('dragging');

            // Save position
            const line = freeformLines.find(l => l.id === id);
            if (line) {
                line.x1 = x1; line.y1 = y1;
                line.x2 = x2; line.y2 = y2;
                saveData();
            }

            // If it was a click (not drag), show line editor
            if (!hasDragged) {
                showLineEditor(id, lineEl);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Resize from start handle
    startHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const canvasRect = canvasLayer.getBoundingClientRect();

        const onMouseMove = (moveEvent) => {
            x1 = moveEvent.clientX - canvasRect.left;
            y1 = moveEvent.clientY - canvasRect.top + calendarContainer.scrollTop;
            updateLineGeometry();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const line = freeformLines.find(l => l.id === id);
            if (line) {
                line.x1 = x1; line.y1 = y1;
                saveData();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Resize from end handle
    endHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const canvasRect = canvasLayer.getBoundingClientRect();

        const onMouseMove = (moveEvent) => {
            x2 = moveEvent.clientX - canvasRect.left;
            y2 = moveEvent.clientY - canvasRect.top + calendarContainer.scrollTop;
            updateLineGeometry();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const line = freeformLines.find(l => l.id === id);
            if (line) {
                line.x2 = x2; line.y2 = y2;
                saveData();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    return container;
}

//
// ==========================================
// INLINE TOOLBARS
// ==========================================

function showNoteEditor(noteId, noteElement) {
    const note = freeformNotes.find(n => n.id === noteId);
    if (!note) return;

    // Mark as selected
    deselectElement();
    selectedElement = { type: 'note', id: noteId, element: noteElement };
    noteElement.classList.add('selected');

    // Make note editable
    noteElement.setAttribute('contenteditable', 'true');
    noteElement.focus();

    // Exit editing on Enter (prevent linebreak)
    const enterHandler = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            noteElement.blur();
            deselectElement();
            noteElement.removeEventListener('keydown', enterHandler);
        }
    };
    noteElement.addEventListener('keydown', enterHandler);

    const toolbar = document.getElementById('note-toolbar');

    // Position toolbar ABOVE the element
    const rect = noteElement.getBoundingClientRect();
    const toolbarWidth = 320;
    toolbar.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - toolbarWidth - 8)) + 'px';
    toolbar.style.top = Math.max(8, rect.top - 40) + 'px';

    toolbar.classList.remove('hidden');

    // Mark that an editor is open (for cursor styling)
    document.body.classList.add('editor-open');

    // Update snap toggle state
    const snapToggle = document.getElementById('note-snap-toggle');
    snapToggle.checked = note.snapToDate !== false;

    // Update color pickers to match note's current colors
    const fontColorPicker = document.getElementById('font-color-picker');
    const fontColorIndicator = document.getElementById('font-color-indicator');
    const bgColorPicker = document.getElementById('bg-color-picker');
    const bgColorIndicator = document.getElementById('bg-color-indicator');

    fontColorPicker.value = note.fontColor || '#333333';
    fontColorIndicator.style.background = note.fontColor || '#333333';
    bgColorPicker.value = note.bgColor || '#ffff00';
    bgColorIndicator.style.background = note.bgColor || 'transparent';

    // Update group selector
    const noteGroupSelect = document.getElementById('note-group-select');
    noteGroupSelect.value = note.group || activeGroup;
}

function showLineEditor(lineId, lineElement) {
    const line = freeformLines.find(l => l.id === lineId);
    if (!line) return;

    // Mark as selected
    deselectElement();
    selectedElement = { type: 'line', id: lineId, element: lineElement };
    lineElement.classList.add('selected');

    const toolbar = document.getElementById('line-toolbar');

    // Position toolbar ABOVE the element
    const rect = lineElement.getBoundingClientRect();
    const toolbarWidth = 140;
    toolbar.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - toolbarWidth - 8)) + 'px';
    toolbar.style.top = Math.max(8, rect.top - 40) + 'px';

    toolbar.classList.remove('hidden');

    // Update color picker to match current line color
    const colorPicker = document.getElementById('line-color-picker');
    const colorIndicator = document.getElementById('line-color-indicator');
    colorPicker.value = line.color || '#333333';
    colorIndicator.style.background = line.color || '#333333';

    // Update group selector
    const lineGroupSelect = document.getElementById('line-group-select');
    lineGroupSelect.value = line.group || activeGroup;

    // Mark that an editor is open (for cursor styling)
    document.body.classList.add('editor-open');
}

function deselectElement() {
    if (selectedElement) {
        selectedElement.element.classList.remove('selected');

        // If it was a note, disable editing and save
        if (selectedElement.type === 'note') {
            selectedElement.element.setAttribute('contenteditable', 'false');
            const note = freeformNotes.find(n => n.id === selectedElement.id);
            if (note) {
                note.html = selectedElement.element.innerHTML;
                note.text = selectedElement.element.textContent.trim();
                saveData();
            }
        }

        selectedElement = null;
    }
    document.getElementById('note-toolbar').classList.add('hidden');
    document.getElementById('line-toolbar').classList.add('hidden');

    // Remove editor-open class (for cursor styling)
    document.body.classList.remove('editor-open');
}

function deleteSelectedElement() {
    if (!selectedElement) return;

    if (selectedElement.type === 'note') {
        const note = freeformNotes.find(n => n.id === selectedElement.id);
        if (note) {
            pushHistory(); // Save state before deleting
            lastDeletedItem = { type: 'note', data: JSON.parse(JSON.stringify(note)) };
            freeformNotes = freeformNotes.filter(n => n.id !== selectedElement.id);
            saveData();
            selectedElement.element.remove();
        }
    } else if (selectedElement.type === 'line') {
        const line = freeformLines.find(l => l.id === selectedElement.id);
        if (line) {
            pushHistory(); // Save state before deleting
            lastDeletedItem = { type: 'line', data: JSON.parse(JSON.stringify(line)) };
            freeformLines = freeformLines.filter(l => l.id !== selectedElement.id);
            saveData();
            // For lines, element is the container
            selectedElement.element.closest('.note-line-container')?.remove() || selectedElement.element.remove();
        }
    }

    deselectElement();
}

function setupToolbarListeners() {
    // ==========================================
    // NOTE TOOLBAR
    // ==========================================

    // Formatting buttons (bold, italic, underline)
    document.querySelectorAll('#note-toolbar .toolbar-btn[data-command]').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent losing focus from note
            const command = btn.dataset.command;
            document.execCommand(command, false, null);
        });
    });

    // Font color picker - applies to entire note
    document.getElementById('font-color-picker').addEventListener('input', (e) => {
        const color = e.target.value;
        document.getElementById('font-color-indicator').style.background = color;

        if (selectedElement && selectedElement.type === 'note') {
            pushHistory();
            const note = freeformNotes.find(n => n.id === selectedElement.id);
            if (note) {
                note.fontColor = color;
                selectedElement.element.style.color = color;
                saveData();
            }
        }
    });

    // Background color picker - applies to entire note
    document.getElementById('bg-color-picker').addEventListener('input', (e) => {
        const color = e.target.value;
        document.getElementById('bg-color-indicator').style.background = color;

        if (selectedElement && selectedElement.type === 'note') {
            pushHistory();
            const note = freeformNotes.find(n => n.id === selectedElement.id);
            if (note) {
                note.bgColor = color;
                selectedElement.element.style.backgroundColor = color;
                saveData();
            }
        }
    });

    // Clear background button
    document.getElementById('clear-bg-btn').addEventListener('click', () => {
        if (selectedElement && selectedElement.type === 'note') {
            pushHistory();
            const note = freeformNotes.find(n => n.id === selectedElement.id);
            if (note) {
                note.bgColor = null;
                selectedElement.element.style.backgroundColor = 'transparent';
                document.getElementById('bg-color-indicator').style.background = 'transparent';
                saveData();
            }
        }
    });

    // Note snap toggle
    document.getElementById('note-snap-toggle').addEventListener('change', (e) => {
        if (selectedElement && selectedElement.type === 'note') {
            const note = freeformNotes.find(n => n.id === selectedElement.id);
            if (note) {
                note.snapToDate = e.target.checked;

                // If turning snap on, immediately snap the note
                if (note.snapToDate) {
                    const newY = findClosestDateRowY(note.y);
                    note.y = newY;
                    selectedElement.element.style.top = newY + 'px';
                }

                saveData();
            }
        }
    });

    // Note group select
    document.getElementById('note-group-select').addEventListener('change', (e) => {
        if (selectedElement && selectedElement.type === 'note') {
            pushHistory();
            const note = freeformNotes.find(n => n.id === selectedElement.id);
            if (note) {
                note.group = e.target.value;
                saveData();
            }
        }
    });

    // Note delete button
    document.getElementById('note-delete-btn').addEventListener('click', deleteSelectedElement);

    // ==========================================
    // LINE TOOLBAR
    // ==========================================

    // Line width dropdown items
    document.querySelectorAll('#line-width-menu .dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            if (selectedElement && selectedElement.type === 'line') {
                const line = freeformLines.find(l => l.id === selectedElement.id);
                if (line) {
                    line.width = parseInt(item.dataset.width);
                    saveData();

                    // Update visual
                    const lineEl = selectedElement.element.closest('.note-line-container')?.querySelector('.note-line') || selectedElement.element;
                    lineEl.style.height = line.width + 'px';
                }
            }
        });
    });

    // Line color picker
    document.getElementById('line-color-picker').addEventListener('input', (e) => {
        const color = e.target.value;
        document.getElementById('line-color-indicator').style.background = color;

        if (selectedElement && selectedElement.type === 'line') {
            const line = freeformLines.find(l => l.id === selectedElement.id);
            if (line) {
                line.color = color;
                saveData();

                // Update visual
                const lineEl = selectedElement.element.closest('.note-line-container')?.querySelector('.note-line') || selectedElement.element;
                lineEl.style.background = color;
            }
        }
    });

    // Line group select
    document.getElementById('line-group-select').addEventListener('change', (e) => {
        if (selectedElement && selectedElement.type === 'line') {
            pushHistory();
            const line = freeformLines.find(l => l.id === selectedElement.id);
            if (line) {
                line.group = e.target.value;
                saveData();
            }
        }
    });

    // Line delete button
    document.getElementById('line-delete-btn').addEventListener('click', deleteSelectedElement);

    // ==========================================
    // GLOBAL LISTENERS
    // ==========================================

    // Click outside to deselect
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.inline-toolbar') &&
            !e.target.closest('.note-text.freeform') &&
            !e.target.closest('.note-line-container') &&
            !e.target.closest('.note-line')) {
            deselectElement();
        }
    });

    // Escape to close, Backspace/Delete to remove, Cmd+Z to undo, Cmd+Shift+Z to redo
    document.addEventListener('keydown', (e) => {
        // Undo: Cmd+Z (Mac) or Ctrl+Z (Windows)
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoAction();
            return;
        }

        // Redo: Cmd+Shift+Z (Mac) or Ctrl+Y (Windows)
        if ((e.metaKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) {
            e.preventDefault();
            redoAction();
            return;
        }

        if (e.key === 'Escape') {
            deselectElement();
        }

        // Delete/Backspace deletes selected element (but only if not editing text)
        if ((e.key === 'Backspace' || e.key === 'Delete') && selectedElement) {
            // For notes, only delete if not actively editing (contenteditable)
            if (selectedElement.type === 'note') {
                const isEditing = selectedElement.element.getAttribute('contenteditable') === 'true';
                // Only delete if the note is empty or we're not focused on it
                if (isEditing && document.activeElement === selectedElement.element) {
                    return; // Allow normal backspace behavior in text
                }
            }
            e.preventDefault();
            deleteSelectedElement();
        }
    });

    // Undo/Redo button click handlers
    document.getElementById('undo-action-btn').addEventListener('click', undoAction);
    document.getElementById('redo-action-btn').addEventListener('click', redoAction);
}

// Initialize listeners after DOM ready
document.addEventListener('DOMContentLoaded', () => {
    setupToolbarListeners();
});
