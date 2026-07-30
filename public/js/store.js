// Persisted settings. Everything lives in this browser's localStorage; the
// app has no server-side state and sends nothing anywhere except DataGolf.

import { CATEGORY_KEYS } from './scoring.js';
import { BUILT_IN_PRESETS, emptyWeights } from './presets.js';

const SETTINGS_KEY = 'sg.settings.v1';
const KEY_STORAGE = 'sg.apikey.v1';

function emptyBounds() {
  const bounds = {};
  for (const key of CATEGORY_KEYS) bounds[key] = { min: '', max: '' };
  for (const key of ['odds_win', 'odds_top_10', 'odds_make_cut']) bounds[key] = { min: '', max: '' };
  return bounds;
}

export function defaultSettings() {
  return {
    tour: 'pga',
    mode: 'z',
    presetId: 'balanced',
    weights: { ...BUILT_IN_PRESETS[0].weights },
    bounds: emptyBounds(),
    search: '',
    requireSkill: true,
    excludeAmateurs: false,
    sortKey: 'score',
    sortDir: 'desc',
    theme: 'auto',
    customPresets: [],
  };
}

/** Shallow-merges stored settings over the defaults, dropping unknown shapes. */
export function loadSettings() {
  const base = defaultSettings();
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== 'object') return base;

  const merged = { ...base, ...stored };
  merged.weights = { ...emptyWeights(), ...(stored.weights || {}) };
  merged.bounds = { ...emptyBounds(), ...(stored.bounds || {}) };
  merged.customPresets = Array.isArray(stored.customPresets) ? stored.customPresets : [];
  return merged;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked; settings just will not persist.
  }
}

export function resetSettings() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch { /* ignore */ }
}

export function loadApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function saveApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* ignore */ }
}
