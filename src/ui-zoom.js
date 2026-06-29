// UI zoom — native webview zoom on desktop (macOS/Windows), settings control, keyboard shortcuts.
// Uses window.__TAURI__ (no bundler in this app).

const UI_ZOOM_MIN = 0.8;
const UI_ZOOM_MAX = 1.5;
const UI_ZOOM_STEP = 0.1;
const DEFAULT_UI_ZOOM = 1.0;
const UI_ZOOM_STORAGE_KEY = 'uiZoom';

let zoomToastHideTimeout = null;
let nativeWebviewZoomSupported = null;
let applyZoomGeneration = 0;

function isTauriDesktop() {
    if (typeof window === 'undefined' || window.__TAURI__ == null) return false;
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('mac') || ua.includes('win');
}

function getCurrentWebview() {
    const api = window.__TAURI__?.webview;
    if (api && typeof api.getCurrentWebview === 'function') {
        return api.getCurrentWebview();
    }
    return null;
}

function onTauriEvent(name, handler) {
    const listen = window.__TAURI__?.event?.listen;
    if (typeof listen !== 'function') return Promise.resolve(() => { });
    return listen(name, handler);
}

function clampUiZoom(scale) {
    return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, scale));
}

function getDefaultUiZoom() {
    return DEFAULT_UI_ZOOM;
}

function getSavedUiZoom() {
    const parsed = Number(localStorage.getItem(UI_ZOOM_STORAGE_KEY));
    if (!Number.isFinite(parsed)) return getDefaultUiZoom();
    return clampUiZoom(parsed);
}

function persistUiZoom(scale) {
    const clamped = clampUiZoom(scale);
    if (localStorage.getItem(UI_ZOOM_STORAGE_KEY) === String(clamped)) return;
    localStorage.setItem(UI_ZOOM_STORAGE_KEY, String(clamped));
}

function syncZoomControl(scale) {
    const pct = `${Math.round(scale * 100)}%`;
    document.querySelectorAll('.zoom-value').forEach((el) => {
        el.textContent = pct;
    });
    document.querySelectorAll('.zoom-out-btn').forEach((btn) => {
        btn.disabled = scale <= UI_ZOOM_MIN + 1e-6;
    });
    document.querySelectorAll('.zoom-in-btn').forEach((btn) => {
        btn.disabled = scale >= UI_ZOOM_MAX - 1e-6;
    });
}

function applyUiZoom(scale) {
    const clamped = clampUiZoom(scale);
    syncZoomControl(clamped);

    if (isTauriDesktop()) {
        const webview = getCurrentWebview();
        if (webview && nativeWebviewZoomSupported !== false && typeof webview.setZoom === 'function') {
            const generation = ++applyZoomGeneration;
            Promise.resolve(webview.setZoom(clamped)).then(() => {
                if (generation !== applyZoomGeneration) return;
                nativeWebviewZoomSupported = true;
                document.documentElement.style.zoom = '';
            }).catch(() => {
                if (generation !== applyZoomGeneration) return;
                nativeWebviewZoomSupported = false;
                document.documentElement.style.zoom = String(clamped);
            });
            return;
        }
    }

    document.documentElement.style.zoom = String(clamped);
}

function setupSettingsZoomControl() {
    const control = document.getElementById('settings-zoom-control');
    if (!control || control.dataset.bound === '1') return;
    control.dataset.bound = '1';
    control.querySelector('.zoom-out-btn')?.addEventListener('click', () => zoomUiOut());
    control.querySelector('.zoom-in-btn')?.addEventListener('click', () => zoomUiIn());
}

function showUiZoomToast(scale) {
    const toast = document.getElementById('zoom-toast');
    const message = document.getElementById('zoom-toast-message');
    if (!toast || !message) return;

    message.textContent = `Zoom ${Math.round(scale * 100)}%`;
    toast.classList.remove('hidden');

    if (zoomToastHideTimeout) clearTimeout(zoomToastHideTimeout);
    zoomToastHideTimeout = setTimeout(() => {
        toast.classList.add('hidden');
        zoomToastHideTimeout = null;
    }, 1400);
}

function setUiZoom(scale, options = {}) {
    const clamped = clampUiZoom(scale);
    applyUiZoom(clamped);
    if (options.showToast) showUiZoomToast(clamped);
    if (options.persist !== false) persistUiZoom(clamped);
}

function zoomUiIn(options = {}) {
    const current = getSavedUiZoom();
    setUiZoom(Math.round((current + UI_ZOOM_STEP) * 100) / 100, options);
}

function zoomUiOut(options = {}) {
    const current = getSavedUiZoom();
    setUiZoom(Math.round((current - UI_ZOOM_STEP) * 100) / 100, options);
}

function resetUiZoom(options = {}) {
    setUiZoom(getDefaultUiZoom(), options);
}

function onZoomKeydown(e) {
    const hasAccel = e.metaKey || e.ctrlKey;
    if (!hasAccel || e.altKey) return;

    const key = e.key;
    const isZoomIn = key === '+' || key === '=' || key === 'Add';
    const isZoomOut = key === '-' || key === '_' || key === 'Subtract';
    const isZoomReset = key === '0' || key === ')';
    if (!isZoomIn && !isZoomOut && !isZoomReset) return;

    e.preventDefault();

    if (isZoomIn) {
        zoomUiIn({ showToast: true });
        return;
    }
    if (isZoomOut) {
        zoomUiOut({ showToast: true });
        return;
    }
    resetUiZoom({ showToast: true });
}

export function setupUiZoomShortcuts() {
    setupSettingsZoomControl();
    applyUiZoom(getSavedUiZoom());

    document.addEventListener('keydown', onZoomKeydown);

    if (!isTauriDesktop()) return;

    onTauriEvent('menu-zoom-in', () => zoomUiIn({ showToast: true })).catch(() => { });
    onTauriEvent('menu-zoom-out', () => zoomUiOut({ showToast: true })).catch(() => { });
    onTauriEvent('menu-zoom-reset', () => resetUiZoom({ showToast: true })).catch(() => { });
}
