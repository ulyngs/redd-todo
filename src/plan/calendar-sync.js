// Calendar Sync Module for Plan Mode
// Fetches and parses ICS calendar feeds, filtering events by "REDD-DO" prefix

const CalendarSync = (function () {
    'use strict';

    // Parse ICS data and return events
    function parseICS(icsData) {
        try {
            // ICAL.js is loaded as a module, access via window.ICAL or global ICAL
            const ICAL = window.ICAL || (typeof require !== 'undefined' ? require('../lib/ical.js').default : null);
            if (!ICAL) {
                throw new Error('ICAL.js library not loaded');
            }

            const jcalData = ICAL.parse(icsData);
            const comp = new ICAL.Component(jcalData);
            const vevents = comp.getAllSubcomponents('vevent');

            const events = [];
            for (const vevent of vevents) {
                const event = new ICAL.Event(vevent);
                const isAllDay = event.startDate ? event.startDate.isDate : false;

                let startDate, endDate;

                if (isAllDay) {
                    // For all-day events, use raw date components to avoid timezone issues
                    // ICAL.Time stores year, month (1-based), day directly
                    if (event.startDate) {
                        startDate = new Date(Date.UTC(
                            event.startDate.year,
                            event.startDate.month - 1,  // JS months are 0-based
                            event.startDate.day
                        ));
                    }
                    if (event.endDate) {
                        endDate = new Date(Date.UTC(
                            event.endDate.year,
                            event.endDate.month - 1,
                            event.endDate.day
                        ));
                    }
                } else {
                    // For timed events, use toJSDate() which handles timezone correctly
                    startDate = event.startDate ? event.startDate.toJSDate() : null;
                    endDate = event.endDate ? event.endDate.toJSDate() : null;
                }

                // Debug logging for date parsing
                if (event.description && event.description.toLowerCase().includes('redd-do')) {
                    console.log('[CalendarSync] Parsing event:', event.summary, {
                        isAllDay,
                        rawStartObj: event.startDate ? JSON.stringify(event.startDate) : null,
                        rawEndObj: event.endDate ? JSON.stringify(event.endDate) : null,
                        jsStart: startDate ? startDate.toISOString() : null,
                        jsEnd: endDate ? endDate.toISOString() : null,
                        durationDays: startDate && endDate ?
                            Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) : 1
                    });
                }

                events.push({
                    uid: event.uid,
                    summary: event.summary || '',
                    description: event.description || '',
                    startDate: startDate,
                    endDate: endDate,
                    isAllDay: isAllDay,
                    location: event.location || '',
                    // Duration in days for multi-day events
                    durationDays: startDate && endDate ?
                        Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) : 1
                });
            }

            return events;
        } catch (error) {
            console.error('[CalendarSync] Error parsing ICS:', error);
            throw error;
        }
    }

    // Filter events whose description starts with "REDD-DO" (case-insensitive)
    // AND within date range: 2 months ago to 1 year in the future
    function filterReddDoEvents(events) {
        const now = new Date();
        const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
        const oneYearAhead = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

        return events.filter(event => {
            // Check description prefix
            const desc = (event.description || '').trim().toLowerCase();
            if (!desc.startsWith('redd-do')) return false;

            // Check date range
            const eventStart = event.startDate;
            const eventEnd = event.endDate || event.startDate;
            if (!eventStart) return false;

            // Event must overlap with our date range
            return eventEnd >= twoMonthsAgo && eventStart <= oneYearAhead;
        });
    }

    // Extract display text from description (remove "REDD-DO" prefix)
    function getDisplayText(event) {
        const desc = (event.description || '').trim();
        // Remove "REDD-DO" prefix (case-insensitive) and any following whitespace/punctuation
        const cleaned = desc.replace(/^redd-do[\s:,-]*/i, '').trim();
        // If there's remaining text, use it; otherwise fall back to summary
        return cleaned || event.summary || 'Calendar Event';
    }

    // Convert event to internal note format
    function convertToNote(event) {
        const startDate = event.startDate;
        if (!startDate) return null;

        // Use UTC for all-day events to avoid timezone issues
        const dateKey = formatDateKey(startDate, event.isAllDay);

        return {
            id: 'cal-' + event.uid,
            text: getDisplayText(event),
            dateKey: dateKey,
            offsetX: 0,
            isCalendarEvent: true,
            calendarEventUid: event.uid
        };
    }

    // Convert multi-day event to internal line format  
    function convertToLine(event) {
        const startDate = event.startDate;
        const endDate = event.endDate;
        if (!startDate || !endDate) return null;

        // For all-day events, end date is exclusive, so subtract one day
        let adjustedEndDate = new Date(endDate);
        if (event.isAllDay && event.durationDays > 1) {
            adjustedEndDate.setUTCDate(adjustedEndDate.getUTCDate() - 1);
        }

        // Use UTC for all-day events to avoid timezone issues
        const startDateKey = formatDateKey(startDate, event.isAllDay);
        const endDateKey = formatDateKey(adjustedEndDate, event.isAllDay);

        // Debug logging for specific event
        if (event.description && event.description.toLowerCase().includes('redd-do') && event.durationDays > 1) {
            console.log('[CalendarSync] Converting Line:', getDisplayText(event), {
                isAllDay: event.isAllDay,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                adjustedEndDate: adjustedEndDate.toISOString(),
                startDateKey,
                endDateKey,
                durationDays: event.durationDays
            });
        }

        return {
            id: 'cal-line-' + event.uid,
            label: getDisplayText(event),
            startDate: startDateKey,
            endDate: endDateKey,
            startOffsetX: 40,  // Position after day name/number
            endOffsetX: 200,   // Near end of note area
            color: '#6366f1',  // Indigo color for calendar events
            width: 8,
            isCalendarEvent: true,
            calendarEventUid: event.uid
        };
    }

    // Format date as YYYY-MM-DD key
    // Use UTC for all-day events to avoid timezone conversion issues
    function formatDateKey(date, useUTC = false) {
        if (useUTC) {
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            const key = `${year}-${month}-${day}`;
            // console.log(`[CalendarSync] formatDateKey UTC: ${date.toISOString()} -> ${key}`);
            return key;
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Fetch ICS data from URL
    async function fetchCalendarData(url) {
        try {
            // Handle webcal:// protocol by converting to https://
            let fetchUrl = url;
            if (fetchUrl.startsWith('webcal://')) {
                fetchUrl = 'https://' + fetchUrl.slice(9);
            }

            // Add cache buster
            const separator = fetchUrl.includes('?') ? '&' : '?';
            fetchUrl += `${separator}_=${new Date().getTime()}`;

            const response = await fetch(fetchUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const icsData = await response.text();
            return icsData;
        } catch (error) {
            console.error('[CalendarSync] Error fetching calendar:', error);
            throw error;
        }
    }

    // Main sync function - fetches, parses, filters, and converts events
    async function syncCalendar(url) {
        console.log('[CalendarSync] Syncing calendar from:', url);

        const icsData = await fetchCalendarData(url);
        console.log('[CalendarSync] Fetched ICS data, length:', icsData.length);

        const allEvents = parseICS(icsData);
        console.log('[CalendarSync] Parsed events:', allEvents.length);

        const filteredEvents = filterReddDoEvents(allEvents);
        console.log('[CalendarSync] Filtered REDD-DO events:', filteredEvents.length);

        const notes = [];
        const lines = [];

        for (const event of filteredEvents) {
            // Multi-day all-day events become lines
            if (event.isAllDay && event.durationDays > 1) {
                const line = convertToLine(event);
                if (line) lines.push(line);
            } else {
                // Single-day or timed events become notes
                const note = convertToNote(event);
                if (note) notes.push(note);
            }
        }

        console.log('[CalendarSync] Generated:', { notes: notes.length, lines: lines.length });

        return {
            notes,
            lines,
            lastSync: new Date().toISOString(),
            eventCount: filteredEvents.length
        };
    }

    return {
        syncCalendar,
        fetchCalendarData,
        parseICS,
        filterReddDoEvents,
        convertToNote,
        convertToLine,
        getDisplayText,
        formatDateKey
    };
})();

// Make available globally for plan.js
window.CalendarSync = CalendarSync;

// Export for Node/Electron
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CalendarSync;
}
