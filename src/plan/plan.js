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

    // Flag to prevent re-rendering during drag operations
    let isDragInProgress = false;

    // Constants
    const MONTHS_DA = ['Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'December'];
    const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const WEEKDAYS_DA = ['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø'];
    const WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

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
        { id: 'personal', translationKey: 'personal', color: '#667eea', visible: true },
        { id: 'work', translationKey: 'work', color: '#f59e0b', visible: true }
    ];

    // Storage keys
    const NOTES_KEY = STORAGE_PREFIX + 'freeform-notes';
    const LINES_KEY = STORAGE_PREFIX + 'freeform-lines';
    const GROUPS_KEY = STORAGE_PREFIX + 'groups';
    const ACTIVE_GROUP_KEY = STORAGE_PREFIX + 'active-group';
    // Calendar sync keys
    const CALENDARS_KEY = STORAGE_PREFIX + 'calendars'; // Array of {id, name, url, fontFamily, fontColor, lineColor}
    const CALENDAR_LAST_SYNC_KEY = STORAGE_PREFIX + 'calendar-last-sync';
    // Use shared keys for theme and language (no prefix) so they sync with main app
    const SHARED_LANGUAGE_KEY = 'language';

    // Calendar sync state - supports multiple calendars with per-calendar styling
    let calendars = []; // [{id, name, url, fontFamily, fontColor, lineColor}, ...]
    let calendarLastSync = null;

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
        setupEventListeners();
        setupCanvasInteraction();
        renderCalendar();
        updatePeriodDisplay();

        // Delay initial render of freeform elements to ensure DOM is fully laid out
        setTimeout(() => renderFreeformElements(), 100);
        setupToolbarListeners();

        isInitialized = true;
    }

    function destroy() {
        if (!isInitialized) return;
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
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M10 14h4"/><path d="M12 12v4"/></svg>
                        </button>
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
                    <p class="plan-calendar-hint">Events with "REDD-DO" in description will be shown</p>
                    <div class="plan-calendar-status"></div>
                </div>
            </div>
        `;
    }

    // Data functions
    function loadData() {
        try {
            const storedNotes = localStorage.getItem(NOTES_KEY);
            if (storedNotes) freeformNotes = JSON.parse(storedNotes);
            const storedLines = localStorage.getItem(LINES_KEY);
            if (storedLines) freeformLines = JSON.parse(storedLines);
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
            const storedLastSync = localStorage.getItem(CALENDAR_LAST_SYNC_KEY);
            if (storedLastSync) calendarLastSync = storedLastSync;

            // Count calendar events in freeformNotes/Lines for logging
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

    // Calendar functions
    function updatePeriodDisplay() {
        const display = container.querySelector('.plan-period-display');
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
        if (firstYear === lastYear) {
            display.textContent = `${firstMonthShort} – ${lastMonthShort} ${firstYear}`;
        } else {
            display.textContent = `${firstMonthShort} ${firstYear} – ${lastMonthShort} ${lastYear}`;
        }

        // Show/hide "Go to Today" button based on whether today's month is visible
        const todayBtn = container.querySelector('.plan-today-btn');
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

        // Clear canvas layer (for lines)
        canvasLayer.innerHTML = '';

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

        // Use requestAnimationFrame to ensure DOM is laid out before measuring positions
        requestAnimationFrame(() => {
            // Force reflow to ensure all layout calculations are complete
            // This is needed because getBoundingClientRect needs accurate positions
            // Get IDs of visible calendars
            const visibleCalendarIds = calendars.filter(c => c.visible !== false).map(c => c.id);

            // Filter function to check if item should be shown
            const isVisible = item => {
                if (item.source !== 'calendar') return true; // User items always visible
                const visible = visibleCalendarIds.includes(item.calendarId);
                return visible;
            };

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
            freeformNotes.filter(isVisible).forEach(note => {
                if (!note.dateKey) return; // Skip legacy notes without dateKey

                const row = container.querySelector(`.plan-day-row[data-date-key="${note.dateKey}"]`);
                if (row) {
                    const noteArea = row.querySelector('.plan-note-area');
                    if (noteArea) noteArea.appendChild(createNote(note));
                }
            });
        });
    }

    function createNote(note) {
        const el = document.createElement('span');
        el.className = 'plan-note-text freeform';

        // Add class for calendar-sourced notes
        if (note.source === 'calendar') {
            el.classList.add('calendar-event');
        }

        el.innerHTML = note.html || note.text || 'Note';

        // Absolute positioning within note-area using offsetX
        // Note: top position is handled by CSS (.plan-note-text.freeform { top: -4px })
        el.style.position = 'absolute';
        el.style.left = (note.offsetX || 0) + 'px';
        el.style.zIndex = note.source === 'calendar' ? '50' : '100'; // User notes on top of calendar events

        // Apply styling
        if (note.fontFamily) el.style.fontFamily = note.fontFamily + ', sans-serif';
        if (note.fontColor) el.style.color = note.fontColor;
        if (note.bgColor) el.style.backgroundColor = note.bgColor;

        el.dataset.noteId = note.id;
        if (note.source === 'calendar') {
            el.title = `From calendar: ${note.calendarName || 'Unknown'}`;
        }

        // Track dragging to distinguish from click
        let hasDragged = false;

        el.addEventListener('mousedown', e => {
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

        // Check if this is a calendar multi-day event (vertical line)
        const isCalendarLine = line.source === 'calendar' || line.isCalendarEvent;
        const isCalendarMultiDay = isCalendarLine && line.startDate && line.endDate && line.startDate !== line.endDate;

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

            containerEl.title = `From calendar: ${line.calendarName || 'Unknown'}`;
            containerEl.appendChild(lineEl);
            containerEl.appendChild(labelEl);

            // Horizontal drag to move vertical line left/right
            let isDragging = false;
            let dragStartX = 0;
            let initialLeft = 0;

            containerEl.style.cursor = 'ew-resize'; // Show horizontal resize cursor
            labelEl.style.cursor = 'ew-resize'; // Also on label

            containerEl.addEventListener('mousedown', (e) => {
                if (labelEl.getAttribute('contenteditable') === 'true') return;

                isDragInProgress = true;  // Prevent render during drag
                isDragging = true;
                dragStartX = e.clientX;
                initialLeft = parseFloat(containerEl.style.left) || 0;
                e.preventDefault();
                e.stopPropagation();

                const onMouseMove = (moveEvent) => {
                    if (!isDragging) return;
                    const deltaX = moveEvent.clientX - dragStartX;
                    const newLeft = initialLeft + deltaX;
                    containerEl.style.left = newLeft + 'px';
                };

                const onMouseUp = () => {
                    isDragInProgress = false;  // Re-enable render
                    if (isDragging) {
                        isDragging = false;
                        // Save the new horizontal position as relative offset from row
                        const newLeft = parseFloat(containerEl.style.left) || 0;
                        // Calculate relative offset: newLeft - rowLeftRelative = userOffset
                        line.verticalLineX = newLeft - rowLeftRelative;
                        saveData();
                    }
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            // Click to select and show line toolbar (same as user-drawn lines)
            const selectLine = (e) => {
                if (isDragging) return; // Don't select during drag
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
                // Select all text
                const range = document.createRange();
                range.selectNodeContents(labelEl);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            };

            lineEl.addEventListener('dblclick', editLabel);
            labelEl.addEventListener('dblclick', editLabel);

            // Save on blur/enter
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
        // Scroll 3 months to the left
        container.querySelector('.plan-prev-period-btn').addEventListener('click', () => {
            const scrollAmount = COLUMN_WIDTH * 3;
            calendarContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
        });

        // Scroll 3 months to the right
        container.querySelector('.plan-next-period-btn').addEventListener('click', () => {
            const scrollAmount = COLUMN_WIDTH * 3;
            calendarContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        });

        // Go to today button
        container.querySelector('.plan-today-btn')?.addEventListener('click', () => {
            const today = new Date();
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

    function setupCanvasInteraction() {
        calendarContainer.addEventListener('mousedown', e => {
            if (e.target.closest('.plan-note-text') || e.target.closest('.plan-note-line') || e.target.closest('.plan-line-handle') || e.target.closest('.plan-line-label')) return;

            // If something is selected, deselect it and don't create new content
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
                } else {
                    // Show input for new note
                    const snapped = findClosestDateRowPosition(startX, startY);
                    createFreeformInput(snapped.x, snapped.y, snapped.dateKey, snapped.offsetX);
                }
            };

            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
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
        const calendarAddBtn = container.querySelector('.plan-calendar-add-btn');
        const calendarPopover = container.querySelector('.plan-calendar-popover');
        const calendarList = container.querySelector('.plan-calendar-list');
        const calendarNameInput = container.querySelector('.plan-calendar-name-input');
        const calendarUrlInput = container.querySelector('.plan-calendar-url-input');
        const calendarAddSaveBtn = container.querySelector('.plan-calendar-add-save-btn');
        const calendarStatus = container.querySelector('.plan-calendar-status');

        // Render calendar list in popover
        function renderCalendarList() {
            if (!calendarList) return;
            if (calendars.length === 0) {
                calendarList.innerHTML = '<div class="plan-calendar-empty">No calendars added yet</div>';
                return;
            }
            calendarList.innerHTML = calendars.map(cal => `
                <div class="plan-calendar-item" data-id="${cal.id}">
                    <div class="plan-calendar-item-info">
                        <span class="plan-calendar-item-name">${cal.name || 'Unnamed'}</span>
                        <span class="plan-calendar-item-url">${cal.url.substring(0, 40)}...</span>
                    </div>
                    <button class="plan-calendar-item-delete" data-id="${cal.id}" title="Remove calendar">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
            `).join('');

            // Add delete handlers
            calendarList.querySelectorAll('.plan-calendar-item-delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    calendars = calendars.filter(c => c.id !== id);
                    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                    renderCalendarList();
                    syncAllCalendars(); // Re-sync to update events
                });
            });
        }

        // Sync all calendars - merges events into freeformNotes/freeformLines
        async function syncAllCalendars() {
            // Start spinning animation
            if (calendarSyncAllBtn) calendarSyncAllBtn.classList.add('syncing');
            if (calendarStatus) calendarStatus.textContent = 'Syncing...';

            try {
                // Save user customizations (horizontal position, labels) from existing calendar items
                // These will be restored after re-syncing
                const noteCustomizations = {};
                const lineCustomizations = {};

                freeformNotes.filter(n => n.source === 'calendar').forEach(n => {
                    noteCustomizations[n.id] = { offsetX: n.offsetX, label: n.label };
                });
                freeformLines.filter(l => l.source === 'calendar').forEach(l => {
                    lineCustomizations[l.id] = { verticalLineX: l.verticalLineX, label: l.label };
                });

                // Remove all existing calendar-sourced items from freeform arrays
                freeformNotes = freeformNotes.filter(n => n.source !== 'calendar');
                freeformLines = freeformLines.filter(l => l.source !== 'calendar');

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
                            n.fontColor = cal.fontColor || '#818cf8';
                        });

                        // Add calendar styling and source markers to lines
                        result.lines.forEach(l => {
                            l.source = 'calendar';
                            l.calendarId = cal.id;
                            l.calendarName = cal.name;
                            l.color = cal.lineColor || '#6366f1';
                            l.fontFamily = cal.fontFamily || 'Inter';
                            l.fontColor = cal.fontColor || '#818cf8';
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
            }
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

                // Generate unique ID
                const id = 'cal-' + Date.now();
                calendars.push({ id, name, url });
                localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));

                // Clear inputs
                if (calendarNameInput) calendarNameInput.value = '';
                if (calendarUrlInput) calendarUrlInput.value = '';

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

        // Render calendar visibility toggles in the navbar
        function renderCalendarToggles() {
            const togglesContainer = container.querySelector('.plan-calendar-toggles');
            if (!togglesContainer) return;
            togglesContainer.innerHTML = '';

            calendars.forEach(cal => {
                // Default to visible if not set
                if (cal.visible === undefined) cal.visible = true;

                const toggle = document.createElement('label');
                toggle.className = 'plan-calendar-toggle';
                toggle.title = 'Click name to rename';
                toggle.innerHTML = `
                    <input type="checkbox" ${cal.visible ? 'checked' : ''}>
                    <span class="calendar-name" style="color: ${cal.fontColor || '#6366f1'}">${cal.name || 'Calendar'}</span>
                `;
                toggle.querySelector('input').addEventListener('change', e => {
                    cal.visible = e.target.checked;
                    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                    renderFreeformElements();
                });

                // Click to rename calendar
                const nameSpan = toggle.querySelector('.calendar-name');
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

                togglesContainer.appendChild(toggle);
            });
        }

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

        // Click outside to deselect
        document.addEventListener('click', e => {
            if (!e.target.closest('.plan-inline-toolbar') &&
                !e.target.closest('.plan-note-text') &&
                !e.target.closest('.plan-note-line') &&
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

    function refresh() {
        // Re-read language setting and re-render
        loadLanguage();
        renderCalendar();
    }

    return { init, destroy, refresh };
})();

// Export for Node/Electron
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlanModule;
}
