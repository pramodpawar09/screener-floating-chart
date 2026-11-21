import { TIMEFRAMES } from './timeframes.js';

export const DEFAULT_SETTINGS = {
  enabled: true,
  theme: 'dark',
  defaultTimeframe: '6M',
  hoverDelay: 250, // ms the cursor must rest on a stock before the chart opens
  hideDelay: 350, // ms before an unpinned chart hides after the cursor leaves
  width: 560,
  height: 400,
};

const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  return {
    enabled: s.enabled !== false,
    theme: s.theme === 'light' ? 'light' : 'dark',
    defaultTimeframe: TIMEFRAMES[s.defaultTimeframe] ? s.defaultTimeframe : DEFAULT_SETTINGS.defaultTimeframe,
    hoverDelay: clamp(s.hoverDelay, 0, 2000, DEFAULT_SETTINGS.hoverDelay),
    hideDelay: clamp(s.hideDelay, 100, 3000, DEFAULT_SETTINGS.hideDelay),
    width: clamp(s.width, 380, 900, DEFAULT_SETTINGS.width),
    height: clamp(s.height, 280, 700, DEFAULT_SETTINGS.height),
  };
}

export async function loadSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    return sanitizeSettings(settings);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(partial) {
  const next = sanitizeSettings({ ...(await loadSettings()), ...partial });
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function onSettingsChanged(cb) {
  const listener = (changes, area) => {
    if (area === 'local' && changes.settings) cb(sanitizeSettings(changes.settings.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
