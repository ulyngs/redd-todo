// Plan Module - Wraps redd-plan functionality for use in redd-do
// This module can be initialized/destroyed and uses namespaced storage

const PlanModule = (function () {
    'use strict';

    let isInitialized = false;
    let container = null;

    // Storage prefix to avoid conflicts with main redd-do storage
    const STORAGE_PREFIX = 'redd-do-plan-';

    // State variables (same as redd-plan but scoped to module)
    let currentYear = new Date().getFullYear();
    // Start month and year for the leftmost visible column
    let startMonth = new Date().getMonth(); // 0-11
    let startYear = currentYear;
    const MONTHS_TO_RENDER = 12; // Render 12 months at a time
    const COLUMN_WIDTH = 252; // 240px + 12px gap
    const VIEW_MODE_KEY = STORAGE_PREFIX + 'calendar-view-mode';
    const WEEK_GOALS_KEY = STORAGE_PREFIX + 'week-goals';
    const GOAL_ASSIGNEES_KEY = STORAGE_PREFIX + 'goal-assignees';
    const WEEK_VIEW_START_HOUR = 7;
    const WEEK_VIEW_END_HOUR = 22;
    const WEEK_VIEW_HOUR_HEIGHT = 44;
    let calendarViewMode = 'months'; // 'months' | 'week'
    let weekStartDate = getMondayOfWeek(new Date());
    let weekGoalsByWeek = {};
    let goalAssignees = [];
    let editingGoalId = null;
    let weekGoalDropHighlightEl = null;
    let isWeekGoalDragInProgress = false;
    let currentLanguage = 'en';
    let freeformNotes = [];
    let freeformLines = [];
    let groups = [];
    let activeGroup = 'personal';
    let selectedElements = [];  // Array for multi-select support
    let lastDeletedItem = null;
    let undoStack = [];
    let redoStack = [];
    const MAX_HISTORY = 50;

    // DOM references (will be set on init)
    let calendarContainer = null;
    let canvasLayer = null;
    let resizeObserver = null;
    let resizeTimer = null;
    let onWindowResize = null;

    // Flag to prevent re-rendering during drag operations
    let isDragInProgress = false;
    let freeformRenderGeneration = 0;
    let calendarSyncInProgress = null;

    // Constants
    const MONTHS_DA = ['Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'December'];
    const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const WEEKDAYS_DA = ['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø'];
    const WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    const WEEKDAYS_FULL_DA = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
    const WEEKDAYS_FULL_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const GOAL_ASSIGNEE_LEGACY = { ulrik: 'a', tiago: 'b' };
    const DEFAULT_GOAL_ASSIGNEES = [
        { id: 'a', label: 'Person 1', color: '#1e2d3e' },
        { id: 'b', label: 'Person 2', color: '#2a9d8f' },
    ];
    const GOAL_ASSIGNEE_PALETTE = [
        '#1e2d3e', '#2a9d8f', '#7da9c8', '#8eb5b0', '#8cb89c',
        '#d4ba6a', '#d4a5a8', '#d99a6c', '#d4605a', '#a896c0',
    ];
    const GOAL_DRAG_THRESHOLD_PX = 6;

    function getDefaultGoalAssigneeId() {
        return goalAssignees[0]?.id || DEFAULT_GOAL_ASSIGNEES[0].id;
    }

    function getAssigneeShortLabel(label) {
        const trimmed = (label || '').trim();
        if (!trimmed) return '?';
        const parts = trimmed.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return trimmed.slice(0, 2).toUpperCase();
    }

    function hexToRgba(hex, alpha) {
        const normalized = (hex || '#1e2d3e').replace('#', '');
        if (normalized.length !== 6) return `rgba(30, 45, 62, ${alpha})`;
        const r = parseInt(normalized.slice(0, 2), 16);
        const g = parseInt(normalized.slice(2, 4), 16);
        const b = parseInt(normalized.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function getContrastTextColor(hex) {
        const normalized = (hex || '#1e2d3e').replace('#', '');
        if (normalized.length !== 6) return '#fff';
        const r = parseInt(normalized.slice(0, 2), 16);
        const g = parseInt(normalized.slice(2, 4), 16);
        const b = parseInt(normalized.slice(4, 6), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.62 ? '#1e2d3e' : '#fff';
    }

    function getGoalAssignees() {
        const map = {};
        for (const assignee of goalAssignees) {
            map[assignee.id] = {
                label: assignee.label,
                short: getAssigneeShortLabel(assignee.label),
                color: assignee.color,
            };
        }
        return map;
    }

    function normalizeGoalAssignee(assignee) {
        if (GOAL_ASSIGNEE_LEGACY[assignee]) assignee = GOAL_ASSIGNEE_LEGACY[assignee];
        return getGoalAssignees()[assignee] ? assignee : getDefaultGoalAssigneeId();
    }

    function applyGoalAssigneeStyles(pill, badgeEl, assignee) {
        const color = assignee?.color || '#1e2d3e';
        pill.style.borderColor = hexToRgba(color, 0.28);
        pill.style.background = hexToRgba(color, 0.1);
        badgeEl.style.background = color;
        badgeEl.style.color = getContrastTextColor(color);
    }

    function loadGoalAssignees() {
        let seededDefaults = false;
        try {
            const stored = localStorage.getItem(GOAL_ASSIGNEES_KEY);
            if (stored) {
                goalAssignees = JSON.parse(stored);
            } else {
                goalAssignees = JSON.parse(JSON.stringify(DEFAULT_GOAL_ASSIGNEES));
                seededDefaults = true;
            }
        } catch {
            goalAssignees = JSON.parse(JSON.stringify(DEFAULT_GOAL_ASSIGNEES));
            seededDefaults = true;
        }

        if (!Array.isArray(goalAssignees) || goalAssignees.length === 0) {
            goalAssignees = JSON.parse(JSON.stringify(DEFAULT_GOAL_ASSIGNEES));
            seededDefaults = true;
        }

        goalAssignees = goalAssignees
            .filter((item) => item && item.id && item.label)
            .map((item) => ({
                id: String(item.id),
                label: String(item.label).trim() || 'Person',
                color: item.color || GOAL_ASSIGNEE_PALETTE[0],
            }));

        if (goalAssignees.length === 0) {
            goalAssignees = JSON.parse(JSON.stringify(DEFAULT_GOAL_ASSIGNEES));
            seededDefaults = true;
        }

        if (seededDefaults) saveGoalAssignees();
    }

    function saveGoalAssignees() {
        try {
            localStorage.setItem(GOAL_ASSIGNEES_KEY, JSON.stringify(goalAssignees));
        } catch {
            /* private mode */
        }
    }

    function createGoalAssigneeId() {
        return `person-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function nextGoalAssigneeColor() {
        const used = new Set(goalAssignees.map((item) => item.color));
        return GOAL_ASSIGNEE_PALETTE.find((color) => !used.has(color))
            || GOAL_ASSIGNEE_PALETTE[goalAssignees.length % GOAL_ASSIGNEE_PALETTE.length];
    }

    function reassignGoalsFromAssignee(fromId, toId) {
        let changed = false;
        for (const weekKey of Object.keys(weekGoalsByWeek)) {
            for (const goal of weekGoalsByWeek[weekKey] || []) {
                if (goal.assignee === fromId) {
                    goal.assignee = toId;
                    changed = true;
                }
            }
        }
        if (changed) saveWeekGoals();
    }

    function addGoalAssignee() {
        const label = `Person ${goalAssignees.length + 1}`;
        goalAssignees.push({
            id: createGoalAssigneeId(),
            label,
            color: nextGoalAssigneeColor(),
        });
        saveGoalAssignees();
        renderGoalAssigneesPopover();
        updateGoalAssigneeSelectOptions();
    }

    function updateGoalAssigneeLabel(id, label) {
        const assignee = goalAssignees.find((item) => item.id === id);
        if (!assignee) return;
        const trimmed = label.trim();
        if (!trimmed) return;
        assignee.label = trimmed.slice(0, 30);
        saveGoalAssignees();
        updateGoalAssigneeSelectOptions();
        renderWeekGoals();
    }

    function updateGoalAssigneeColor(id, color) {
        const assignee = goalAssignees.find((item) => item.id === id);
        if (!assignee) return;
        assignee.color = color;
        saveGoalAssignees();
        renderGoalAssigneesPopover();
        renderWeekGoals();
    }

    function removeGoalAssignee(id) {
        if (goalAssignees.length <= 1) return;
        const fallbackId = goalAssignees.find((item) => item.id !== id)?.id;
        if (!fallbackId) return;
        reassignGoalsFromAssignee(id, fallbackId);
        goalAssignees = goalAssignees.filter((item) => item.id !== id);
        saveGoalAssignees();
        renderGoalAssigneesPopover();
        updateGoalAssigneeSelectOptions();
        renderWeekGoals();
    }

    function updateGoalAssigneeSelectOptions() {
        const select = container?.querySelector('.plan-week-goal-assignee-select');
        if (!select) return;
        const assignees = getGoalAssignees();
        const current = select.value;
        select.innerHTML = Object.entries(assignees).map(([key, { label }]) =>
            `<option value="${key}">${label}</option>`
        ).join('');
        select.value = normalizeGoalAssignee(current);
    }

    function closeGoalAssigneesPopover() {
        container?.querySelector('.plan-goal-assignees-popover')?.classList.add('hidden');
        container?.querySelectorAll('.plan-goal-assignee-color-popover').forEach((el) => el.remove());
    }

    function renderGoalAssigneesPopover() {
        const list = container?.querySelector('.plan-goal-assignees-list');
        if (!list) return;

        list.innerHTML = '';
        goalAssignees.forEach((assignee) => {
            const item = document.createElement('div');
            item.className = 'plan-goal-assignee-item';
            item.dataset.id = assignee.id;

            const colorBtn = document.createElement('button');
            colorBtn.type = 'button';
            colorBtn.className = 'plan-goal-assignee-color';
            colorBtn.style.background = assignee.color;
            colorBtn.title = 'Change color';
            colorBtn.setAttribute('aria-label', `Change color for ${assignee.label}`);

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'plan-goal-assignee-name';
            nameInput.value = assignee.label;
            nameInput.maxLength = 30;
            nameInput.setAttribute('aria-label', 'Name');

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'plan-goal-assignee-delete';
            deleteBtn.title = 'Remove person';
            deleteBtn.setAttribute('aria-label', `Remove ${assignee.label}`);
            deleteBtn.textContent = '×';
            deleteBtn.disabled = goalAssignees.length <= 1;

            nameInput.addEventListener('change', () => updateGoalAssigneeLabel(assignee.id, nameInput.value));
            nameInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    nameInput.blur();
                }
            });

            colorBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                container.querySelectorAll('.plan-goal-assignee-color-popover').forEach((el) => el.remove());

                const popover = document.createElement('div');
                popover.className = 'plan-goal-assignee-color-popover';
                const currentColor = assignee.color || GOAL_ASSIGNEE_PALETTE[0];
                popover.innerHTML = `
                    <div class="calendar-color-swatches">
                        ${GOAL_ASSIGNEE_PALETTE.map((color) =>
                            `<button type="button" class="calendar-color-swatch${color === currentColor ? ' selected' : ''}" data-color="${color}" style="background-color: ${color}" title="${color}"></button>`
                        ).join('')}
                    </div>
                `;
                item.appendChild(popover);

                popover.querySelectorAll('.calendar-color-swatch').forEach((swatch) => {
                    swatch.addEventListener('click', (swatchEvent) => {
                        swatchEvent.stopPropagation();
                        updateGoalAssigneeColor(assignee.id, swatch.dataset.color);
                        popover.remove();
                    });
                });
            });

            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                removeGoalAssignee(assignee.id);
            });

            item.appendChild(colorBtn);
            item.appendChild(nameInput);
            item.appendChild(deleteBtn);
            list.appendChild(item);
        });
    }

    function setupGoalAssigneesUI() {
        const manageBtn = container.querySelector('.plan-week-goal-assignees-btn');
        const popover = container.querySelector('.plan-goal-assignees-popover');
        const addBtn = container.querySelector('.plan-goal-assignee-add-btn');
        if (!manageBtn || !popover) return;

        manageBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const isHidden = popover.classList.contains('hidden');
            closeGoalAssigneesPopover();
            if (!isHidden) return;

            popover.classList.remove('hidden');
            const goalsBar = container.querySelector('.plan-week-goals');
            const btnRect = manageBtn.getBoundingClientRect();
            const anchorRect = goalsBar?.getBoundingClientRect() || container.getBoundingClientRect();
            popover.style.top = `${btnRect.bottom - anchorRect.top + 6}px`;
            popover.style.left = `${Math.max(8, btnRect.left - anchorRect.left)}px`;
            renderGoalAssigneesPopover();
        });

        addBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            addGoalAssignee();
        });

        document.addEventListener('click', (event) => {
            if (popover.classList.contains('hidden')) return;
            const target = event.target;
            if (manageBtn.contains(target) || popover.contains(target)) return;
            closeGoalAssigneesPopover();
        });
    }

    function getMondayOfWeek(date) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const weekday = d.getDay() === 0 ? 6 : d.getDay() - 1;
        d.setDate(d.getDate() - weekday);
        return d;
    }

    function formatDateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function addDays(date, days) {
        const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        next.setDate(next.getDate() + days);
        return next;
    }

    function formatMinutesAsTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        const date = new Date(2000, 0, 1, hours, mins);
        return date.toLocaleTimeString([], {
            hour: 'numeric',
            minute: mins ? '2-digit' : undefined,
        });
    }

    function isDateInVisibleWeek(dateKey) {
        const weekStartKey = formatDateKey(weekStartDate);
        const weekEndKey = formatDateKey(addDays(weekStartDate, 6));
        return dateKey >= weekStartKey && dateKey <= weekEndKey;
    }

    function noteDisplayText(note) {
        if (note.html) {
            const tmp = document.createElement('div');
            tmp.innerHTML = note.html;
            return tmp.textContent || 'Note';
        }
        return note.text || 'Note';
    }

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

    // Get holidays for a given year (cached per year/language)
    let holidayCache = {};
    function getHolidays(year) {
        const cacheKey = `${year}-${currentLanguage}`;
        if (holidayCache[cacheKey]) return holidayCache[cacheKey];

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
            // Danish holidays
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
            // English holidays (universal)
            holidays[formatKey(addDays(easter, -7))] = 'Palm Sunday';
            holidays[formatKey(addDays(easter, -3))] = 'Maundy Thursday';
            holidays[formatKey(addDays(easter, -2))] = 'Good Friday';
            holidays[formatKey(easter)] = 'Easter Sunday';
            holidays[formatKey(addDays(easter, 1))] = 'Easter Monday';
            holidays[`${year}-01-01`] = "New Year's Day";
            holidays[`${year}-12-24`] = 'Christmas Eve';
            holidays[`${year}-12-25`] = 'Christmas Day';
        }

        holidayCache[cacheKey] = holidays;
        return holidays;
    }

    const UI_TEXT = {
        da: {
            settings: 'Indstillinger', theme: 'Tema', language: 'Sprog',
            newItems: 'Nye elementer:', addGroup: 'Tilføj gruppe', personal: 'Personligt',
            work: 'Arbejde', data: 'Data', exportData: 'Eksporter', importData: 'Importer'
        },
        en: {
            settings: 'Settings', theme: 'Theme', language: 'Language',
            newItems: 'New items:', addGroup: 'Add Group', personal: 'Personal',
            work: 'Work', data: 'Data', exportData: 'Export', importData: 'Import'
        }
    };

    const DEFAULT_GROUPS = [
        { id: 'personal', translationKey: 'personal', color: '#2a9d8f', visible: true },
        { id: 'work', translationKey: 'work', color: '#d4605a', visible: true }
    ];

    // Storage keys
    const NOTES_KEY = STORAGE_PREFIX + 'freeform-notes';
    const LINES_KEY = STORAGE_PREFIX + 'freeform-lines';
    const GROUPS_KEY = STORAGE_PREFIX + 'groups';
    const ACTIVE_GROUP_KEY = STORAGE_PREFIX + 'active-group';
    // Calendar sync keys
    const CALENDARS_KEY = STORAGE_PREFIX + 'calendars'; // Array of {id, name, url, fontFamily, fontColor, lineColor}
    const CALENDAR_LAST_SYNC_KEY = STORAGE_PREFIX + 'calendar-last-sync';
    const TASK_CHIP_KEY = STORAGE_PREFIX + 'task-chip';
    const PLAN_CHIP_PALETTE = [
        '#7da9c8', '#8eb5b0', '#8cb89c', '#d4ba6a', '#d4a5a8', '#d99a6c', '#d4605a', '#a896c0',
    ];
    // Use shared keys for theme and language (no prefix) so they sync with main app
    const SHARED_LANGUAGE_KEY = 'language';

    // Calendar sync state - supports multiple calendars with per-calendar styling
    let calendars = []; // [{id, name, url, fontFamily, fontColor, lineColor}, ...]
    let calendarLastSync = null;
    let taskChipSettings = { visible: true, fontColor: null };
    let refreshCalendarToggles = () => {};
    let syncAllCalendarsFn = async () => {};
    let renderCalendarListFn = () => {};

    function loadTaskChipSettings() {
        try {
            const stored = localStorage.getItem(TASK_CHIP_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                taskChipSettings = {
                    visible: parsed.visible !== false,
                    fontColor: parsed.fontColor || null,
                };
            }
        } catch {
            taskChipSettings = { visible: true, fontColor: null };
        }
    }

    function saveTaskChipSettings() {
        try {
            localStorage.setItem(TASK_CHIP_KEY, JSON.stringify(taskChipSettings));
        } catch {
            /* private mode */
        }
    }

    function hasTaskPlannerEntries() {
        return freeformNotes.some((note) => note.source === 'task')
            || freeformLines.some((line) => line.source === 'task');
    }

    function getUsedChipColors() {
        const used = new Set();
        calendars.forEach((cal) => {
            if (cal.fontColor) used.add(cal.fontColor.toLowerCase());
        });
        return used;
    }

    function getFirstUnusedChipColor() {
        const used = getUsedChipColors();
        return PLAN_CHIP_PALETTE.find((color) => !used.has(color.toLowerCase()))
            || PLAN_CHIP_PALETTE[0];
    }

    function getTaskChipColor() {
        return taskChipSettings.fontColor || getFirstUnusedChipColor();
    }

    function applyTaskColorToAllNotes(color) {
        freeformNotes.forEach((note) => {
            if (note.source === 'task') note.fontColor = color;
        });
        freeformLines.forEach((line) => {
            if (line.source === 'task') {
                line.color = color;
                line.fontColor = color;
            }
        });
    }

    function ensureTaskChipColor() {
        if (!taskChipSettings.fontColor) {
            taskChipSettings.fontColor = getFirstUnusedChipColor();
            saveTaskChipSettings();
        }
    }

    function migrateTaskChipColorIfNeeded() {
        if (!hasTaskPlannerEntries() || taskChipSettings.fontColor) return;
        ensureTaskChipColor();
        applyTaskColorToAllNotes(taskChipSettings.fontColor);
        saveData();
    }

    function getEnkeltTasksChipLabel() {
        return currentLanguage === 'da' ? 'Enkelt-opgaver' : 'Enkelt tasks';
    }

    function appendChipColorPopover(colorWrapper, colorDot, currentColor, applyColor) {
        container.querySelectorAll('.calendar-color-popover').forEach((p) => p.remove());

        const popover = document.createElement('div');
        popover.className = 'calendar-color-popover';
        const swatchesHTML = PLAN_CHIP_PALETTE.map((c) =>
            `<button type="button" class="calendar-color-swatch${c === currentColor ? ' selected' : ''}" data-color="${c}" style="background-color: ${c}" title="${c}"></button>`
        ).join('');
        popover.innerHTML = `
            <div class="calendar-color-swatches">
                ${swatchesHTML}
                <label class="calendar-color-swatch calendar-color-swatch-custom" title="More colors…">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/></svg>
                    <input type="color" class="calendar-color-custom-input" value="${currentColor}">
                </label>
            </div>
            <div class="calendar-color-hex-row">
                <span class="calendar-color-hex-preview" style="background: ${currentColor}"></span>
                <input type="text" class="calendar-color-hex-input" value="${currentColor}" maxlength="7" spellcheck="false" placeholder="#000000">
            </div>
        `;
        colorWrapper.appendChild(popover);

        popover.querySelectorAll('.calendar-color-swatch:not(.calendar-color-swatch-custom)').forEach((swatch) => {
            swatch.addEventListener('click', (ev) => {
                ev.stopPropagation();
                applyColor(swatch.dataset.color);
                popover.remove();
            });
        });

        const customInput = popover.querySelector('.calendar-color-custom-input');
        const hexInput = popover.querySelector('.calendar-color-hex-input');
        const hexPreview = popover.querySelector('.calendar-color-hex-preview');

        customInput?.addEventListener('input', (ev) => {
            const c = ev.target.value;
            hexInput.value = c;
            hexPreview.style.background = c;
        });

        customInput?.addEventListener('change', (ev) => {
            applyColor(ev.target.value);
            popover.remove();
        });

        hexInput?.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                const c = hexInput.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(c)) {
                    applyColor(c);
                    popover.remove();
                }
            }
        });
    }

    function renderEnkeltTasksChip(togglesContainer, eyeOpenSVG, eyeClosedSVG) {
        if (!hasTaskPlannerEntries()) return;

        if (taskChipSettings.visible === undefined) taskChipSettings.visible = true;
        const chipColor = getTaskChipColor();

        const chip = document.createElement('div');
        chip.className = 'plan-calendar-toggle plan-task-chip' + (taskChipSettings.visible ? '' : ' hidden-cal');
        chip.title = 'Toggle Enkelt tasks • Change color';

        chip.innerHTML = `
            <span class="calendar-toggle-eye">${taskChipSettings.visible ? eyeOpenSVG : eyeClosedSVG}</span>
            <span class="calendar-name">${getEnkeltTasksChipLabel()}</span>
            <span class="calendar-toggle-color" title="Change task color">
                <span class="calendar-color-dot" style="background: ${chipColor}"></span>
            </span>
        `;

        const eyeSpan = chip.querySelector('.calendar-toggle-eye');
        eyeSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            taskChipSettings.visible = !taskChipSettings.visible;
            saveTaskChipSettings();
            renderFreeformElements();
            eyeSpan.innerHTML = taskChipSettings.visible ? eyeOpenSVG : eyeClosedSVG;
            chip.classList.toggle('hidden-cal', !taskChipSettings.visible);
        });

        const colorWrapper = chip.querySelector('.calendar-toggle-color');
        const colorDot = chip.querySelector('.calendar-color-dot');

        function applyTaskChipColor(newColor) {
            taskChipSettings.fontColor = newColor;
            colorDot.style.background = newColor;
            saveTaskChipSettings();
            applyTaskColorToAllNotes(newColor);
            saveData();
            renderFreeformElements();
        }

        colorDot.addEventListener('click', (e) => {
            e.stopPropagation();
            appendChipColorPopover(colorWrapper, colorDot, getTaskChipColor(), applyTaskChipColor);
        });

        togglesContainer.appendChild(chip);
    }

    function init(containerElement) {
        if (isInitialized) return;
        container = containerElement;

        // Create DOM structure
        container.innerHTML = getPlanHTML();

        // Get DOM references
        calendarContainer = container.querySelector('.plan-calendar-container');
        canvasLayer = container.querySelector('.plan-canvas-layer');

        // Initialize
        loadData();
        loadLanguage();
        updateGoalAssigneeSelectOptions();
        setupEventListeners();
        setupGoalAssigneesUI();
        setupCanvasInteraction();
        renderCalendar();
        updatePeriodDisplay();
        updateViewModeButtons();

        // Delay initial render of freeform elements to ensure DOM is fully laid out
        setTimeout(() => {
            renderFreeformElements();
            if (calendarViewMode === 'week') scrollWeekViewToCurrentTime();
        }, 100);
        setupToolbarListeners();
        setupResizeObserver();
        onWindowResize = () => scheduleLayoutRefresh();
        window.addEventListener('resize', onWindowResize);

        isInitialized = true;
    }

    function setupResizeObserver() {
        const observeTarget = calendarContainer || container;
        if (!observeTarget || typeof ResizeObserver === 'undefined') return;

        let lastWidth = 0;
        resizeObserver = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width ?? 0;
            if (width <= 0) return;

            const widthDelta = lastWidth > 0 ? Math.abs(width - lastWidth) : 0;
            lastWidth = width;

            if (widthDelta > 200 && calendarViewMode === 'months') {
                renderCalendar();
            }
            scheduleLayoutRefresh();
        });
        resizeObserver.observe(observeTarget);
    }

    function scheduleLayoutRefresh() {
        if (!isInitialized || isDragInProgress) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            renderFreeformElements();
        }, 50);
    }

    function destroy() {
        if (!isInitialized) return;
        resizeObserver?.disconnect();
        resizeObserver = null;
        if (onWindowResize) {
            window.removeEventListener('resize', onWindowResize);
            onWindowResize = null;
        }
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = null;
        container.innerHTML = '';
        isInitialized = false;
    }

    function getPlanHTML() {
        return `
            <div class="plan-app-container">
                <div class="plan-title-bar">
                    <div class="plan-period-nav">
                        <button class="plan-nav-btn plan-prev-period-btn" title="Previous Period">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <span class="plan-period-display">Jan – Jun 2026</span>
                        <button class="plan-nav-btn plan-today-btn hidden" title="Go to Today">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </button>
                        <button class="plan-nav-btn plan-next-period-btn" title="Next Period">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>

                    <div class="plan-view-switcher" role="group" aria-label="Calendar view">
                        <button type="button" class="plan-view-mode-btn active" data-view="months">Months</button>
                        <button type="button" class="plan-view-mode-btn" data-view="week">Week</button>
                    </div>

                    <div class="plan-undo-redo-nav">
                        <button class="plan-nav-btn plan-undo-btn" title="Undo" disabled>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
                        </button>
                        <button class="plan-nav-btn plan-redo-btn" title="Redo" disabled>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/></svg>
                        </button>
                    </div>
                    <div class="plan-calendar-sync-nav">
                        <div class="plan-calendar-toggles"></div>
                        <button class="plan-nav-btn plan-calendar-sync-all-btn" title="Sync All Calendars">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                        </button>
                        <button class="plan-nav-btn plan-calendar-add-btn" title="Add Calendar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 19h6"/><path d="M16 2v4"/><path d="M19 16v6"/><path d="M21 12.598V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8.5"/><path d="M3 10h18"/><path d="M8 2v4"/></svg>
                        </button>
                    </div>
                </div>
                <div class="plan-week-goals hidden">
                    <div class="plan-week-goals-row">
                        <span class="plan-week-goals-label">Goals:</span>
                        <button type="button" class="plan-week-goal-add-btn" title="Add goal" aria-label="Add goal">+</button>
                        <button type="button" class="plan-week-goal-assignees-btn" title="Edit people" aria-label="Edit people">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        </button>
                        <div class="plan-week-goals-list"></div>
                    </div>
                    <div class="plan-week-goal-form hidden">
                        <input type="text" class="plan-week-goal-text-input" placeholder="Goal..." maxlength="120">
                        <select class="plan-week-goal-assignee-select" aria-label="Assign to"></select>
                        <button type="button" class="plan-week-goal-save-btn">Add</button>
                        <button type="button" class="plan-week-goal-cancel-btn">Cancel</button>
                    </div>
                    <div class="plan-goal-assignees-popover hidden">
                        <div class="plan-goal-assignees-header">People</div>
                        <div class="plan-goal-assignees-list"></div>
                        <button type="button" class="plan-goal-assignee-add-btn">+ Add person</button>
                    </div>
                </div>
                <div class="plan-calendar-container">
                    <div class="plan-calendar-grid"></div>
                    <div class="plan-canvas-layer"></div>
                </div>
            </div>
            <!-- Note Toolbar -->
            <div class="plan-note-toolbar plan-inline-toolbar hidden">
                <button class="plan-toolbar-btn" data-command="bold" title="Bold">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>
                </button>
                <button class="plan-toolbar-btn" data-command="italic" title="Italic">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/></svg>
                </button>
                <button class="plan-toolbar-btn" data-command="underline" title="Underline">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/></svg>
                </button>
                <div class="plan-toolbar-divider"></div>
                <label class="plan-toolbar-color" title="Font Color">
                    <span class="plan-font-color-indicator" style="background: #333;"></span>
                    <input type="color" class="plan-font-color-picker" value="#333333">
                </label>
                <div class="plan-toolbar-color-group" title="Background Color">
                    <label class="plan-toolbar-color">
                        <span class="plan-bg-color-indicator"></span>
                        <input type="color" class="plan-bg-color-picker" value="#ffff00">
                    </label>
                    <button class="plan-toolbar-btn small plan-clear-bg-btn" title="Clear Background">×</button>
                </div>
                <div class="plan-toolbar-divider"></div>
                <label class="plan-toolbar-snap" title="Snap to date row">
                    <input type="checkbox" class="plan-note-snap-toggle" checked>
                    <span>Snap</span>
                </label>
                <button class="plan-toolbar-btn plan-delete-btn plan-note-delete-btn" title="Delete note">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
            <!-- Line Toolbar -->
            <div class="plan-line-toolbar plan-inline-toolbar hidden">
                <input type="text" class="plan-line-label-field" placeholder="Label..." title="Line label">
                <div class="plan-toolbar-divider"></div>
                <select class="plan-line-width-select" title="Line Width">
                    <option value="4">Thin</option>
                    <option value="8" selected>Medium</option>
                    <option value="14">Thick</option>
                </select>
                <label class="plan-toolbar-color" title="Line Color">
                    <span class="plan-line-color-indicator" style="background: #333;"></span>
                    <input type="color" class="plan-line-color-picker" value="#333333">
                </label>
                <button class="plan-toolbar-btn plan-delete-btn plan-line-delete-btn" title="Delete line">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
            <!-- Calendar Popover (Add/Manage Calendars) -->
            <div class="plan-calendar-popover hidden">
                <div class="plan-calendar-popover-header">
                    Calendars
                    <span class="plan-calendar-help-icon">?</span>
                </div>
                <div class="plan-calendar-help-content hidden">
                    <p><strong>How to add a calendar:</strong></p>
                    <ol>
                        <li>In Google Calendar, click the ⋮ menu next to a calendar</li>
                        <li>Select "Settings and sharing"</li>
                        <li>Scroll to "Secret address in iCal format"</li>
                        <li>Copy the URL and paste it below</li>
                    </ol>
                    <p>For other calendars, find the ICS/iCal URL in settings.</p>
                </div>
                <div class="plan-calendar-popover-body">
                    <div class="plan-calendar-list"></div>
                    <div class="plan-calendar-add-form">
                        <input type="text" class="plan-calendar-name-input" placeholder="Calendar name">
                        <input type="text" class="plan-calendar-url-input" placeholder="ICS URL (https:// or webcal://)">
                        <button class="plan-calendar-add-save-btn">Add Calendar</button>
                    </div>
                    <p class="plan-calendar-hint">Events whose description starts with ENKELT or REDD-DO as the first word will be shown</p>
                    <div class="plan-calendar-status"></div>
                </div>
            </div>
        `;
    }

    function cleanupPhantomLines() {
        const before = freeformLines.length;
        freeformLines = freeformLines.filter((line) => {
            if (line.source === 'calendar' || line.source === 'task') return true;
            if (line.label?.trim()) return true;
            // Unlabeled date-keyed lines were accidental canvas artifacts (e.g. goal drags).
            if (line.startDate && line.endDate) return false;
            return true;
        });
        if (freeformLines.length !== before) {
            saveData();
        }
    }

    function migrateMultiDayTaskNotes() {
        const taskIds = [...new Set(
            freeformNotes.filter((note) => note.source === 'task' && note.taskId).map((note) => note.taskId)
        )];
        let changed = false;

        taskIds.forEach((taskId) => {
            const notes = freeformNotes.filter((note) => note.taskId === taskId && note.dateKey);
            if (notes.length <= 1) return;

            const keys = notes.map((note) => note.dateKey).sort();
            const { text, fontColor } = notes[0];
            freeformNotes = freeformNotes.filter((note) => note.taskId !== taskId);
            freeformLines = freeformLines.filter((line) => line.taskId !== taskId);
            freeformLines.push({
                id: `task-line-${taskId}`,
                label: text,
                startDate: keys[0],
                endDate: keys[keys.length - 1],
                source: 'task',
                taskId,
                color: fontColor || getTaskChipColor(),
                fontColor: fontColor || getTaskChipColor(),
                fontFamily: 'Inter',
                width: 8,
                isAllDay: true,
            });
            changed = true;
        });

        if (changed) saveData();
    }

    function isCalendarPlannerItem(item) {
        return item?.source === 'calendar' || item?.isCalendarEvent;
    }

    function dedupeCalendars() {
        const seenUrls = new Set();
        const seenIds = new Set();
        const deduped = [];

        calendars.forEach((cal) => {
            const urlKey = (cal.url || '').trim().toLowerCase();
            if (urlKey && seenUrls.has(urlKey)) return;
            if (cal.id && seenIds.has(cal.id)) return;
            if (urlKey) seenUrls.add(urlKey);
            if (cal.id) seenIds.add(cal.id);
            deduped.push(cal);
        });

        if (deduped.length !== calendars.length) {
            calendars = deduped;
            localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
        }
    }

    function dedupeCalendarPlannerItems() {
        let changed = false;

        const seenNoteKeys = new Set();
        freeformNotes = freeformNotes.filter((note) => {
            if (!isCalendarPlannerItem(note)) return true;
            if (!note.source) {
                note.source = 'calendar';
                changed = true;
            }
            const key = note.id || `${note.dateKey}|${note.text}|${note.calendarId || ''}`;
            if (seenNoteKeys.has(key)) {
                changed = true;
                return false;
            }
            seenNoteKeys.add(key);
            return true;
        });

        const seenLineKeys = new Set();
        freeformLines = freeformLines.filter((line) => {
            if (!isCalendarPlannerItem(line)) return true;
            if (!line.source) {
                line.source = 'calendar';
                changed = true;
            }
            const key = line.id || `${line.startDate}|${line.endDate}|${line.label}|${line.calendarId || ''}`;
            if (seenLineKeys.has(key)) {
                changed = true;
                return false;
            }
            seenLineKeys.add(key);
            return true;
        });

        if (changed) saveData();
    }
    function loadData() {
        try {
            const storedNotes = localStorage.getItem(NOTES_KEY);
            if (storedNotes) freeformNotes = JSON.parse(storedNotes);
            const storedLines = localStorage.getItem(LINES_KEY);
            if (storedLines) freeformLines = JSON.parse(storedLines);
            cleanupPhantomLines();
            const storedGroups = localStorage.getItem(GROUPS_KEY);
            if (storedGroups) groups = JSON.parse(storedGroups);
            else groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
            const storedActiveGroup = localStorage.getItem(ACTIVE_GROUP_KEY);
            if (storedActiveGroup) activeGroup = storedActiveGroup;

            console.log('[Plan] Loaded data:', {
                notes: freeformNotes.length,
                lines: freeformLines.map(l => ({ id: l.id, x1: Math.round(l.x1), x2: Math.round(l.x2), label: l.label }))
            });

            // Load calendar metadata (multiple calendars with per-calendar styling)
            const storedCalendars = localStorage.getItem(CALENDARS_KEY);
            if (storedCalendars) calendars = JSON.parse(storedCalendars);
            dedupeCalendars();
            dedupeCalendarPlannerItems();
            const storedLastSync = localStorage.getItem(CALENDAR_LAST_SYNC_KEY);
            if (storedLastSync) calendarLastSync = storedLastSync;

            const storedViewMode = localStorage.getItem(VIEW_MODE_KEY);
            if (storedViewMode === 'week' || storedViewMode === 'months') {
                calendarViewMode = storedViewMode;
            }
            if (calendarViewMode === 'week') {
                weekStartDate = getMondayOfWeek(new Date());
            }

            loadWeekGoals();
            loadGoalAssignees();
            loadTaskChipSettings();
            migrateMultiDayTaskNotes();
            migrateTaskChipColorIfNeeded();
            const calendarEventNotes = freeformNotes.filter(n => n.source === 'calendar').length;
            const calendarEventLines = freeformLines.filter(l => l.source === 'calendar').length;
            console.log('[Plan] Loaded data:', {
                calendars: calendars.length,
                totalNotes: freeformNotes.length,
                totalLines: freeformLines.length,
                calendarEventNotes,
                calendarEventLines
            });
        } catch (e) {
            console.error('Failed to load plan data:', e);
            freeformNotes = []; freeformLines = [];
            groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
        }
    }

    function saveData() {
        try {
            localStorage.setItem(NOTES_KEY, JSON.stringify(freeformNotes));
            localStorage.setItem(LINES_KEY, JSON.stringify(freeformLines));
            localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
            localStorage.setItem(ACTIVE_GROUP_KEY, activeGroup);

            console.log('[Plan] Saved data:', {
                notes: freeformNotes.length,
                lines: freeformLines.map(l => ({ id: l.id, x1: Math.round(l.x1), x2: Math.round(l.x2), label: l.label }))
            });
        } catch (e) { console.error('Failed to save plan data:', e); }
    }

    function loadLanguage() {
        // Read language from shared key (set by main app)
        const saved = localStorage.getItem(SHARED_LANGUAGE_KEY);
        if (saved) currentLanguage = saved;
    }

    function pushHistory() {
        undoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        const undoBtn = container.querySelector('.plan-undo-btn');
        const redoBtn = container.querySelector('.plan-redo-btn');
        if (undoBtn) undoBtn.disabled = undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    }

    function loadWeekGoals() {
        try {
            const stored = localStorage.getItem(WEEK_GOALS_KEY);
            weekGoalsByWeek = stored ? JSON.parse(stored) : {};
        } catch {
            weekGoalsByWeek = {};
        }

        let migrated = false;
        for (const weekKey of Object.keys(weekGoalsByWeek)) {
            for (const goal of weekGoalsByWeek[weekKey] || []) {
                const normalized = normalizeGoalAssignee(goal.assignee);
                if (normalized !== goal.assignee) {
                    goal.assignee = normalized;
                    migrated = true;
                }
            }
        }
        if (migrated) saveWeekGoals();
    }

    function saveWeekGoals() {
        try {
            localStorage.setItem(WEEK_GOALS_KEY, JSON.stringify(weekGoalsByWeek));
        } catch {
            /* private mode */
        }
    }

    function getCurrentWeekKey() {
        return formatDateKey(weekStartDate);
    }

    function getGoalsForCurrentWeek() {
        const key = getCurrentWeekKey();
        if (!Array.isArray(weekGoalsByWeek[key])) {
            weekGoalsByWeek[key] = [];
        }
        return weekGoalsByWeek[key];
    }

    function createGoalId() {
        return `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function hideWeekGoalForm() {
        editingGoalId = null;
        const form = container.querySelector('.plan-week-goal-form');
        const input = container.querySelector('.plan-week-goal-text-input');
        const assigneeSelect = container.querySelector('.plan-week-goal-assignee-select');
        if (form) form.classList.add('hidden');
        if (input) input.value = '';
        if (assigneeSelect) assigneeSelect.value = getDefaultGoalAssigneeId();
        updateGoalFormUI();
        renderWeekGoals();
    }

    function updateGoalFormUI() {
        const saveBtn = container.querySelector('.plan-week-goal-save-btn');
        if (saveBtn) {
            saveBtn.textContent = editingGoalId ? 'Save' : 'Add';
        }
    }

    function showWeekGoalForm(goal = null) {
        const form = container.querySelector('.plan-week-goal-form');
        const input = container.querySelector('.plan-week-goal-text-input');
        const assigneeSelect = container.querySelector('.plan-week-goal-assignee-select');
        if (!form || !input || !assigneeSelect) return;

        editingGoalId = goal?.id ?? null;
        input.value = goal?.text || '';
        assigneeSelect.value = goal?.assignee
            ? normalizeGoalAssignee(goal.assignee)
            : getDefaultGoalAssigneeId();
        updateGoalFormUI();
        form.classList.remove('hidden');
        input.focus();
        if (goal) {
            input.select();
        }
        renderWeekGoals();
    }

    function startEditingWeekGoal(goalId) {
        const goal = getGoalsForCurrentWeek().find((item) => item.id === goalId);
        if (goal) {
            showWeekGoalForm(goal);
        }
    }

    function saveWeekGoalFromForm() {
        const input = container.querySelector('.plan-week-goal-text-input');
        const assigneeSelect = container.querySelector('.plan-week-goal-assignee-select');
        const text = input?.value || '';
        const assignee = assigneeSelect?.value || getDefaultGoalAssigneeId();

        if (editingGoalId) {
            updateWeekGoal(editingGoalId, text, assignee);
            return;
        }

        addWeekGoal(text, assignee);
    }

    function addWeekGoal(text, assignee) {
        const trimmed = text.trim();
        if (!trimmed) return;

        const assigneeKey = normalizeGoalAssignee(assignee);
        getGoalsForCurrentWeek().push({
            id: createGoalId(),
            text: trimmed,
            assignee: assigneeKey,
            dateKey: null,
        });
        saveWeekGoals();
        hideWeekGoalForm();
        renderWeekGoals();
    }

    function updateWeekGoal(goalId, text, assignee) {
        const trimmed = text.trim();
        if (!trimmed) return;

        const goal = getGoalsForCurrentWeek().find((item) => item.id === goalId);
        if (!goal) return;

        goal.text = trimmed;
        goal.assignee = normalizeGoalAssignee(assignee);
        saveWeekGoals();
        hideWeekGoalForm();
    }

    function removeWeekGoal(goalId) {
        const key = getCurrentWeekKey();
        weekGoalsByWeek[key] = getGoalsForCurrentWeek().filter((goal) => goal.id !== goalId);
        saveWeekGoals();
        if (editingGoalId === goalId) {
            editingGoalId = null;
            const form = container.querySelector('.plan-week-goal-form');
            const input = container.querySelector('.plan-week-goal-text-input');
            const assigneeSelect = container.querySelector('.plan-week-goal-assignee-select');
            form?.classList.add('hidden');
            if (input) input.value = '';
            if (assigneeSelect) assigneeSelect.value = getDefaultGoalAssigneeId();
            updateGoalFormUI();
        }
        renderWeekGoals();
    }

    function moveWeekGoal(goalId, dateKey) {
        const goal = getGoalsForCurrentWeek().find((item) => item.id === goalId);
        if (!goal) return;

        const nextDateKey = dateKey || null;
        if (goal.dateKey === nextDateKey) return;

        goal.dateKey = nextDateKey;
        saveWeekGoals();
        renderWeekGoals();
    }

    function findWeekGoalDropTarget(clientX, clientY) {
        const goalsBar = container.querySelector('.plan-week-goals');
        if (goalsBar) {
            const barRect = goalsBar.getBoundingClientRect();
            if (
                clientX >= barRect.left &&
                clientX <= barRect.right &&
                clientY >= barRect.top &&
                clientY <= barRect.bottom
            ) {
                return { dateKey: null, element: goalsBar.querySelector('.plan-week-goals-list') };
            }
        }

        const columns = container.querySelectorAll('.plan-week-day-column');
        let bestMatch = null;
        let bestDistance = Infinity;

        columns.forEach((col) => {
            const header = col.querySelector('.plan-week-day-header');
            const goalsRow = col.querySelector('.plan-week-day-goals');
            if (!header || !goalsRow) return;

            const colRect = col.getBoundingClientRect();
            const headerRect = header.getBoundingClientRect();
            const snapLineY = headerRect.bottom;
            const zoneTop = headerRect.top;
            const zoneBottom = snapLineY + 56;

            if (
                clientX < colRect.left ||
                clientX > colRect.right ||
                clientY < zoneTop ||
                clientY > zoneBottom
            ) {
                return;
            }

            const distance = Math.abs(clientY - snapLineY);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestMatch = {
                    dateKey: col.dataset.dateKey,
                    element: goalsRow,
                };
            }
        });

        return bestMatch;
    }

    function setWeekGoalDropHighlight(element) {
        if (weekGoalDropHighlightEl === element) return;
        weekGoalDropHighlightEl?.classList.remove('plan-week-goal-drop-highlight');
        weekGoalDropHighlightEl = element || null;
        weekGoalDropHighlightEl?.classList.add('plan-week-goal-drop-highlight');
    }

    function weekHasPlacedGoals() {
        return getGoalsForCurrentWeek().some((goal) => goal.dateKey);
    }

    function syncWeekGoalGutterSpacer() {
        const dayGoalRows = container.querySelectorAll('.plan-week-day-goals');
        const spacer = container.querySelector('.plan-week-day-goals-spacer');
        if (!spacer) return;

        dayGoalRows.forEach((row) => {
            row.style.minHeight = '';
            row.classList.remove('plan-week-day-goals--synced');
        });

        if (!weekHasPlacedGoals()) {
            spacer.style.display = 'none';
            spacer.style.minHeight = '';
            return;
        }

        let maxHeight = 0;
        dayGoalRows.forEach((row) => {
            if (row.childElementCount > 0) {
                maxHeight = Math.max(maxHeight, row.offsetHeight);
            }
        });

        if (maxHeight <= 0) return;

        spacer.style.display = 'block';
        spacer.style.minHeight = `${maxHeight}px`;

        dayGoalRows.forEach((row) => {
            row.classList.add('plan-week-day-goals--synced');
            row.style.minHeight = `${maxHeight}px`;
        });
    }

    function clearWeekGoalDropHighlight() {
        setWeekGoalDropHighlight(null);
    }

    function setupWeekGoalPointerDrag(pill, goal) {
        pill.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest('.plan-week-goal-remove')) return;

            event.preventDefault();
            event.stopPropagation();

            const startX = event.clientX;
            const startY = event.clientY;
            let dragging = false;
            let dragClone = null;

            const cleanup = () => {
                isWeekGoalDragInProgress = false;
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.removeEventListener('pointercancel', onPointerUp);
                dragClone?.remove();
                pill.classList.remove('plan-week-goal-pill--source-hidden');
                container.querySelectorAll('.plan-week-day-goals').forEach((row) => {
                    row.classList.remove('plan-week-goal-drop-active');
                });
                clearWeekGoalDropHighlight();
            };

            const onPointerMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const deltaY = moveEvent.clientY - startY;

                if (!dragging) {
                    if (Math.hypot(deltaX, deltaY) < GOAL_DRAG_THRESHOLD_PX) return;

                    dragging = true;
                    isWeekGoalDragInProgress = true;
                    moveEvent.preventDefault();
                    moveEvent.stopPropagation();
                    pill.setPointerCapture(event.pointerId);

                    dragClone = pill.cloneNode(true);
                    dragClone.classList.add('plan-week-goal-pill--dragging');
                    dragClone.style.width = `${pill.offsetWidth}px`;
                    document.body.appendChild(dragClone);
                    pill.classList.add('plan-week-goal-pill--source-hidden');
                    container.querySelectorAll('.plan-week-day-goals').forEach((row) => {
                        row.classList.add('plan-week-goal-drop-active');
                    });
                }

                dragClone.style.left = `${moveEvent.clientX - dragClone.offsetWidth / 2}px`;
                dragClone.style.top = `${moveEvent.clientY - dragClone.offsetHeight / 2}px`;

                const dropTarget = findWeekGoalDropTarget(moveEvent.clientX, moveEvent.clientY);
                setWeekGoalDropHighlight(dropTarget?.element || null);
            };

            const onPointerUp = (upEvent) => {
                if (dragging) {
                    upEvent.preventDefault();
                    if (pill.hasPointerCapture?.(event.pointerId)) {
                        pill.releasePointerCapture(event.pointerId);
                    }
                    const dropTarget = findWeekGoalDropTarget(upEvent.clientX, upEvent.clientY);
                    if (dropTarget) {
                        moveWeekGoal(goal.id, dropTarget.dateKey);
                    } else {
                        renderWeekGoals();
                    }
                } else if (!event.target.closest('.plan-week-goal-remove')) {
                    startEditingWeekGoal(goal.id);
                }

                cleanup();
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            document.addEventListener('pointercancel', onPointerUp);
        });

        pill.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });
    }

    function createWeekGoalPill(goal) {
        const assigneeKey = normalizeGoalAssignee(goal.assignee);
        const assignee = getGoalAssignees()[assigneeKey];
        const pill = document.createElement('div');
        pill.className = 'plan-week-goal-pill';
        if (goal.id === editingGoalId) {
            pill.classList.add('plan-week-goal-pill--editing');
        }
        pill.dataset.goalId = goal.id;
        pill.setAttribute('role', 'button');
        pill.tabIndex = 0;
        pill.title = 'Drag to a day or click to edit';

        const textEl = document.createElement('span');
        textEl.className = 'plan-week-goal-pill-text';
        textEl.textContent = goal.text;

        const assigneeEl = document.createElement('span');
        assigneeEl.className = 'plan-week-goal-pill-assignee';
        assigneeEl.textContent = assignee?.short || '?';
        assigneeEl.title = assignee?.label || 'Person';
        applyGoalAssigneeStyles(pill, assigneeEl, assignee);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'plan-week-goal-remove';
        removeBtn.setAttribute('aria-label', 'Remove goal');
        removeBtn.textContent = '×';

        removeBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            removeWeekGoal(goal.id);
        });
        removeBtn.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });

        setupWeekGoalPointerDrag(pill, goal);

        pill.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                startEditingWeekGoal(goal.id);
            }
        });

        pill.appendChild(textEl);
        pill.appendChild(assigneeEl);
        pill.appendChild(removeBtn);
        return pill;
    }

    function renderWeekGoals() {
        if (calendarViewMode !== 'week') return;

        const goalsBar = container.querySelector('.plan-week-goals');
        const list = container.querySelector('.plan-week-goals-list');
        if (!goalsBar || !list) return;

        list.innerHTML = '';
        container.querySelectorAll('.plan-week-day-goals').forEach((row) => {
            row.innerHTML = '';
        });

        getGoalsForCurrentWeek().forEach((goal) => {
            const pill = createWeekGoalPill(goal);
            if (goal.dateKey) {
                const dayGoals = container.querySelector(
                    `.plan-week-day-goals[data-date-key="${goal.dateKey}"]`
                );
                if (dayGoals) {
                    dayGoals.appendChild(pill);
                    return;
                }
                goal.dateKey = null;
            }
            list.appendChild(pill);
        });

        requestAnimationFrame(() => syncWeekGoalGutterSpacer());
    }

    function updateWeekGoalsVisibility() {
        const goalsBar = container.querySelector('.plan-week-goals');
        if (!goalsBar) return;

        const showGoals = calendarViewMode === 'week';
        goalsBar.classList.toggle('hidden', !showGoals);
        if (showGoals) {
            renderWeekGoals();
        } else {
            hideWeekGoalForm();
        }
    }

    function updateViewModeButtons() {
        container.querySelectorAll('.plan-view-mode-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.view === calendarViewMode);
        });
        calendarContainer?.classList.toggle('plan-week-mode', calendarViewMode === 'week');
        updateWeekGoalsVisibility();
    }

    function setCalendarViewMode(mode) {
        if (mode !== 'months' && mode !== 'week') return;
        if (calendarViewMode === mode) return;

        calendarViewMode = mode;
        if (mode === 'week') {
            weekStartDate = getMondayOfWeek(new Date());
        }
        try {
            localStorage.setItem(VIEW_MODE_KEY, mode);
        } catch {
            /* private mode */
        }

        updateViewModeButtons();
        renderCalendar();
        renderFreeformElements();
        updatePeriodDisplay();
        if (calendarContainer) {
            calendarContainer.scrollLeft = 0;
        }
        if (mode === 'week') {
            requestAnimationFrame(() => scrollWeekViewToCurrentTime());
        }
    }

    // Calendar functions
    function updatePeriodDisplay() {
        const display = container.querySelector('.plan-period-display');
        const todayBtn = container.querySelector('.plan-today-btn');

        if (calendarViewMode === 'week') {
            const weekEnd = addDays(weekStartDate, 6);
            const months = currentLanguage === 'da' ? MONTHS_DA : MONTHS_EN;
            const startLabel = `${weekStartDate.getDate()} ${months[weekStartDate.getMonth()].slice(0, 3)}`;
            const endLabel = `${weekEnd.getDate()} ${months[weekEnd.getMonth()].slice(0, 3)}`;

            if (weekStartDate.getFullYear() === weekEnd.getFullYear()) {
                display.textContent = `${startLabel} – ${endLabel} ${weekStartDate.getFullYear()}`;
            } else {
                display.textContent = `${startLabel} ${weekStartDate.getFullYear()} – ${endLabel} ${weekEnd.getFullYear()}`;
            }

            if (todayBtn) {
                const todayMonday = getMondayOfWeek(new Date());
                const isCurrentWeek =
                    formatDateKey(todayMonday) === formatDateKey(weekStartDate);
                todayBtn.classList.toggle('hidden', isCurrentWeek);
            }
            return;
        }

        const grid = container.querySelector('.plan-calendar-grid');
        const columns = grid.querySelectorAll('.plan-month-column');

        if (columns.length === 0) {
            display.textContent = '';
            return;
        }

        // Find visible columns based on scroll position
        const scrollLeft = calendarContainer.scrollLeft;
        const containerWidth = calendarContainer.clientWidth;
        const scrollRight = scrollLeft + containerWidth;

        let firstVisible = null;
        let lastVisible = null;

        columns.forEach(col => {
            const colLeft = col.offsetLeft;
            const colRight = colLeft + col.offsetWidth;

            // Check if column is at least partially visible
            if (colRight > scrollLeft && colLeft < scrollRight) {
                if (!firstVisible) firstVisible = col;
                lastVisible = col;
            }
        });

        if (!firstVisible || !lastVisible) {
            firstVisible = columns[0];
            lastVisible = columns[columns.length - 1];
        }

        const firstMonth = parseInt(firstVisible.dataset.month);
        const firstYear = parseInt(firstVisible.dataset.year);
        const lastMonth = parseInt(lastVisible.dataset.month);
        const lastYear = parseInt(lastVisible.dataset.year);

        const months = currentLanguage === 'da' ? MONTHS_DA : MONTHS_EN;
        const firstMonthShort = months[firstMonth].slice(0, 3);
        const lastMonthShort = months[lastMonth].slice(0, 3);

        // Format: "Jan - Jun 2026" or "Dec 2025 - Jan 2026" if spanning years
        // On mobile, drop the year when same year to save space
        const isMobile = window.innerWidth <= 768;
        if (firstYear === lastYear) {
            display.textContent = isMobile
                ? `${firstMonthShort} – ${lastMonthShort}`
                : `${firstMonthShort} – ${lastMonthShort} ${firstYear}`;
        } else {
            display.textContent = `${firstMonthShort} ${firstYear} – ${lastMonthShort} ${lastYear}`;
        }

        // Show/hide "Go to Today" button based on whether today's month is visible
        if (todayBtn) {
            const today = new Date();
            const todayMonth = today.getMonth();
            const todayYear = today.getFullYear();

            // Check if today's month is in the visible range
            let isTodayVisible = false;
            columns.forEach(col => {
                const m = parseInt(col.dataset.month);
                const y = parseInt(col.dataset.year);
                const colLeft = col.offsetLeft;
                const colRight = colLeft + col.offsetWidth;

                if (m === todayMonth && y === todayYear && colRight > scrollLeft && colLeft < scrollRight) {
                    isTodayVisible = true;
                }
            });

            if (isTodayVisible) {
                todayBtn.classList.add('hidden');
            } else {
                todayBtn.classList.remove('hidden');
            }
        }
    }

    function renderCalendar() {
        const grid = container.querySelector('.plan-calendar-grid');
        grid.innerHTML = '';
        grid.classList.toggle('plan-week-grid', calendarViewMode === 'week');

        if (calendarViewMode === 'week') {
            renderWeekView(grid);
            renderWeekGoals();
            return;
        }

        // Render MONTHS_TO_RENDER months starting from startMonth/startYear
        let month = startMonth;
        let year = startYear;

        for (let i = 0; i < MONTHS_TO_RENDER; i++) {
            grid.appendChild(createMonthColumn(month, year));
            month++;
            if (month > 11) {
                month = 0;
                year++;
            }
        }

        // Update the grid template for the number of months
        grid.style.gridTemplateColumns = `repeat(${MONTHS_TO_RENDER}, 240px)`;
    }

    function renderWeekView(grid) {
        grid.style.gridTemplateColumns = `36px repeat(7, minmax(0, 1fr))`;
        grid.appendChild(createWeekTimeGutter());

        for (let i = 0; i < 7; i++) {
            grid.appendChild(createWeekDayColumn(addDays(weekStartDate, i)));
        }
    }

    function createWeekTimeGutter() {
        const gutter = document.createElement('div');
        gutter.className = 'plan-week-time-gutter';

        const headerSpacer = document.createElement('div');
        headerSpacer.className = 'plan-week-time-gutter-header';
        gutter.appendChild(headerSpacer);

        const dayGoalsSpacer = document.createElement('div');
        dayGoalsSpacer.className = 'plan-week-day-goals-spacer';
        gutter.appendChild(dayGoalsSpacer);

        const alldaySpacer = document.createElement('div');
        alldaySpacer.className = 'plan-week-allday-spacer';
        gutter.appendChild(alldaySpacer);

        const hours = document.createElement('div');
        hours.className = 'plan-week-time-hours';
        for (let hour = WEEK_VIEW_START_HOUR; hour <= WEEK_VIEW_END_HOUR; hour++) {
            const label = document.createElement('div');
            label.className = 'plan-week-hour-label';
            label.style.height = `${WEEK_VIEW_HOUR_HEIGHT}px`;
            label.textContent = formatMinutesAsTime(hour * 60);
            hours.appendChild(label);
        }
        gutter.appendChild(hours);
        return gutter;
    }

    function createWeekDayColumn(date) {
        const weekday = date.getDay() === 0 ? 6 : date.getDay() - 1;
        const isWeekend = weekday >= 5;
        const isToday = date.toDateString() === new Date().toDateString();

        const col = document.createElement('div');
        col.className =
            'plan-week-day-column' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '');
        col.dataset.dateKey = formatDateKey(date);
        const weekdayLabels =
            currentLanguage === 'da' ? WEEKDAYS_FULL_DA : WEEKDAYS_FULL_EN;
        const dateKey = formatDateKey(date);

        const header = document.createElement('div');
        header.className = 'plan-week-day-header';
        header.innerHTML = `
            <span class="plan-week-day-name">${weekdayLabels[weekday]} ${date.getDate()}</span>
        `;
        col.appendChild(header);

        const dayGoals = document.createElement('div');
        dayGoals.className = 'plan-week-day-goals';
        dayGoals.dataset.dateKey = dateKey;
        col.appendChild(dayGoals);

        const body = document.createElement('div');
        body.className = 'plan-week-day-body';

        const alldayRow = document.createElement('div');
        alldayRow.className =
            'plan-week-allday-row' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '');
        alldayRow.dataset.dateKey = dateKey;

        const holidays = getHolidays(date.getFullYear());
        if (holidays[dateKey]) {
            const holidayEl = document.createElement('span');
            holidayEl.className = 'plan-week-allday-item holiday';
            holidayEl.textContent = holidays[dateKey];
            alldayRow.appendChild(holidayEl);
        }
        body.appendChild(alldayRow);

        const timeGrid = document.createElement('div');
        timeGrid.className = 'plan-week-time-grid';
        timeGrid.dataset.dateKey = dateKey;
        const gridHeight =
            (WEEK_VIEW_END_HOUR - WEEK_VIEW_START_HOUR + 1) * WEEK_VIEW_HOUR_HEIGHT;
        timeGrid.style.height = `${gridHeight}px`;

        for (let hour = WEEK_VIEW_START_HOUR; hour <= WEEK_VIEW_END_HOUR; hour++) {
            const slot = document.createElement('div');
            slot.className =
                'plan-week-hour-slot' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '');
            slot.dataset.hour = String(hour);
            slot.dataset.dateKey = dateKey;
            slot.style.height = `${WEEK_VIEW_HOUR_HEIGHT}px`;
            timeGrid.appendChild(slot);
        }
        body.appendChild(timeGrid);
        col.appendChild(body);

        // Legacy hook for month-style note queries (hidden, unused in week layout)
        const legacyRow = document.createElement('div');
        legacyRow.className = 'plan-day-row plan-week-day-row hidden';
        legacyRow.dataset.dateKey = dateKey;
        const legacyNoteArea = document.createElement('div');
        legacyNoteArea.className = 'plan-note-area';
        legacyRow.appendChild(legacyNoteArea);
        col.appendChild(legacyRow);

        return col;
    }

    function createWeekAllDayEvent(note) {
        const el = document.createElement('div');
        const isPlannerEvent = note.source === 'calendar' || note.source === 'task';
        el.className = 'plan-week-allday-item' + (isPlannerEvent ? ' calendar-event' : ' user-event');
        el.textContent = noteDisplayText(note);
        if (note.fontColor) {
            el.style.color = note.fontColor;
            if (isPlannerEvent) {
                el.style.background = hexToRgba(note.fontColor, 0.14);
            }
        }
        if (note.source === 'calendar') {
            el.title = `From calendar: ${note.calendarName || 'Unknown'}`;
        } else if (note.source === 'task') {
            el.title = 'From to-do list';
        }
        return el;
    }

    function createWeekTimedEvent(note) {
        const el = document.createElement('div');
        el.className =
            'plan-week-event' +
            (note.source === 'calendar' ? ' calendar-event' : ' user-event');

        const startMin = note.startMinutes ?? 9 * 60;
        let endMin = note.endMinutes ?? startMin + 60;
        if (endMin <= startMin) endMin = startMin + 60;

        const rangeStart = WEEK_VIEW_START_HOUR * 60;
        const rangeEnd = (WEEK_VIEW_END_HOUR + 1) * 60;
        const clampedStart = Math.max(startMin, rangeStart);
        const clampedEnd = Math.min(endMin, rangeEnd);
        if (clampedEnd <= rangeStart || clampedStart >= rangeEnd) {
            el.classList.add('hidden');
            return el;
        }

        const top = ((clampedStart - rangeStart) / 60) * WEEK_VIEW_HOUR_HEIGHT;
        const height = Math.max(
            ((clampedEnd - clampedStart) / 60) * WEEK_VIEW_HOUR_HEIGHT,
            22
        );
        el.style.top = `${top}px`;
        el.style.height = `${height}px`;

        const timeEl = document.createElement('span');
        timeEl.className = 'plan-week-event-time';
        timeEl.textContent =
            endMin > startMin
                ? `${formatMinutesAsTime(startMin)} – ${formatMinutesAsTime(endMin)}`
                : formatMinutesAsTime(startMin);

        const titleEl = document.createElement('span');
        titleEl.className = 'plan-week-event-title';
        titleEl.textContent = noteDisplayText(note);

        el.appendChild(timeEl);
        el.appendChild(titleEl);

        if (note.source === 'calendar') {
            el.title = `From calendar: ${note.calendarName || 'Unknown'}`;
        }

        return el;
    }

    function renderWeekFreeformElements(isVisible) {
        freeformNotes.filter(isVisible).forEach((note) => {
            if (!note.dateKey || !isDateInVisibleWeek(note.dateKey)) return;

            if (note.isAllDay || note.startMinutes == null) {
                const allday = container.querySelector(
                    `.plan-week-allday-row[data-date-key="${note.dateKey}"]`
                );
                if (allday) allday.appendChild(createWeekAllDayEvent(note));
                return;
            }

            const grid = container.querySelector(
                `.plan-week-time-grid[data-date-key="${note.dateKey}"]`
            );
            if (grid) grid.appendChild(createWeekTimedEvent(note));
        });

        freeformLines.filter(isVisible).forEach((line) => {
            if (!line.startDate || !line.endDate) return;

            const label = line.label?.trim();
            if (!label) return;

            for (let i = 0; i < 7; i++) {
                const dayKey = formatDateKey(addDays(weekStartDate, i));
                if (dayKey < line.startDate || dayKey > line.endDate) continue;

                const allday = container.querySelector(
                    `.plan-week-allday-row[data-date-key="${dayKey}"]`
                );
                if (!allday) continue;

                const el = document.createElement('div');
                const isPlannerLine = line.source === 'calendar' || line.source === 'task';
                el.className =
                    'plan-week-allday-item line-event' +
                    (isPlannerLine ? ' calendar-event' : ' user-event');
                el.textContent = label;
                if (line.fontColor) {
                    el.style.color = line.fontColor;
                    if (isPlannerLine) {
                        el.style.background = hexToRgba(line.fontColor, 0.14);
                    }
                }
                if (line.source === 'calendar') {
                    el.title = `From calendar: ${line.calendarName || 'Unknown'}`;
                } else if (line.source === 'task') {
                    el.title = 'From to-do list';
                }
                allday.appendChild(el);
            }
        });

        markWeekCurrentTimeIndicator();
    }

    function markWeekCurrentTimeIndicator() {
        container.querySelectorAll('.plan-week-now-marker').forEach((el) => el.remove());

        const now = new Date();
        const todayKey = formatDateKey(now);
        if (!isDateInVisibleWeek(todayKey)) return;

        const minutes = now.getHours() * 60 + now.getMinutes();
        const rangeStart = WEEK_VIEW_START_HOUR * 60;
        const rangeEnd = (WEEK_VIEW_END_HOUR + 1) * 60;
        if (minutes < rangeStart || minutes > rangeEnd) return;

        const grid = container.querySelector(
            `.plan-week-time-grid[data-date-key="${todayKey}"]`
        );
        if (!grid) return;

        const marker = document.createElement('div');
        marker.className = 'plan-week-now-marker';
        marker.style.top = `${((minutes - rangeStart) / 60) * WEEK_VIEW_HOUR_HEIGHT}px`;
        grid.appendChild(marker);
    }

    function scrollWeekViewToCurrentTime() {
        if (calendarViewMode !== 'week' || !calendarContainer) return;

        const todayKey = formatDateKey(new Date());
        if (!isDateInVisibleWeek(todayKey)) {
            calendarContainer.scrollTop = 0;
            return;
        }

        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        const rangeStart = WEEK_VIEW_START_HOUR * 60;
        const targetTop = Math.max(0, ((minutes - rangeStart) / 60) * WEEK_VIEW_HOUR_HEIGHT - 120);
        calendarContainer.scrollTop = targetTop;
    }

    function createMonthColumn(month, year) {
        const col = document.createElement('div');
        col.className = 'plan-month-column';
        col.dataset.month = month;
        col.dataset.year = year;

        const header = document.createElement('div');
        header.className = 'plan-month-header';
        const monthName = currentLanguage === 'da' ? MONTHS_DA[month] : MONTHS_EN[month];
        // Add year if different from today's year
        const showYear = year !== new Date().getFullYear();
        header.textContent = showYear ? `${monthName} ${year}` : monthName;
        col.appendChild(header);

        const days = document.createElement('div');
        days.className = 'plan-days-container';
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            const weekday = date.getDay() === 0 ? 6 : date.getDay() - 1;
            const isWeekend = weekday >= 5;
            const isToday = date.toDateString() === new Date().toDateString();

            const row = document.createElement('div');
            row.className = 'plan-day-row' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '');
            row.dataset.dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            const dayName = document.createElement('span');
            dayName.className = 'plan-day-name';
            dayName.textContent = currentLanguage === 'da' ? WEEKDAYS_DA[weekday] : WEEKDAYS_EN[weekday];
            row.appendChild(dayName);

            const dayNum = document.createElement('span');
            dayNum.className = 'plan-day-number';
            dayNum.textContent = d;
            row.appendChild(dayNum);

            const noteArea = document.createElement('div');
            noteArea.className = 'plan-note-area';

            // Add holiday if applicable
            const dateKey = row.dataset.dateKey;
            const holidays = getHolidays(year);
            if (holidays[dateKey]) {
                const holidayEl = document.createElement('span');
                holidayEl.className = 'plan-note-text holiday';
                holidayEl.textContent = holidays[dateKey];
                noteArea.appendChild(holidayEl);
            }

            row.appendChild(noteArea);

            if (weekday === 6) {
                const weekNum = document.createElement('span');
                weekNum.className = 'plan-week-number';
                weekNum.textContent = getWeekNumber(date);
                row.appendChild(weekNum);
            }

            days.appendChild(row);
        }
        col.appendChild(days);
        return col;
    }

    function getWeekNumber(date) {
        const start = new Date(date.getFullYear(), 0, 1);
        const diff = (date - start + ((start.getDay() + 6) % 7) * 86400000) / 86400000;
        return Math.ceil(diff / 7);
    }



    function renderFreeformElements() {
        // Skip rendering if a drag operation is in progress
        if (isDragInProgress) {
            console.log('[Plan] Skipping render - drag in progress');
            return;
        }

        const generation = ++freeformRenderGeneration;

        // Clear canvas layer (for lines)
        canvasLayer.innerHTML = '';

        if (calendarViewMode === 'week') {
            container.querySelectorAll('.plan-week-allday-row').forEach((row) => {
                row.querySelectorAll('.plan-week-allday-item:not(.holiday)').forEach((el) => el.remove());
            });
            container.querySelectorAll('.plan-week-time-grid').forEach((grid) => {
                grid.querySelectorAll('.plan-week-event, .plan-week-now-marker').forEach((el) => el.remove());
            });
        } else {
            // Clear all note-areas
            container.querySelectorAll('.plan-note-area').forEach(area => area.innerHTML = '');

            // Re-add holidays to note-areas
            container.querySelectorAll('.plan-day-row').forEach(row => {
                const dateKey = row.dataset.dateKey;
                if (!dateKey) return;

                const year = parseInt(dateKey.split('-')[0]);
                const holidays = getHolidays(year);

                if (holidays[dateKey]) {
                    const noteArea = row.querySelector('.plan-note-area');
                    if (noteArea) {
                        const holidayEl = document.createElement('span');
                        holidayEl.className = 'plan-note-text holiday';
                        holidayEl.textContent = holidays[dateKey];
                        noteArea.appendChild(holidayEl);
                    }
                }
            });
        }

        // Use requestAnimationFrame to ensure DOM is laid out before measuring positions
        requestAnimationFrame(() => {
            if (generation !== freeformRenderGeneration) return;

            // Force reflow to ensure all layout calculations are complete
            // This is needed because getBoundingClientRect needs accurate positions
            // Get IDs of visible calendars
            const visibleCalendarIds = calendars.filter(c => c.visible !== false).map(c => c.id);

            // Filter function to check if item should be shown
            const isVisible = (item) => {
                if (item.source === 'calendar') {
                    return visibleCalendarIds.includes(item.calendarId);
                }
                if (item.source === 'task') {
                    return taskChipSettings.visible !== false;
                }
                return true;
            };

            if (calendarViewMode === 'week') {
                renderWeekFreeformElements(isVisible);
                return;
            }

            // Render all lines (user-drawn AND calendar-synced)
            freeformLines.filter(isVisible).forEach(l => {
                renderLineOrSplit(l, canvasLayer);
            });


            // Helper to render a line, splitting it if it crosses month boundaries
            function renderLineOrSplit(line, container) {
                if (!line.startDate || !line.endDate) {
                    // Legacy line without dates, just render
                    container.appendChild(createLine(line));
                    return;
                }

                const startParts = line.startDate.split('-').map(Number);
                const endParts = line.endDate.split('-').map(Number);

                // Check if year and month are the same
                if (startParts[0] === endParts[0] && startParts[1] === endParts[1]) {
                    // Same month, render normally
                    container.appendChild(createLine(line));
                    return;
                }

                // Crosses month boundary - split into segments
                let currentYear = startParts[0];
                let currentMonth = startParts[1];

                // Loop from start month to end month
                while (currentYear < endParts[0] || (currentYear === endParts[0] && currentMonth <= endParts[1])) {
                    const isFirstSegment = currentYear === startParts[0] && currentMonth === startParts[1];
                    const isLastSegment = currentYear === endParts[0] && currentMonth === endParts[1];

                    const segmentStart = isFirstSegment ? line.startDate :
                        `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;

                    // Calculate last day of current month
                    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
                    const segmentEnd = isLastSegment ? line.endDate :
                        `${currentYear}-${String(currentMonth).padStart(2, '0')}-${daysInMonth}`;

                    // Clone line properties
                    const segment = { ...line };
                    // Generate a transient ID for the segment so it doesn't conflict
                    segment.id = line.id + `-seg-${currentYear}-${currentMonth}`;
                    segment.startDate = segmentStart;
                    segment.endDate = segmentEnd;
                    // Tag so createLine still renders single-day tail segments as vertical bars
                    segment.isMultiDaySegment = true;

                    // Render this segment
                    container.appendChild(createLine(segment));

                    // Move to next month
                    currentMonth++;
                    if (currentMonth > 12) {
                        currentMonth = 1;
                        currentYear++;
                    }
                }
            }

            // Render all notes (user-created AND calendar-synced)
            const noteAreaAutoLayout = new WeakMap();

            const getNoteAreaLayoutStart = (noteArea) => {
                if (!noteAreaAutoLayout.has(noteArea)) {
                    const holiday = noteArea.querySelector('.plan-note-text.holiday');
                    const startX = holiday ? holiday.offsetWidth + 8 : 0;
                    noteAreaAutoLayout.set(noteArea, startX);
                }
                return noteAreaAutoLayout.get(noteArea);
            };

            freeformNotes.filter(isVisible).forEach(note => {
                if (!note.dateKey) return; // Skip legacy notes without dateKey

                const row = container.querySelector(`.plan-day-row[data-date-key="${note.dateKey}"]`);
                if (row) {
                    const noteArea = row.querySelector('.plan-note-area');
                    if (noteArea) {
                        const usesAutoLayout = (note.source === 'calendar' || note.source === 'task') && !note.offsetX;
                        const renderNote = usesAutoLayout
                            ? { ...note, offsetX: getNoteAreaLayoutStart(noteArea) }
                            : note;
                        const el = createNote(renderNote);
                        noteArea.appendChild(el);
                        if (usesAutoLayout) {
                            noteAreaAutoLayout.set(noteArea, renderNote.offsetX + el.offsetWidth + 8);
                        }
                    }
                }
            });
        });
    }

    function createNote(note) {
        const el = document.createElement('span');
        el.className = 'plan-note-text freeform';

        // Add class for synced planner events (calendars + Enkelt tasks)
        if (note.source === 'calendar' || note.source === 'task') {
            el.classList.add('calendar-event');
        }

        el.innerHTML = note.html || note.text || 'Note';

        // Absolute positioning within note-area using offsetX
        // Note: top position is handled by CSS (.plan-note-text.freeform { top: -4px })
        el.style.position = 'absolute';
        el.style.left = (note.offsetX || 0) + 'px';
        el.style.zIndex = (note.source === 'calendar' || note.source === 'task') ? '50' : '100';

        // Apply styling
        if (note.fontFamily) el.style.fontFamily = note.fontFamily + ', sans-serif';
        if (note.fontColor) el.style.color = note.fontColor;
        if (note.bgColor) el.style.backgroundColor = note.bgColor;

        el.dataset.noteId = note.id;
        if (note.source === 'calendar') {
            el.title = `From calendar: ${note.calendarName || 'Unknown'}`;
        } else if (note.source === 'task') {
            el.title = 'From to-do list';
        }

        // Track dragging to distinguish from click
        let hasDragged = false;

        el.addEventListener('mousedown', e => {
            if (note.source === 'task') return;
            if (el.getAttribute('contenteditable') === 'true') return;

            e.preventDefault();
            e.stopPropagation();

            isDragInProgress = true;  // Prevent render during drag
            hasDragged = false;
            const mouseStartX = e.clientX;
            const mouseStartY = e.clientY;

            // Create a temporary dragging clone on canvas
            const rect = el.getBoundingClientRect();
            const canvasRect = canvasLayer.getBoundingClientRect();
            let dragX = rect.left - canvasRect.left;
            let dragY = rect.top - canvasRect.top;

            // Track where within the note the user clicked (for maintaining relative position on drop)
            const clickOffsetX = mouseStartX - rect.left;

            const dragClone = el.cloneNode(true);
            dragClone.classList.add('dragging');
            dragClone.style.position = 'absolute';
            dragClone.style.left = dragX + 'px';
            dragClone.style.top = dragY + 'px';
            dragClone.style.pointerEvents = 'none';
            dragClone.style.opacity = '0.9';
            dragClone.style.zIndex = '9999';
            canvasLayer.appendChild(dragClone);

            // Hide original while dragging
            el.style.opacity = '0.3';

            const onMouseMove = moveEvent => {
                const deltaX = moveEvent.clientX - mouseStartX;
                const deltaY = moveEvent.clientY - mouseStartY;

                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    hasDragged = true;
                }

                dragClone.style.left = (dragX + deltaX) + 'px';
                dragClone.style.top = (dragY + deltaY) + 'px';
            };

            const onMouseUp = moveEvent => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                isDragInProgress = false;  // Re-enable render
                dragClone.remove();
                el.style.opacity = '1';

                if (hasDragged) {
                    // Use cursor position for snapping
                    // findClosestDateRowPosition expects viewport-relative coordinates 
                    // (matching how it uses getBoundingClientRect for row positions)
                    const canvasRect = canvasLayer.getBoundingClientRect();
                    const cursorX = moveEvent.clientX - canvasRect.left;
                    const cursorY = moveEvent.clientY - canvasRect.top;

                    // Subtract click offset so the note's left edge maintains relative position to cursor
                    const adjustedX = cursorX - clickOffsetX;
                    const snapped = findClosestDateRowPosition(adjustedX, cursorY);

                    console.log('[Plan] Note drag drop:', {
                        cursorX, cursorY, adjustedX,
                        snapped,
                        originalDateKey: note.dateKey
                    });

                    if (snapped.dateKey) {
                        // Update note data
                        note.dateKey = snapped.dateKey;
                        note.offsetX = snapped.offsetX;
                        saveData();

                        // Re-render to move note to new location
                        renderFreeformElements();
                    } else {
                        // No valid drop target found - just re-render to restore original position
                        console.warn('[Plan] No valid drop target, restoring original position');
                        renderFreeformElements();
                    }
                } else {
                    // It was a click, show editor
                    // Store click position for cursor placement
                    window._lastClickEvent = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
                    showNoteEditor(note.id, el, moveEvent.shiftKey);
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // Handle input for inline editing
        el.addEventListener('input', () => {
            note.html = el.innerHTML;
            note.text = el.textContent.trim();
            saveData();
        });


        return el;
    }

    function createLine(line) {
        // Container for line and handles
        const containerEl = document.createElement('div');
        containerEl.className = 'plan-note-line-container';
        containerEl.dataset.lineId = line.id;

        const color = line.color || '#333333';
        const width = line.width || 8;

        // Check if this is a synced multi-day event (vertical line)
        const isPlannerSyncedLine = line.source === 'calendar' || line.source === 'task' || line.isCalendarEvent;
        const isCalendarMultiDay = isPlannerSyncedLine && line.startDate && line.endDate && (line.startDate !== line.endDate || line.isMultiDaySegment);

        if (isCalendarMultiDay) {
            // Render as VERTICAL line spanning multiple dates
            containerEl.classList.add('calendar-event', 'vertical-line');

            // Find all rows for the date range
            const startRow = container.querySelector(`.plan-day-row[data-date-key="${line.startDate}"]`);
            const endRow = container.querySelector(`.plan-day-row[data-date-key="${line.endDate}"]`);

            if (!startRow || !endRow) {
                containerEl.style.display = 'none';
                return containerEl;
            }

            const containerRect = calendarContainer.getBoundingClientRect();
            const startRect = startRow.getBoundingClientRect();
            const endRect = endRow.getBoundingClientRect();

            // Calculate vertical line position relative to the start row
            // verticalLineX stores extra offset from default (50px from row start)
            const rowLeftRelative = startRect.left - containerRect.left + calendarContainer.scrollLeft;
            const userOffset = line.verticalLineX !== undefined ? line.verticalLineX : 50;
            const xPos = rowLeftRelative + userOffset;
            const topY = startRect.top - containerRect.top + calendarContainer.scrollTop;
            const bottomY = endRect.bottom - containerRect.top + calendarContainer.scrollTop;
            const lineHeight = bottomY - topY;

            containerEl.style.position = 'absolute';
            containerEl.style.left = xPos + 'px';
            containerEl.style.top = topY + 'px';
            containerEl.style.width = width + 'px'; // Just fit the line bar itself
            containerEl.style.height = lineHeight + 'px';
            containerEl.style.overflow = 'visible'; // Allow label to overflow

            // Create vertical line element
            const lineEl = document.createElement('div');
            lineEl.className = 'plan-note-line vertical';
            lineEl.style.position = 'absolute';
            lineEl.style.left = '0';
            lineEl.style.top = '0';
            lineEl.style.width = width + 'px';
            lineEl.style.height = '100%';
            lineEl.style.background = color;
            lineEl.style.borderRadius = '4px';
            lineEl.style.cursor = 'pointer';

            // Create label (positioned to the right of the line, centered vertically)
            const labelEl = document.createElement('div');
            labelEl.className = 'plan-line-label vertical';
            labelEl.textContent = line.label || '';
            labelEl.style.position = 'absolute';
            labelEl.style.left = (width + 4) + 'px';
            labelEl.style.top = '50%';
            labelEl.style.transform = 'translateY(-50%)';
            labelEl.style.maxWidth = '150px';
            labelEl.style.wordWrap = 'break-word';
            labelEl.style.whiteSpace = 'normal';
            labelEl.style.cursor = 'pointer';
            if (line.fontFamily) labelEl.style.fontFamily = line.fontFamily + ', sans-serif';
            if (line.fontColor) labelEl.style.color = line.fontColor;
            if (line.source === 'task') {
                labelEl.style.fontStyle = 'italic';
                labelEl.style.fontSize = '15px';
            }

            if (line.source === 'calendar') {
                containerEl.title = `From calendar: ${line.calendarName || 'Unknown'}`;
            } else if (line.source === 'task') {
                containerEl.title = 'From to-do list';
            }
            containerEl.appendChild(lineEl);
            containerEl.appendChild(labelEl);

            // Horizontal drag to move vertical line left/right
            let isDragging = false;
            let dragStartX = 0;
            let initialLeft = 0;

            containerEl.style.cursor = 'ew-resize';
            labelEl.style.cursor = 'ew-resize';

            containerEl.addEventListener('mousedown', (e) => {
                if (labelEl.getAttribute('contenteditable') === 'true') return;

                isDragInProgress = true;
                isDragging = true;
                dragStartX = e.clientX;
                initialLeft = parseFloat(containerEl.style.left) || 0;
                e.preventDefault();
                e.stopPropagation();

                const onMouseMove = (moveEvent) => {
                    if (!isDragging) return;
                    const deltaX = moveEvent.clientX - dragStartX;
                    containerEl.style.left = (initialLeft + deltaX) + 'px';
                };

                const onMouseUp = () => {
                    isDragInProgress = false;
                    if (isDragging) {
                        isDragging = false;
                        const newLeft = parseFloat(containerEl.style.left) || 0;
                        line.verticalLineX = newLeft - rowLeftRelative;
                        saveData();
                    }
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            if (line.source !== 'task') {
                // Click to select and show line toolbar (same as user-drawn lines)
                const selectLine = (e) => {
                    if (isDragging) return;
                    e.stopPropagation();
                    showLineEditor(line.id, containerEl);
                };

                lineEl.addEventListener('click', selectLine);
                labelEl.addEventListener('click', selectLine);

                // Double-click to edit label in place
                const editLabel = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    labelEl.setAttribute('contenteditable', 'true');
                    labelEl.focus();
                    const range = document.createRange();
                    range.selectNodeContents(labelEl);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                };

                lineEl.addEventListener('dblclick', editLabel);
                labelEl.addEventListener('dblclick', editLabel);

                labelEl.addEventListener('blur', () => {
                    labelEl.removeAttribute('contenteditable');
                    line.label = labelEl.textContent.trim();
                    saveData();
                });

                labelEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        labelEl.blur();
                    }
                    if (e.key === 'Escape') {
                        labelEl.textContent = line.label || '';
                        labelEl.blur();
                    }
                });
            }

            return containerEl;
        }

        // Check if using new date-relative format or old pixel format
        const usesDateCoords = line.startDate && line.endDate;

        let x1, y1, x2, y2;

        if (usesDateCoords) {
            // New format: convert date-relative to screen coords
            const start = dateCoordsToScreen(line.startDate, line.startOffsetX || 0);
            const end = dateCoordsToScreen(line.endDate, line.endOffsetX || 0);
            if (!start || !end) {
                console.warn('[Plan] createLine: Could not convert date coords, line may be off-screen', line.id);
                // Return an invisible placeholder if dates are not in DOM
                containerEl.style.display = 'none';
                return containerEl;
            }
            x1 = start.x; y1 = start.y;
            x2 = end.x; y2 = end.y;
        } else {
            // Old format: use pixel coords directly (backward compatibility)
            x1 = line.x1; y1 = line.y1 || line.y;
            x2 = line.x2; y2 = line.y2 || line.y;
        }

        // The line element
        const lineEl = document.createElement('div');
        lineEl.className = 'plan-note-line';

        // Add class for calendar-sourced lines
        if (line.source === 'calendar') {
            containerEl.classList.add('calendar-event');
        }

        lineEl.style.transformOrigin = '0 50%';
        // Only set inline color if explicitly specified, otherwise let CSS control it
        if (color && color !== '#333' && color !== '#333333') {
            lineEl.style.background = color;
        }
        lineEl.style.height = width + 'px';

        // Label element (positioned at center of line)
        const labelEl = document.createElement('div');
        labelEl.className = 'plan-line-label';
        labelEl.textContent = line.label || '';
        if (!line.label) labelEl.classList.add('empty');

        // Apply calendar styling to label
        if (line.fontFamily) labelEl.style.fontFamily = line.fontFamily + ', sans-serif';
        if (line.fontColor) labelEl.style.color = line.fontColor;

        if (line.source === 'calendar') {
            containerEl.title = `From calendar: ${line.calendarName || 'Unknown'}`;
        }

        // Endpoint handles (hidden by default, shown when selected)
        const handle1 = document.createElement('div');
        handle1.className = 'plan-line-handle';
        handle1.dataset.endpoint = '1';

        const handle2 = document.createElement('div');
        handle2.className = 'plan-line-handle';
        handle2.dataset.endpoint = '2';

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
            handle1.style.left = (x1 - 6) + 'px';
            handle1.style.top = (y1 - 6) + 'px';
            handle2.style.left = (x2 - 6) + 'px';
            handle2.style.top = (y2 - 6) + 'px';

            // Position label at center of line
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            labelEl.style.left = centerX + 'px';
            labelEl.style.top = centerY + 'px';
        }

        containerEl.appendChild(lineEl);
        containerEl.appendChild(labelEl);
        containerEl.appendChild(handle1);
        containerEl.appendChild(handle2);
        updateLineGeometry();

        // Double-click to edit label
        lineEl.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            // Make label editable for inline editing
            if (!line.label) {
                line.label = '';
                labelEl.textContent = '';
                labelEl.classList.remove('empty');
            }
            labelEl.setAttribute('contenteditable', 'true');
            labelEl.focus();
            // Select all text
            const range = document.createRange();
            range.selectNodeContents(labelEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });

        labelEl.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            // Make label editable for inline editing
            labelEl.setAttribute('contenteditable', 'true');
            labelEl.focus();
            // Select all text
            const range = document.createRange();
            range.selectNodeContents(labelEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });

        // Handle blur to save label changes
        labelEl.addEventListener('blur', () => {
            labelEl.setAttribute('contenteditable', 'false');
            line.label = labelEl.textContent.trim();
            if (line.label) {
                labelEl.classList.remove('empty');
            } else {
                labelEl.classList.add('empty');
            }
            saveData();
            // Update toolbar label field if visible
            const labelField = container.querySelector('.plan-line-label-field');
            if (labelField) labelField.value = line.label;
        });

        // Handle Enter key to finish editing
        labelEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                labelEl.blur();
            } else if (e.key === 'Escape') {
                labelEl.textContent = line.label || '';
                labelEl.blur();
            }
        });

        // Track if label was dragged (used by click handler)
        let labelWasDragged = false;

        // Click handler for label - select the line on single click
        labelEl.addEventListener('click', e => {
            // Don't interfere with editing
            if (labelEl.getAttribute('contenteditable') === 'true') return;

            // If we just finished dragging, don't select
            if (labelWasDragged) {
                labelWasDragged = false;
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // Select the line
            containerEl.classList.add('selected');
            showLineEditor(line.id, lineEl);
        });

        // Mousedown on label - supports drag to move
        labelEl.addEventListener('mousedown', e => {
            // Don't interfere with editing
            if (labelEl.getAttribute('contenteditable') === 'true') return;

            e.preventDefault();
            e.stopPropagation();

            labelWasDragged = false;
            const mouseStartX = e.clientX;
            const mouseStartY = e.clientY;
            const origX1 = x1, origY1 = y1, origX2 = x2, origY2 = y2;

            const onMouseMove = moveEvent => {
                const deltaX = moveEvent.clientX - mouseStartX;
                const deltaY = moveEvent.clientY - mouseStartY;

                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    labelWasDragged = true;
                    lineEl.classList.add('dragging');
                }

                if (labelWasDragged) {
                    x1 = origX1 + deltaX;
                    y1 = origY1 + deltaY;
                    x2 = origX2 + deltaX;
                    y2 = origY2 + deltaY;
                    updateLineGeometry();
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                lineEl.classList.remove('dragging');

                if (labelWasDragged) {
                    // Convert new pixel positions to date-relative coords
                    const startCoords = screenToDateCoords(x1, y1);
                    const endCoords = screenToDateCoords(x2, y2);

                    line.startDate = startCoords.dateKey;
                    line.startOffsetX = startCoords.offsetX;
                    line.endDate = endCoords.dateKey;
                    line.endOffsetX = endCoords.offsetX;
                    delete line.x1; delete line.y1; delete line.x2; delete line.y2;
                    saveData();
                }
                // Note: click handler will handle selection for non-drag clicks
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // Handle dragging for endpoints
        function setupHandleDrag(handle, isEndpoint2) {
            handle.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();

                const onMouseMove = moveEvent => {
                    const rect = canvasLayer.getBoundingClientRect();
                    const newX = moveEvent.clientX - rect.left;
                    const newY = moveEvent.clientY - rect.top + calendarContainer.scrollTop;

                    if (isEndpoint2) {
                        x2 = newX;
                        y2 = newY;
                    } else {
                        x1 = newX;
                        y1 = newY;
                    }
                    updateLineGeometry();
                };

                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);

                    // Convert new pixel positions to date-relative coords
                    const startCoords = screenToDateCoords(x1, y1);
                    const endCoords = screenToDateCoords(x2, y2);

                    line.startDate = startCoords.dateKey;
                    line.startOffsetX = startCoords.offsetX;
                    line.endDate = endCoords.dateKey;
                    line.endOffsetX = endCoords.offsetX;
                    // Remove old pixel coords if present
                    delete line.x1; delete line.y1; delete line.x2; delete line.y2;
                    saveData();
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        setupHandleDrag(handle1, false);
        setupHandleDrag(handle2, true);

        // Track dragging to distinguish from click
        let hasDragged = false;
        let lastClickTime = 0;

        // Drag line to move (also handles click and double-click detection)
        lineEl.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();

            const clickTime = Date.now();
            const isDoubleClick = (clickTime - lastClickTime) < 400;
            lastClickTime = clickTime;

            // If double-click, enable inline label editing
            if (isDoubleClick) {
                if (!line.label) {
                    line.label = '';
                    labelEl.textContent = '';
                    labelEl.classList.remove('empty');
                }
                labelEl.setAttribute('contenteditable', 'true');
                labelEl.focus();
                return;
            }

            hasDragged = false;
            const mouseStartX = e.clientX;
            const mouseStartY = e.clientY;
            const origX1 = x1, origY1 = y1, origX2 = x2, origY2 = y2;

            lineEl.classList.add('dragging');

            const onMouseMove = moveEvent => {
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

                if (hasDragged) {
                    // Convert new pixel positions to date-relative coords
                    const startCoords = screenToDateCoords(x1, y1);
                    const endCoords = screenToDateCoords(x2, y2);

                    // Update line with new date-relative coords
                    line.startDate = startCoords.dateKey;
                    line.startOffsetX = startCoords.offsetX;
                    line.endDate = endCoords.dateKey;
                    line.endOffsetX = endCoords.offsetX;
                    // Remove old pixel coords if present
                    delete line.x1; delete line.y1; delete line.x2; delete line.y2;
                    saveData();
                } else {
                    // It was a click (not drag), show line editor and show handles
                    containerEl.classList.add('selected');
                    showLineEditor(line.id, lineEl);
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        return containerEl;
    }

    // Create inline text input for new notes
    function createFreeformInput(x, y, dateKey, offsetX) {
        // Remove any existing input (check if still attached to DOM to avoid race condition with blur handler)
        const existingInput = canvasLayer.querySelector('.plan-note-input-inline');
        if (existingInput && existingInput.parentNode) existingInput.remove();

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'plan-note-input-inline';
        input.style.left = x + 'px';
        input.style.top = y + 'px';

        const finishEditing = () => {
            const text = input.value.trim();
            if (input.parentNode) input.remove();

            if (text && dateKey) {
                pushHistory();
                const noteId = Date.now().toString();
                const note = {
                    id: noteId,
                    text: text,
                    dateKey: dateKey,
                    offsetX: offsetX || 0,
                    group: activeGroup
                };
                freeformNotes.push(note);
                saveData();

                // Create and add note element to the date row's note-area
                const el = createNote(note);
                if (el) {
                    const row = container.querySelector(`.plan-day-row[data-date-key="${dateKey}"]`);
                    if (row) {
                        const noteArea = row.querySelector('.plan-note-area');
                        if (noteArea) noteArea.appendChild(el);
                    }
                }
            } else if (text && !dateKey) {
                console.warn('[Plan] Note not saved - dateKey is missing. Text:', text);
            }
        };

        input.addEventListener('blur', finishEditing);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                input.value = '';
                input.blur();
            }
        });

        canvasLayer.appendChild(input);
        input.focus();
    }
    // Find the closest date row position for snapping
    // Input: x, y are canvas-relative (from mouse event relative to canvasLayer.getBoundingClientRect())
    // Since canvas scrolls with content, these are effectively content-relative
    function findClosestDateRowPosition(x, y) {
        const dayRows = container.querySelectorAll('.plan-day-row');
        let targetRow = null;
        let closestDistance = Infinity;
        // Use canvasLayer rect as reference since coords are relative to it
        const canvasRect = canvasLayer.getBoundingClientRect();

        // Find the row that contains this point
        // Use center-based matching for more intuitive snapping behavior
        for (const row of dayRows) {
            if (row.classList.contains('hidden')) continue;
            const rect = row.getBoundingClientRect();
            // Convert row position to canvas-relative coordinates
            const rowLeft = rect.left - canvasRect.left;
            const rowRight = rowLeft + rect.width;
            const rowTop = rect.top - canvasRect.top;
            const rowCenterY = rowTop + rect.height / 2;

            // Check if point is within this row's horizontal bounds and closer to this row's center
            if (x >= rowLeft && x < rowRight) {
                const yDistToCenter = Math.abs(y - rowCenterY);
                if (yDistToCenter < closestDistance) {
                    closestDistance = yDistToCenter;
                    targetRow = row;
                }
            } else {
                // Track closest row as fallback (for points outside columns)
                const xDist = x < rowLeft ? rowLeft - x : (x > rowRight ? x - rowRight : 0);
                const yDistToCenter = Math.abs(y - rowCenterY);
                const distance = Math.sqrt(xDist * xDist + yDistToCenter * yDistToCenter);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    targetRow = row;
                }
            }
        }

        if (targetRow) {
            const rect = targetRow.getBoundingClientRect();
            const noteArea = targetRow.querySelector('.plan-note-area');
            const dateKey = targetRow.dataset.dateKey;

            // Row's canvas-relative Y position
            const rowY = rect.top - canvasRect.top;

            let snappedX = x;
            let offsetX = 0;
            if (noteArea) {
                const noteAreaRect = noteArea.getBoundingClientRect();
                const noteAreaLeft = noteAreaRect.left - canvasRect.left;
                snappedX = Math.max(noteAreaLeft, x);
                // Calculate offset relative to note-area left edge
                offsetX = x - noteAreaLeft;
                if (offsetX < 0) offsetX = 0;
            }

            // Return canvas-relative position, dateKey, and offsetX
            return {
                x: snappedX,
                y: rowY,
                dateKey: dateKey,
                offsetX: offsetX
            };
        }

        return { x, y, dateKey: null, offsetX: 0 };
    }

    // Convert screen coordinates to date-relative coordinates
    // screenX/screenY are canvas-relative (from mouse event relative to canvasLayer.getBoundingClientRect())
    // Returns { dateKey, offsetX } where offsetX is relative to the month column's left edge
    function screenToDateCoords(screenX, screenY) {
        const canvasRect = canvasLayer.getBoundingClientRect();
        const dayRows = container.querySelectorAll('.plan-day-row');

        let closestRow = null;
        let closestDistance = Infinity;
        let columnLeft = 0;

        for (const row of dayRows) {
            if (row.classList.contains('hidden')) continue;
            const rect = row.getBoundingClientRect();
            const rowTop = rect.top - canvasRect.top;
            const rowCenterY = rowTop + rect.height / 2;
            const dist = Math.abs(screenY - rowCenterY);

            if (dist < closestDistance) {
                closestDistance = dist;
                closestRow = row;
                // Get the month column's left edge (canvas-relative)
                const monthCol = row.closest('.plan-month-column');
                if (monthCol) {
                    columnLeft = monthCol.getBoundingClientRect().left - canvasRect.left;
                }
            }
        }

        if (closestRow) {
            const dateKey = closestRow.dataset.dateKey;
            const offsetX = screenX - columnLeft;
            return { dateKey, offsetX };
        }

        return { dateKey: null, offsetX: screenX };
    }

    // Convert date-relative coordinates back to screen coordinates
    // Returns { x, y } in canvas-layer pixel coordinates
    function dateCoordsToScreen(dateKey, offsetX) {
        const row = container.querySelector(`.plan-day-row[data-date-key="${dateKey}"]`);
        if (!row) {
            console.warn('[Plan] dateCoordsToScreen: Row not found for', dateKey);
            return null;
        }

        const canvasRect = canvasLayer.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const monthCol = row.closest('.plan-month-column');

        // X = column left + offsetX (canvas-relative)
        let x = offsetX;
        if (monthCol) {
            x = (monthCol.getBoundingClientRect().left - canvasRect.left) + offsetX;
        }

        // Y = row center (canvas-relative)
        const y = rowRect.top - canvasRect.top + rowRect.height / 2;

        return { x, y };
    }

    // Show inline input for editing line label
    function showLineLabelInput(line, labelEl, updateGeometryCallback) {
        // Remove any existing line label input
        const existingInput = canvasLayer.querySelector('.plan-line-label-input');
        if (existingInput && existingInput.parentNode) existingInput.remove();

        // Get label position
        const labelRect = labelEl.getBoundingClientRect();
        const containerRect = calendarContainer.getBoundingClientRect();

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'plan-line-label-input';
        input.value = line.label || '';
        input.placeholder = 'Add label...';
        input.style.left = (labelRect.left - containerRect.left) + 'px';
        input.style.top = (labelRect.top - containerRect.top + calendarContainer.scrollTop - 10) + 'px';

        const finishEditing = () => {
            const text = input.value.trim();
            if (input.parentNode) input.remove();

            line.label = text;
            labelEl.textContent = text;
            if (text) {
                labelEl.classList.remove('empty');
            } else {
                labelEl.classList.add('empty');
            }
            saveData();
        };

        input.addEventListener('blur', finishEditing);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                if (input.parentNode) input.remove();
            }
        });

        canvasLayer.appendChild(input);
        input.focus();
        input.select();
    }

    // Show note editor toolbar
    function showNoteEditor(noteId, noteElement, shiftKey = false) {
        const note = freeformNotes.find(n => n.id === noteId);
        if (!note) return;

        // Check if this note is already selected
        const existingIndex = selectedElements.findIndex(s => s.type === 'note' && s.id === noteId);

        // If already selected and only one item selected - enter edit mode on second click
        if (existingIndex >= 0 && selectedElements.length === 1 && !shiftKey) {
            // Already selected, enter edit mode
            noteElement.setAttribute('contenteditable', 'true');
            noteElement.focus();

            // Place cursor at click position (if we have click coordinates)
            if (window._lastClickEvent) {
                const range = document.caretRangeFromPoint(window._lastClickEvent.clientX, window._lastClickEvent.clientY);
                if (range) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
            return;
        }

        // Shift+click: add to selection (or remove if already selected)
        if (shiftKey) {
            if (existingIndex >= 0) {
                // Already selected, remove from selection
                selectedElements[existingIndex].element.classList.remove('selected');
                selectedElements.splice(existingIndex, 1);
                if (selectedElements.length === 0) {
                    container.classList.remove('has-selection');
                }
            } else {
                // Add to selection
                selectedElements.push({ type: 'note', id: noteId, element: noteElement });
                noteElement.classList.add('selected');
                container.classList.add('has-selection');
            }
        } else {
            // Normal click: deselect all and select just this one
            deselectElement();
            selectedElements.push({ type: 'note', id: noteId, element: noteElement });
            noteElement.classList.add('selected');
            container.classList.add('has-selection');
        }

        // Note is selected but NOT in edit mode yet
        // User can click again to enter edit mode, or press delete to remove

        // Exit editing on Enter (if in edit mode)
        const enterHandler = e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                noteElement.blur();
                noteElement.setAttribute('contenteditable', 'false');
            }
        };
        noteElement.addEventListener('keydown', enterHandler);

        const toolbar = container.querySelector('.plan-note-toolbar');

        // Position toolbar centered above the element
        const rect = noteElement.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const toolbarWidth = 280; // Approximate toolbar width

        // Center horizontally above the element
        const elementCenterX = rect.left - containerRect.left + rect.width / 2;
        let leftPos = elementCenterX - toolbarWidth / 2;
        // Ensure toolbar stays within bounds
        const maxLeft = containerRect.width - toolbarWidth - 8;
        leftPos = Math.max(8, Math.min(leftPos, maxLeft));

        toolbar.style.left = leftPos + 'px';
        toolbar.style.top = Math.max(8, rect.top - containerRect.top - 12) + 'px';

        toolbar.classList.remove('hidden');

        // Update snap toggle state
        const snapToggle = container.querySelector('.plan-note-snap-toggle');
        if (snapToggle) snapToggle.checked = note.snapToDate !== false;

        // Update color pickers
        const fontColorPicker = container.querySelector('.plan-font-color-picker');
        const fontColorIndicator = container.querySelector('.plan-font-color-indicator');
        const bgColorPicker = container.querySelector('.plan-bg-color-picker');
        const bgColorIndicator = container.querySelector('.plan-bg-color-indicator');

        if (fontColorPicker) fontColorPicker.value = note.fontColor || '#333333';
        if (fontColorIndicator) fontColorIndicator.style.background = note.fontColor || '#333333';
        if (bgColorPicker) bgColorPicker.value = note.bgColor || '#ffff00';
        if (bgColorIndicator) bgColorIndicator.style.background = note.bgColor || 'transparent';
    }

    // Show line editor toolbar
    function showLineEditor(lineId, lineElement) {
        const line = freeformLines.find(l => l.id === lineId);
        if (!line) return;

        deselectElement();
        selectedElements.push({ type: 'line', id: lineId, element: lineElement });
        lineElement.classList.add('selected');
        container.classList.add('has-selection');

        const toolbar = container.querySelector('.plan-line-toolbar');

        // Position toolbar centered above the element
        const rect = lineElement.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const toolbarWidth = 280; // Approximate line toolbar width

        // Center horizontally above the element
        const elementCenterX = rect.left - containerRect.left + rect.width / 2;
        let leftPos = elementCenterX - toolbarWidth / 2;
        // Ensure toolbar stays within bounds
        const maxLeft = containerRect.width - toolbarWidth - 8;
        leftPos = Math.max(8, Math.min(leftPos, maxLeft));

        toolbar.style.left = leftPos + 'px';
        toolbar.style.top = Math.max(8, rect.top - containerRect.top - 12) + 'px';

        toolbar.classList.remove('hidden');

        // Update label field
        const labelField = container.querySelector('.plan-line-label-field');
        if (labelField) {
            labelField.value = line.label || '';
            // Remove old listener and add new one
            labelField.onchange = null;
            labelField.oninput = () => {
                line.label = labelField.value.trim();
                // Update the label element in the line container
                const lineContainer = canvasLayer.querySelector(`.plan-note-line-container[data-line-id="${lineId}"]`);
                if (lineContainer) {
                    const labelEl = lineContainer.querySelector('.plan-line-label');
                    if (labelEl) {
                        labelEl.textContent = line.label;
                        if (line.label) {
                            labelEl.classList.remove('empty');
                        } else {
                            labelEl.classList.add('empty');
                        }
                    }
                }
                saveData();
            };
        }

        // Update color picker
        const colorPicker = container.querySelector('.plan-line-color-picker');
        const colorIndicator = container.querySelector('.plan-line-color-indicator');
        if (colorPicker) colorPicker.value = line.color || '#333333';
        if (colorIndicator) colorIndicator.style.background = line.color || '#333333';

        // Update width select
        const widthSelect = container.querySelector('.plan-line-width-select');
        if (widthSelect) widthSelect.value = line.width || 8;
    }

    // Deselect all selected elements and hide toolbars
    function deselectElement() {
        selectedElements.forEach(sel => {
            sel.element.classList.remove('selected');

            if (sel.type === 'note') {
                sel.element.setAttribute('contenteditable', 'false');
                const note = freeformNotes.find(n => n.id === sel.id);
                if (note) {
                    note.html = sel.element.innerHTML;
                    note.text = sel.element.textContent.trim();
                }
            }

            // Remove selected class from line containers (hides handles)
            if (sel.type === 'line') {
                const lineContainer = sel.element.closest('.plan-note-line-container');
                if (lineContainer) lineContainer.classList.remove('selected');
            }
        });

        if (selectedElements.length > 0) {
            saveData();
        }
        selectedElements = [];

        container.classList.remove('has-selection');
        container.querySelector('.plan-note-toolbar')?.classList.add('hidden');
        container.querySelector('.plan-line-toolbar')?.classList.add('hidden');
    }

    // Delete all selected elements
    function deleteSelectedElement() {
        if (selectedElements.length === 0) return;

        pushHistory();

        selectedElements.forEach(sel => {
            if (sel.type === 'note') {
                freeformNotes = freeformNotes.filter(n => n.id !== sel.id);
                sel.element.remove();
            } else if (sel.type === 'line') {
                freeformLines = freeformLines.filter(l => l.id !== sel.id);
                const containerEl = sel.element.closest('.plan-note-line-container');
                if (containerEl) containerEl.remove();
                else sel.element.remove();
            }
        });

        saveData();
        selectedElements = [];
        container.classList.remove('has-selection');
        container.querySelector('.plan-note-toolbar')?.classList.add('hidden');
        container.querySelector('.plan-line-toolbar')?.classList.add('hidden');
    }

    function setupEventListeners() {
        container.querySelectorAll('.plan-view-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                setCalendarViewMode(btn.dataset.view);
            });
        });

        const goalAddBtn = container.querySelector('.plan-week-goal-add-btn');
        const goalSaveBtn = container.querySelector('.plan-week-goal-save-btn');
        const goalCancelBtn = container.querySelector('.plan-week-goal-cancel-btn');
        const goalTextInput = container.querySelector('.plan-week-goal-text-input');
        const goalAssigneeSelect = container.querySelector('.plan-week-goal-assignee-select');

        goalAddBtn?.addEventListener('click', () => {
            const form = container.querySelector('.plan-week-goal-form');
            if (form?.classList.contains('hidden') || editingGoalId) {
                showWeekGoalForm();
            } else {
                hideWeekGoalForm();
            }
        });

        goalSaveBtn?.addEventListener('click', saveWeekGoalFromForm);

        goalCancelBtn?.addEventListener('click', hideWeekGoalForm);

        goalTextInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveWeekGoalFromForm();
            } else if (event.key === 'Escape') {
                hideWeekGoalForm();
            }
        });

        // Scroll 3 months to the left / navigate previous week
        container.querySelector('.plan-prev-period-btn').addEventListener('click', () => {
            if (calendarViewMode === 'week') {
                hideWeekGoalForm();
                weekStartDate = addDays(weekStartDate, -7);
                renderCalendar();
                renderFreeformElements();
                updatePeriodDisplay();
                renderWeekGoals();
                requestAnimationFrame(() => scrollWeekViewToCurrentTime());
                return;
            }

            const scrollAmount = COLUMN_WIDTH * 3;
            calendarContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
        });

        // Scroll 3 months to the right / navigate next week
        container.querySelector('.plan-next-period-btn').addEventListener('click', () => {
            if (calendarViewMode === 'week') {
                hideWeekGoalForm();
                weekStartDate = addDays(weekStartDate, 7);
                renderCalendar();
                renderFreeformElements();
                updatePeriodDisplay();
                renderWeekGoals();
                requestAnimationFrame(() => scrollWeekViewToCurrentTime());
                return;
            }

            const scrollAmount = COLUMN_WIDTH * 3;
            calendarContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        });

        // Go to today button
        container.querySelector('.plan-today-btn')?.addEventListener('click', () => {
            const today = new Date();

            if (calendarViewMode === 'week') {
                hideWeekGoalForm();
                weekStartDate = getMondayOfWeek(today);
                renderCalendar();
                renderFreeformElements();
                updatePeriodDisplay();
                renderWeekGoals();
                requestAnimationFrame(() => scrollWeekViewToCurrentTime());
                return;
            }

            const todayMonth = today.getMonth();
            const todayYear = today.getFullYear();

            // Find today's month column
            const todayCol = container.querySelector(`.plan-month-column[data-month="${todayMonth}"][data-year="${todayYear}"]`);

            if (todayCol) {
                // Scroll to put today's column at far left (like app's opening position)
                const colLeft = todayCol.offsetLeft;
                calendarContainer.scrollTo({ left: colLeft, behavior: 'smooth' });
            } else {
                // Today's column not in DOM, re-render starting from today
                startMonth = todayMonth;
                startYear = todayYear;
                renderCalendar();
                renderFreeformElements();
                updatePeriodDisplay();
            }
        });

        // Update period display and handle infinite loading as user scrolls
        let scrollTimeout;
        let lastScrollLeft = calendarContainer.scrollLeft;

        calendarContainer.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            // Canvas scrolls with content naturally, no need to re-render lines

            scrollTimeout = setTimeout(() => {
                updatePeriodDisplay();

                if (calendarViewMode === 'week') return;

                // Only check for loading more months if horizontal scroll changed
                const currentScrollLeft = calendarContainer.scrollLeft;
                if (currentScrollLeft !== lastScrollLeft) {
                    console.log('[Plan] Horizontal scroll changed:', lastScrollLeft, '->', currentScrollLeft);
                    lastScrollLeft = currentScrollLeft;
                    checkAndLoadMoreMonths();
                }
            }, 100);
        });
    }

    // Check scroll position and load more months if near edge
    function checkAndLoadMoreMonths() {
        const grid = container.querySelector('.plan-calendar-grid');
        const scrollLeft = calendarContainer.scrollLeft;
        const scrollRight = scrollLeft + calendarContainer.clientWidth;
        const totalWidth = grid.scrollWidth;

        const LOAD_THRESHOLD = COLUMN_WIDTH * 3; // Load more when within 3 columns of edge
        const MONTHS_TO_ADD = 6;

        // Near right edge - append more months
        if (scrollRight > totalWidth - LOAD_THRESHOLD) {
            appendMonths(MONTHS_TO_ADD);
        }

        // Near left edge - prepend more months
        if (scrollLeft < LOAD_THRESHOLD) {
            prependMonths(MONTHS_TO_ADD);
        }
    }

    // Append months to the right
    function appendMonths(count) {
        const grid = container.querySelector('.plan-calendar-grid');
        const lastCol = grid.querySelector('.plan-month-column:last-child');
        if (!lastCol) return;

        let month = parseInt(lastCol.dataset.month) + 1;
        let year = parseInt(lastCol.dataset.year);

        if (month > 11) { month = 0; year++; }

        for (let i = 0; i < count; i++) {
            grid.appendChild(createMonthColumn(month, year));
            month++;
            if (month > 11) { month = 0; year++; }
        }

        // Update grid template
        const colCount = grid.querySelectorAll('.plan-month-column').length;
        grid.style.gridTemplateColumns = `repeat(${colCount}, 240px)`;
    }

    // Prepend months to the left
    function prependMonths(count) {
        const grid = container.querySelector('.plan-calendar-grid');
        const firstCol = grid.querySelector('.plan-month-column:first-child');
        if (!firstCol) return;

        let month = parseInt(firstCol.dataset.month) - 1;
        let year = parseInt(firstCol.dataset.year);

        if (month < 0) { month = 11; year--; }

        // Save current scroll position
        const oldScrollLeft = calendarContainer.scrollLeft;

        for (let i = 0; i < count; i++) {
            grid.insertBefore(createMonthColumn(month, year), grid.firstChild);
            month--;
            if (month < 0) { month = 11; year--; }
        }

        // Update grid template
        const colCount = grid.querySelectorAll('.plan-month-column').length;
        grid.style.gridTemplateColumns = `repeat(${colCount}, 240px)`;

        // Adjust scroll position to maintain visual position
        const addedWidth = COLUMN_WIDTH * count;
        calendarContainer.scrollLeft = oldScrollLeft + addedWidth;

        // Re-render freeform elements since their screen positions have changed
        // With date-relative coordinates, lines will automatically render in correct positions
        renderFreeformElements();

        // Update start tracking
        startMonth = month + 1;
        if (startMonth > 11) { startMonth = 0; startYear = year + 1; }
        else startYear = year;
    }

    function dismissFreeformInput() {
        const existingInput = canvasLayer?.querySelector('.plan-note-input-inline');
        if (existingInput) existingInput.blur();
    }

    function beginFreeformNoteAt(clientX, clientY) {
        if (!canvasLayer) return;
        const rect = canvasLayer.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const snapped = findClosestDateRowPosition(x, y);
        if (!snapped.dateKey) return;
        createFreeformInput(snapped.x, snapped.y, snapped.dateKey, snapped.offsetX);
    }

    function setupCanvasInteraction() {
        calendarContainer.addEventListener('mousedown', e => {
            if (
                e.target.closest('.plan-note-text') ||
                e.target.closest('.plan-note-line') ||
                e.target.closest('.plan-line-handle') ||
                e.target.closest('.plan-line-label') ||
                e.target.closest('.plan-week-goal-pill') ||
                e.target.closest('.plan-week-goals') ||
                e.target.closest('.plan-week-day-goals') ||
                e.target.closest('.plan-week-day-header') ||
                e.target.closest('.plan-note-input-inline')
            ) {
                return;
            }

            if (isWeekGoalDragInProgress) return;

            // Single click elsewhere dismisses an active note input
            dismissFreeformInput();

            // If something is selected, deselect it and don't start a new interaction
            if (selectedElements.length > 0) {
                deselectElement();
                return;
            }

            // Get fresh rect at mousedown time
            const getRect = () => canvasLayer.getBoundingClientRect();
            const initialRect = getRect();
            // canvasLayer scrolls with content, so its getBoundingClientRect() already 
            // accounts for scroll position. No need to add scrollTop/scrollLeft.
            const startX = e.clientX - initialRect.left;
            const startY = e.clientY - initialRect.top;
            let isDragging = false;

            const tempLine = document.createElement('div');
            tempLine.className = 'plan-note-line temp';
            tempLine.style.left = startX + 'px';
            tempLine.style.top = startY + 'px';
            tempLine.style.width = '0';
            canvasLayer.appendChild(tempLine);

            const move = ev => {
                // Get fresh rect in case window was resized
                const rect = getRect();
                // No scroll offset needed - rect already reflects scroll
                const x = ev.clientX - rect.left;
                const y = ev.clientY - rect.top;
                const dx = x - startX, dy = y - startY;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 5) {
                    isDragging = true;
                    tempLine.style.width = len + 'px';
                    tempLine.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
                    tempLine.style.transformOrigin = '0 50%';
                }
            };

            const up = ev => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                tempLine.remove();

                // Get fresh rect for final coordinates
                const rect = getRect();
                // No scroll offset needed - rect already reflects scroll
                const endX = ev.clientX - rect.left;
                const endY = ev.clientY - rect.top;

                if (isDragging && Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2) > 10) {
                    pushHistory();

                    // Convert pixel coords to date-relative coords for stable storage
                    const startCoords = screenToDateCoords(startX, startY);
                    const endCoords = screenToDateCoords(endX, endY);

                    const line = {
                        id: Date.now().toString(),
                        // New date-relative format
                        startDate: startCoords.dateKey,
                        startOffsetX: startCoords.offsetX,
                        endDate: endCoords.dateKey,
                        endOffsetX: endCoords.offsetX,
                        color: null, // Let CSS control color for dark/light mode support
                        width: 8,
                        group: activeGroup
                    };

                    console.log('[Plan] New line created with date coords:', line);
                    freeformLines.push(line);
                    saveData();
                    canvasLayer.appendChild(createLine(line));
                }
            };

            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        calendarContainer.addEventListener('dblclick', e => {
            if (
                e.target.closest('.plan-note-text') ||
                e.target.closest('.plan-note-line') ||
                e.target.closest('.plan-line-handle') ||
                e.target.closest('.plan-line-label') ||
                e.target.closest('.plan-week-goal-pill') ||
                e.target.closest('.plan-week-goals') ||
                e.target.closest('.plan-week-day-goals') ||
                e.target.closest('.plan-week-day-header')
            ) {
                return;
            }

            e.preventDefault();
            beginFreeformNoteAt(e.clientX, e.clientY);
        });
    }

    function setupToolbarListeners() {
        // Undo/Redo
        container.querySelector('.plan-undo-btn').addEventListener('click', () => {
            if (undoStack.length === 0) return;
            redoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
            const prev = undoStack.pop();
            freeformNotes = prev.notes; freeformLines = prev.lines;
            saveData(); renderFreeformElements(); updateUndoRedoButtons();
        });

        container.querySelector('.plan-redo-btn').addEventListener('click', () => {
            if (redoStack.length === 0) return;
            undoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
            const next = redoStack.pop();
            freeformNotes = next.notes; freeformLines = next.lines;
            saveData(); renderFreeformElements(); updateUndoRedoButtons();
        });

        // Calendar sync buttons
        const calendarSyncAllBtn = container.querySelector('.plan-calendar-sync-all-btn');
        const calendarTogglesEl = container.querySelector('.plan-calendar-toggles');
        if (calendarTogglesEl) {
            calendarTogglesEl.addEventListener('wheel', (e) => {
                if (calendarTogglesEl.scrollWidth <= calendarTogglesEl.clientWidth) return;
                if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
                e.preventDefault();
                calendarTogglesEl.scrollLeft += e.deltaY;
            }, { passive: false });
        }
        const calendarAddBtn = container.querySelector('.plan-calendar-add-btn');
        const calendarPopover = container.querySelector('.plan-calendar-popover');
        const calendarList = container.querySelector('.plan-calendar-list');
        const calendarNameInput = container.querySelector('.plan-calendar-name-input');
        const calendarUrlInput = container.querySelector('.plan-calendar-url-input');
        const calendarAddSaveBtn = container.querySelector('.plan-calendar-add-save-btn');
        const calendarStatus = container.querySelector('.plan-calendar-status');
        let editingCalendarId = null;

        const trashIconSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
        const pencilIconSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;

        function resetCalendarEditForm() {
            editingCalendarId = null;
            if (calendarNameInput) calendarNameInput.value = '';
            if (calendarUrlInput) calendarUrlInput.value = '';
            if (calendarAddSaveBtn) calendarAddSaveBtn.textContent = 'Add Calendar';
        }

        function startCalendarEdit(cal) {
            editingCalendarId = cal.id;
            if (calendarNameInput) calendarNameInput.value = cal.name || '';
            if (calendarUrlInput) calendarUrlInput.value = cal.url || '';
            if (calendarAddSaveBtn) calendarAddSaveBtn.textContent = 'Save changes';
            calendarNameInput?.focus();
        }

        // Render calendar list in popover
        function renderCalendarList() {
            if (!calendarList) return;
            if (calendars.length === 0) {
                calendarList.innerHTML = '<div class="plan-calendar-empty">No calendars added yet</div>';
                return;
            }
            calendarList.innerHTML = calendars.map(cal => {
                const urlPreview = cal.url.length > 40 ? `${cal.url.substring(0, 40)}...` : cal.url;
                return `
                <div class="plan-calendar-item${editingCalendarId === cal.id ? ' editing' : ''}" data-id="${cal.id}">
                    <div class="plan-calendar-item-info">
                        <span class="plan-calendar-item-name">${cal.name || 'Unnamed'}</span>
                        <span class="plan-calendar-item-url">${urlPreview}</span>
                    </div>
                    <div class="plan-calendar-item-actions">
                        <button type="button" class="plan-calendar-item-edit" data-id="${cal.id}" title="Edit calendar">
                            ${pencilIconSVG}
                        </button>
                        <button type="button" class="plan-calendar-item-delete" data-id="${cal.id}" title="Remove calendar">
                            ${trashIconSVG}
                        </button>
                    </div>
                </div>
            `;
            }).join('');

            calendarList.querySelectorAll('.plan-calendar-item-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const cal = calendars.find(c => c.id === btn.dataset.id);
                    if (cal) startCalendarEdit(cal);
                    renderCalendarList();
                });
            });

            calendarList.querySelectorAll('.plan-calendar-item-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    const index = calendars.findIndex(c => c.id === id);
                    if (index === -1) return;

                    const deleted = JSON.parse(JSON.stringify(calendars[index]));
                    const calName = deleted.name || 'Calendar';

                    calendars = calendars.filter(c => c.id !== id);
                    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                    if (editingCalendarId === id) resetCalendarEditForm();
                    renderCalendarList();
                    await syncAllCalendars();
                    updateCalendarStatus();
                    renderCalendarToggles();

                    if (typeof window.showUndoForDeletion === 'function') {
                        window.showUndoForDeletion({
                            type: 'plan_calendar',
                            data: deleted,
                            index,
                        }, `Calendar '${calName}' removed`);
                    }
                });
            });
        }

        // Sync all calendars - merges events into freeformNotes/freeformLines
        async function syncAllCalendars() {
            if (calendarSyncInProgress) {
                return calendarSyncInProgress;
            }

            calendarSyncInProgress = (async () => {
            // Start spinning animation
            if (calendarSyncAllBtn) calendarSyncAllBtn.classList.add('syncing');
            if (calendarStatus) calendarStatus.textContent = 'Syncing...';

            try {
                // Save user customizations (horizontal position, labels) from existing calendar items
                // These will be restored after re-syncing
                const noteCustomizations = {};
                const lineCustomizations = {};

                freeformNotes.filter(n => isCalendarPlannerItem(n)).forEach(n => {
                    noteCustomizations[n.id] = { offsetX: n.offsetX, label: n.label };
                });
                freeformLines.filter(l => isCalendarPlannerItem(l)).forEach(l => {
                    lineCustomizations[l.id] = { verticalLineX: l.verticalLineX, label: l.label };
                });

                // Remove all existing calendar-sourced items from freeform arrays
                freeformNotes = freeformNotes.filter(n => !isCalendarPlannerItem(n));
                freeformLines = freeformLines.filter(l => !isCalendarPlannerItem(l));

                if (calendars.length === 0) {
                    calendarLastSync = null;
                    localStorage.removeItem(CALENDAR_LAST_SYNC_KEY);
                    saveData();
                    renderFreeformElements();
                    updateCalendarStatus();
                    renderCalendarToggles();
                    return;
                }

                const CalendarSync = window.CalendarSync;
                if (!CalendarSync) throw new Error('CalendarSync module not loaded');

                for (const cal of calendars) {
                    try {
                        const result = await CalendarSync.syncCalendar(cal.url);

                        // Add calendar styling and source markers to notes
                        result.notes.forEach(n => {
                            n.source = 'calendar';
                            n.calendarId = cal.id;
                            n.calendarName = cal.name;
                            n.fontFamily = cal.fontFamily || 'Inter';
                            n.fontColor = cal.fontColor || '#4a90e2';
                        });

                        // Add calendar styling and source markers to lines
                        result.lines.forEach(l => {
                            l.source = 'calendar';
                            l.calendarId = cal.id;
                            l.calendarName = cal.name;
                            l.color = cal.lineColor || '#4a90e2';
                            l.fontFamily = cal.fontFamily || 'Inter';
                            l.fontColor = cal.fontColor || '#4a90e2';
                        });

                        // Merge into freeform arrays, restoring user customizations
                        result.notes.forEach(n => {
                            if (noteCustomizations[n.id]) {
                                if (noteCustomizations[n.id].offsetX !== undefined) {
                                    n.offsetX = noteCustomizations[n.id].offsetX;
                                }
                                if (noteCustomizations[n.id].label !== undefined) {
                                    n.label = noteCustomizations[n.id].label;
                                }
                            }
                            freeformNotes.push(n);
                        });
                        result.lines.forEach(l => {
                            if (lineCustomizations[l.id]) {
                                if (lineCustomizations[l.id].verticalLineX !== undefined) {
                                    l.verticalLineX = lineCustomizations[l.id].verticalLineX;
                                }
                                if (lineCustomizations[l.id].label !== undefined) {
                                    l.label = lineCustomizations[l.id].label;
                                }
                            }
                            freeformLines.push(l);
                        });
                    } catch (err) {
                        console.warn(`[Plan] Failed to sync calendar "${cal.name}":`, err);
                    }
                }

                calendarLastSync = new Date().toISOString();
                localStorage.setItem(CALENDAR_LAST_SYNC_KEY, calendarLastSync);

                // Save merged data
                saveData();
                renderFreeformElements();
                updateCalendarStatus();
                renderCalendarToggles();

                console.log('[Plan] All calendars synced and merged:', {
                    calendars: calendars.length,
                    totalNotes: freeformNotes.length,
                    totalLines: freeformLines.length
                });
            } catch (error) {
                console.error('[Plan] Calendar sync error:', error);
                if (calendarStatus) calendarStatus.textContent = 'Sync failed: ' + error.message;
            } finally {
                // Stop spinning animation
                if (calendarSyncAllBtn) calendarSyncAllBtn.classList.remove('syncing');
                calendarSyncInProgress = null;
            }
            })();

            return calendarSyncInProgress;
        }

        // Sync All button
        if (calendarSyncAllBtn) {
            calendarSyncAllBtn.addEventListener('click', () => {
                syncAllCalendars();
            });
        }

        // Add Calendar button - opens popover
        if (calendarAddBtn && calendarPopover) {
            calendarAddBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                calendarPopover.classList.toggle('hidden');
                const btnRect = calendarAddBtn.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                calendarPopover.style.top = (btnRect.bottom - containerRect.top + 5) + 'px';
                calendarPopover.style.right = (containerRect.right - btnRect.right) + 'px';
                renderCalendarList();
                updateCalendarStatus();
                renderCalendarToggles();
            });

            // Help icon - toggle help content
            const helpIcon = calendarPopover.querySelector('.plan-calendar-help-icon');
            const helpContent = calendarPopover.querySelector('.plan-calendar-help-content');
            if (helpIcon && helpContent) {
                helpIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    helpContent.classList.toggle('hidden');
                    helpIcon.classList.toggle('active');
                });
            }
        }

        // Close popover when clicking outside (anywhere in document)
        if (calendarPopover) {
            document.addEventListener('click', (e) => {
                const isInsidePopover = calendarPopover.contains(e.target);
                const isAddBtn = calendarAddBtn && calendarAddBtn.contains(e.target);
                const isSyncBtn = calendarSyncAllBtn && calendarSyncAllBtn.contains(e.target);
                if (!isInsidePopover && !isAddBtn && !isSyncBtn) {
                    calendarPopover.classList.add('hidden');
                }
            });
        }

        // Add Calendar save button
        if (calendarAddSaveBtn) {
            calendarAddSaveBtn.addEventListener('click', async () => {
                const name = calendarNameInput?.value?.trim() || 'Calendar ' + (calendars.length + 1);
                const url = calendarUrlInput?.value?.trim();
                if (!url) {
                    if (calendarStatus) calendarStatus.textContent = 'Please enter a calendar URL';
                    return;
                }

                if (editingCalendarId) {
                    const cal = calendars.find(c => c.id === editingCalendarId);
                    if (cal) {
                        cal.name = name;
                        cal.url = url;
                        localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                        resetCalendarEditForm();
                        renderCalendarList();
                        await syncAllCalendars();
                    }
                    return;
                }

                const id = 'cal-' + Date.now();
                calendars.push({ id, name, url });
                localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                resetCalendarEditForm();

                renderCalendarList();
                await syncAllCalendars();
            });
        }

        // Initial render of calendar list
        renderCalendarList();

        function updateCalendarStatus() {
            if (!calendarStatus) return;
            if (calendarLastSync) {
                const date = new Date(calendarLastSync);
                const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = date.toLocaleDateString();
                // Count calendar events from freeformNotes/Lines
                const totalEvents = freeformNotes.filter(n => n.source === 'calendar').length +
                    freeformLines.filter(l => l.source === 'calendar').length;
                calendarStatus.textContent = `Last synced: ${dateStr} ${timeStr} • ${calendars.length} cal${calendars.length !== 1 ? 's' : ''} • ${totalEvents} events`;
            } else if (calendars.length > 0) {
                calendarStatus.textContent = 'Click the sync button to fetch events';
            } else {
                calendarStatus.textContent = 'Add a calendar above to get started';
            }
        }

        // Render calendar visibility toggles in the navbar as chips with eye icons
        function renderCalendarToggles() {
            const togglesContainer = container.querySelector('.plan-calendar-toggles');
            if (!togglesContainer) return;
            togglesContainer.innerHTML = '';

            // SVG paths for eye icons
            const eyeOpenSVG = `<svg class="calendar-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
            const eyeClosedSVG = `<svg class="calendar-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;

            calendars.forEach(cal => {
                // Default to visible if not set
                if (cal.visible === undefined) cal.visible = true;

                const chip = document.createElement('div');
                chip.className = 'plan-calendar-toggle' + (cal.visible ? '' : ' hidden-cal');
                chip.title = 'Toggle visibility • Click name to rename';

                // Build chip inner HTML
                const calColor = cal.fontColor || '#4a90e2';
                const emoji = cal.emoji || '';
                chip.innerHTML = `
                    <span class="calendar-toggle-eye">${cal.visible ? eyeOpenSVG : eyeClosedSVG}</span>
                    ${emoji ? `<span class="calendar-toggle-emoji">${emoji}</span>` : ''}
                    <span class="calendar-name">${cal.name || 'Calendar'}</span>
                    <span class="calendar-toggle-color" title="Change calendar color">
                        <span class="calendar-color-dot" style="background: ${calColor}"></span>
                    </span>
                `;

                // Toggle visibility when clicking the eye icon
                const eyeSpan = chip.querySelector('.calendar-toggle-eye');
                eyeSpan.addEventListener('click', e => {
                    e.stopPropagation();
                    cal.visible = !cal.visible;
                    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                    renderFreeformElements();
                    eyeSpan.innerHTML = cal.visible ? eyeOpenSVG : eyeClosedSVG;
                    chip.classList.toggle('hidden-cal', !cal.visible);
                });

                // Color palette popover
                const colorWrapper = chip.querySelector('.calendar-toggle-color');
                const colorDot = chip.querySelector('.calendar-color-dot');
                // Keep in sync with PLAN_CALENDAR_COLOR_PRESETS in redd-plan/lib/canvasBackground.ts

                function applyColor(newColor) {
                    cal.fontColor = newColor;
                    cal.lineColor = newColor;
                    colorDot.style.background = newColor;
                    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                    freeformNotes.filter(n => n.calendarId === cal.id).forEach(n => {
                        n.fontColor = newColor;
                    });
                    freeformLines.filter(l => l.calendarId === cal.id).forEach(l => {
                        l.color = newColor;
                        l.fontColor = newColor;
                    });
                    saveData();
                    renderFreeformElements();
                }

                colorDot.addEventListener('click', e => {
                    e.stopPropagation();
                    appendChipColorPopover(colorWrapper, colorDot, cal.fontColor || '#7da9c8', applyColor);
                });

                // Click to rename calendar
                const nameSpan = chip.querySelector('.calendar-name');
                nameSpan.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();

                    nameSpan.contentEditable = 'true';
                    nameSpan.focus();

                    // Select all text
                    const range = document.createRange();
                    range.selectNodeContents(nameSpan);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);

                    const finishEdit = () => {
                        nameSpan.contentEditable = 'false';
                        const newName = nameSpan.textContent.trim();
                        if (newName && newName !== cal.name) {
                            cal.name = newName;
                            localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                        } else {
                            nameSpan.textContent = cal.name || 'Calendar';
                        }
                    };

                    nameSpan.addEventListener('blur', finishEdit, { once: true });
                    nameSpan.addEventListener('keydown', ke => {
                        if (ke.key === 'Enter') {
                            ke.preventDefault();
                            nameSpan.blur();
                        } else if (ke.key === 'Escape') {
                            nameSpan.textContent = cal.name || 'Calendar';
                            nameSpan.blur();
                        }
                    });
                });

                togglesContainer.appendChild(chip);
            });

            renderEnkeltTasksChip(togglesContainer, eyeOpenSVG, eyeClosedSVG);
        }
        refreshCalendarToggles = renderCalendarToggles;
        syncAllCalendarsFn = syncAllCalendars;
        renderCalendarListFn = renderCalendarList;

        // Formatting buttons (bold, italic, underline)
        container.querySelectorAll('.plan-note-toolbar .plan-toolbar-btn[data-command]').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault(); // Prevent losing focus from note
                const command = btn.dataset.command;
                document.execCommand(command, false, null);
            });
        });

        // Note toolbar handlers
        container.querySelector('.plan-note-delete-btn')?.addEventListener('click', deleteSelectedElement);

        container.querySelector('.plan-note-snap-toggle')?.addEventListener('change', e => {
            const selectedNotes = selectedElements.filter(s => s.type === 'note');
            if (selectedNotes.length > 0) {
                selectedNotes.forEach(sel => {
                    const note = freeformNotes.find(n => n.id === sel.id);
                    if (note) {
                        note.snapToDate = e.target.checked;
                        // If turning snap on, immediately snap the note
                        if (note.snapToDate) {
                            const snapped = findClosestDateRowPosition(note.x, note.y);
                            note.x = snapped.x;
                            note.y = snapped.y;
                            sel.element.style.left = snapped.x + 'px';
                            sel.element.style.top = snapped.y + 'px';
                        }
                    }
                });
                saveData();
            }
        });

        container.querySelector('.plan-font-color-picker')?.addEventListener('input', e => {
            const color = e.target.value;
            container.querySelector('.plan-font-color-indicator').style.background = color;

            const selectedNotes = selectedElements.filter(s => s.type === 'note');
            if (selectedNotes.length > 0) {
                pushHistory();
                selectedNotes.forEach(sel => {
                    const note = freeformNotes.find(n => n.id === sel.id);
                    if (note) {
                        note.fontColor = color;
                        sel.element.style.color = color;
                    }
                });
                saveData();
            }
        });

        container.querySelector('.plan-bg-color-picker')?.addEventListener('input', e => {
            const color = e.target.value;
            container.querySelector('.plan-bg-color-indicator').style.background = color;

            const selectedNotes = selectedElements.filter(s => s.type === 'note');
            if (selectedNotes.length > 0) {
                pushHistory();
                selectedNotes.forEach(sel => {
                    const note = freeformNotes.find(n => n.id === sel.id);
                    if (note) {
                        note.bgColor = color;
                        sel.element.style.backgroundColor = color;
                    }
                });
                saveData();
            }
        });

        container.querySelector('.plan-clear-bg-btn')?.addEventListener('click', () => {
            const selectedNotes = selectedElements.filter(s => s.type === 'note');
            if (selectedNotes.length > 0) {
                pushHistory();
                selectedNotes.forEach(sel => {
                    const note = freeformNotes.find(n => n.id === sel.id);
                    if (note) {
                        note.bgColor = null;
                        sel.element.style.backgroundColor = 'transparent';
                    }
                });
                container.querySelector('.plan-bg-color-indicator').style.background = 'transparent';
                saveData();
            }
        });

        // Line toolbar handlers
        container.querySelector('.plan-line-delete-btn')?.addEventListener('click', deleteSelectedElement);

        container.querySelector('.plan-line-color-picker')?.addEventListener('input', e => {
            const color = e.target.value;
            container.querySelector('.plan-line-color-indicator').style.background = color;

            const selectedLines = selectedElements.filter(s => s.type === 'line');
            if (selectedLines.length > 0) {
                pushHistory();
                selectedLines.forEach(sel => {
                    const line = freeformLines.find(l => l.id === sel.id);
                    if (line) {
                        line.color = color;
                        const lineEl = sel.element.closest('.plan-note-line-container')?.querySelector('.plan-note-line') || sel.element;
                        lineEl.style.background = color;
                    }
                });
                saveData();
            }
        });

        container.querySelector('.plan-line-width-select')?.addEventListener('change', e => {
            const width = parseInt(e.target.value);

            const selectedLines = selectedElements.filter(s => s.type === 'line');
            if (selectedLines.length > 0) {
                pushHistory();
                selectedLines.forEach(sel => {
                    const line = freeformLines.find(l => l.id === sel.id);
                    if (line) {
                        line.width = width;
                        const container = sel.element.closest('.plan-note-line-container') || sel.element;
                        const lineEl = container.querySelector('.plan-note-line') || sel.element;

                        // Vertical lines use width for bar thickness, horizontal use height
                        if (lineEl.classList.contains('vertical')) {
                            lineEl.style.width = width + 'px';
                        } else {
                            lineEl.style.height = width + 'px';
                        }
                    }
                });
                saveData();
            }
        });

        // Click outside to deselect or dismiss note input
        document.addEventListener('click', e => {
            if (!e.target.closest('.plan-note-input-inline') &&
                !e.target.closest('.plan-inline-toolbar') &&
                !e.target.closest('.plan-note-text') &&
                !e.target.closest('.plan-note-line')) {
                dismissFreeformInput();
            }

            if (!e.target.closest('.plan-inline-toolbar') &&
                !e.target.closest('.plan-note-text') &&
                !e.target.closest('.plan-note-line') &&
                !e.target.closest('.plan-note-input-inline') &&
                selectedElements.length > 0) {
                deselectElement();
            }
        });

        // Keyboard delete (Backspace/Delete key)
        document.addEventListener('keydown', e => {
            // Undo: Cmd/Ctrl + Z
            if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (undoStack.length > 0) {
                    redoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
                    const prev = undoStack.pop();
                    freeformNotes = prev.notes; freeformLines = prev.lines;
                    saveData(); renderFreeformElements(); updateUndoRedoButtons();
                }
                return;
            }

            // Redo: Cmd/Ctrl + Shift + Z
            if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                if (redoStack.length > 0) {
                    undoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
                    const next = redoStack.pop();
                    freeformNotes = next.notes; freeformLines = next.lines;
                    saveData(); renderFreeformElements(); updateUndoRedoButtons();
                }
                return;
            }

            // Delete selected elements
            if ((e.key === 'Backspace' || e.key === 'Delete') && selectedElements.length > 0) {
                // Don't delete if we're editing text (contenteditable) - check notes and line labels
                const editingNote = selectedElements.find(s =>
                    s.type === 'note' && s.element.getAttribute('contenteditable') === 'true'
                );
                // Also check if any line label is being edited
                const editingLabel = document.querySelector('.plan-line-label[contenteditable="true"]');
                if (editingNote || editingLabel) {
                    return; // Let normal text editing happen
                }
                e.preventDefault();
                deleteSelectedElement();
            }
        });

        // Initialize calendar toggles
        renderCalendarToggles();
    }

    function parseDateKeyLocal(dateKey) {
        const [year, month, day] = dateKey.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    function enumerateDateKeys(startDate, endDate) {
        const keys = [];
        let current = parseDateKeyLocal(startDate);
        const end = parseDateKeyLocal(endDate);
        while (current <= end) {
            keys.push(formatDateKey(current));
            current = addDays(current, 1);
        }
        return keys;
    }

    function stripTaskPlannerEntries(taskId) {
        freeformNotes = freeformNotes.filter((note) => note.taskId !== taskId);
        freeformLines = freeformLines.filter((line) => line.taskId !== taskId);
    }

    function refreshPlannerIfInitialized() {
        if (!isInitialized) return;
        refreshCalendarToggles();
        renderFreeformElements();
        scheduleLayoutRefresh();
    }

    function getTaskPlannerDates(taskId) {
        const line = freeformLines.find((l) => l.taskId === taskId && l.startDate && l.endDate);
        if (line) {
            return { startDate: line.startDate, endDate: line.endDate };
        }

        const notes = freeformNotes.filter((note) => note.taskId === taskId && note.dateKey);
        if (notes.length === 0) return null;
        const keys = notes.map((note) => note.dateKey).sort();
        return { startDate: keys[0], endDate: keys[keys.length - 1] };
    }

    function removeTaskFromPlanner(taskId) {
        const hadEntries = freeformNotes.some((note) => note.taskId === taskId)
            || freeformLines.some((line) => line.taskId === taskId);
        stripTaskPlannerEntries(taskId);
        if (hadEntries) {
            saveData();
            refreshPlannerIfInitialized();
        }
    }

    function updateTaskPlannerText(taskId, text) {
        const label = text.trim();
        if (!label) return;

        let changed = false;
        freeformNotes.forEach((note) => {
            if (note.taskId === taskId) {
                note.text = label;
                changed = true;
            }
        });
        freeformLines.forEach((line) => {
            if (line.taskId === taskId) {
                line.label = label;
                changed = true;
            }
        });

        if (changed) {
            saveData();
            refreshPlannerIfInitialized();
        }
    }

    function upsertTaskPlannerEntry({ taskId, text, startDate, endDate }) {
        if (!taskId || !text || !startDate) return false;

        let rangeStart = startDate;
        let rangeEnd = endDate || startDate;
        if (rangeEnd < rangeStart) {
            [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
        }

        const label = text.trim();
        if (!label) return false;

        stripTaskPlannerEntries(taskId);

        ensureTaskChipColor();
        const taskColor = getTaskChipColor();

        if (rangeStart === rangeEnd) {
            freeformNotes.push({
                id: `task-${taskId}-${rangeStart}`,
                text: label,
                dateKey: rangeStart,
                offsetX: 0,
                source: 'task',
                taskId,
                isAllDay: true,
                fontColor: taskColor,
            });
        } else {
            freeformLines.push({
                id: `task-line-${taskId}`,
                label,
                startDate: rangeStart,
                endDate: rangeEnd,
                source: 'task',
                taskId,
                color: taskColor,
                fontColor: taskColor,
                fontFamily: 'Inter',
                width: 8,
                isAllDay: true,
            });
        }

        saveData();
        refreshPlannerIfInitialized();
        return true;
    }

    async function restoreDeletedCalendar(calendar, index) {
        if (!calendar?.id) return;

        dedupeCalendars();
        if (calendars.some((cal) => cal.id === calendar.id)) return;
        const urlKey = (calendar.url || '').trim().toLowerCase();
        if (urlKey && calendars.some((cal) => (cal.url || '').trim().toLowerCase() === urlKey)) return;

        const insertAt = Math.min(Math.max(0, index ?? calendars.length), calendars.length);
        calendars.splice(insertAt, 0, calendar);
        localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
        renderCalendarListFn();
        await syncAllCalendarsFn();
    }

    function refresh() {
        // Re-read language setting and re-render
        loadLanguage();
        loadWeekGoals();
        loadGoalAssignees();
        loadTaskChipSettings();
        migrateTaskChipColorIfNeeded();
        updateGoalAssigneeSelectOptions();
        updateViewModeButtons();
        renderCalendar();
        refreshCalendarToggles();
        renderWeekGoals();
        scheduleLayoutRefresh();
    }

    return {
        init,
        destroy,
        refresh,
        upsertTaskPlannerEntry,
        removeTaskFromPlanner,
        getTaskPlannerDates,
        updateTaskPlannerText,
        restoreDeletedCalendar,
    };
})();

// Expose globally so React (or other host code) can call init/destroy.
if (typeof window !== 'undefined') {
    window.PlanModule = PlanModule;
}

// Export for Node/Electron
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlanModule;
}
