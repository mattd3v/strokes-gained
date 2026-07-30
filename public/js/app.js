// Wiring: load settings, fetch feeds, recompute, render.

import { loadAll, clearCache, detectTransport, DataGolfError } from './api.js';
import { buildRows } from './model.js';
import { compositeScore, passesBounds, weightsAreEmpty } from './scoring.js';
import { BUILT_IN_PRESETS, findPreset, weightsEqual, emptyWeights } from './presets.js';
import { defaultSettings, loadSettings, saveSettings, resetSettings, loadApiKey, saveApiKey } from './store.js';
import * as ui from './ui.js';

const els = {};
const IDS = [
  'event-line', 'banner', 'tile-event', 'tile-event-note', 'tile-count', 'tile-count-note',
  'tile-leader', 'tile-leader-note', 'tile-updated', 'tile-updated-note',
  'weights-grid', 'preset-select', 'save-preset-btn', 'delete-preset-btn', 'mode-select',
  'clear-weights-btn', 'mode-note', 'filters-panel', 'filter-count', 'search-input',
  'require-skill', 'exclude-amateurs', 'clear-filters-btn', 'bounds-body',
  'board-head', 'board-body', 'board-empty', 'export-btn', 'refresh-btn', 'settings-btn',
  'theme-toggle', 'settings-dialog', 'api-key-input', 'tour-select', 'transport-note',
  'clear-cache-btn', 'reset-btn', 'preset-dialog', 'preset-name-input',
];

function camel(id) {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

for (const id of IDS) {
  els[camel(id)] = document.getElementById(id);
}

const state = {
  settings: loadSettings(),
  apiKey: loadApiKey(),
  data: null,        // { rows, summaries, event, missingSkill }
  loadedAt: null,
  stale: false,
  loading: false,
  visible: [],
  columns: [],
};

/* ---------------- data ---------------- */

async function load({ force = false, quiet = false } = {}) {
  if (state.loading) return;
  if (!state.apiKey) {
    ui.renderBanner(els, 'Add your DataGolf API key in Settings to load this week\'s field.', 'warning');
    return;
  }

  state.loading = true;
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = 'Loading…';
  if (!quiet) ui.renderBanner(els, 'Loading DataGolf feeds…', 'info');

  try {
    const { results, errors } = await loadAll({
      apiKey: state.apiKey,
      tour: state.settings.tour,
      force,
    });

    state.data = buildRows({
      field: results.field?.data,
      skills: results.skills?.data,
      preTournament: results.preTournament?.data,
      schedule: results.schedule?.data,
    });
    const stamps = [results.field?.ts, results.skills?.ts].filter((t) => typeof t === 'number');
    state.loadedAt = stamps.length ? Math.min(...stamps) : Date.now();
    state.stale = Boolean(results.field?.stale || results.skills?.stale);

    const notes = [];
    if (state.stale) notes.push('Could not reach DataGolf, so this is the last cached copy.');
    if (errors.preTournament) notes.push('Pre-tournament odds unavailable.');
    if (errors.schedule) notes.push('Schedule details unavailable.');
    if (!state.data.rows.length) {
      notes.push('DataGolf returned an empty field for this tour. The next event\'s field is usually published early in tournament week.');
    }
    ui.renderBanner(els, notes.join(' '), state.stale ? 'warning' : 'info');
  } catch (err) {
    const message = err instanceof DataGolfError
      ? err.message
      : `Unexpected error while loading: ${err.message}`;
    ui.renderBanner(els, message, 'error');
  } finally {
    state.loading = false;
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = 'Refresh';
    render();
  }
}

/* ---------------- compute ---------------- */

function compare(a, b, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;

  if (key === 'name') {
    return sign * String(a.sortName).localeCompare(String(b.sortName));
  }

  let av;
  let bv;
  if (key === 'score') { av = a.score; bv = b.score; }
  else if (key === 'teeTime') {
    av = a.teeTime || ''; bv = b.teeTime || '';
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return sign * av.localeCompare(bv);
  } else if (key === 'dkSalary') { av = a.dkSalary; bv = b.dkSalary; }
  else if (key.startsWith('odds_')) {
    const f = key.slice(5);
    av = a.odds?.[f] ?? null; bv = b.odds?.[f] ?? null;
  } else { av = a.stats?.[key] ?? null; bv = b.stats?.[key] ?? null; }

  const aNull = typeof av !== 'number' || !Number.isFinite(av);
  const bNull = typeof bv !== 'number' || !Number.isFinite(bv);
  if (aNull && bNull) return 0;
  if (aNull) return 1;   // missing values sink regardless of direction
  if (bNull) return -1;
  if (av === bv) return String(a.sortName).localeCompare(String(b.sortName));
  return sign * (av - bv);
}

function recompute() {
  if (!state.data) {
    state.visible = [];
    return;
  }
  const { settings } = state;
  const query = settings.search.trim().toLowerCase();

  for (const row of state.data.rows) {
    row.score = compositeScore(row, settings.weights, settings.mode);
  }

  state.visible = state.data.rows.filter((row) => {
    if (settings.requireSkill && !row.hasSkill) return false;
    if (settings.excludeAmateurs && row.amateur) return false;
    if (query) {
      const haystack = `${row.name} ${row.country}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return passesBounds(row, settings.bounds);
  });

  state.visible.sort((a, b) => compare(a, b, settings.sortKey, settings.sortDir));
}

/* ---------------- render ---------------- */

function render() {
  recompute();
  const data = state.data;
  const hasOdds = Boolean(data?.rows.some((r) => r.odds));
  const hasDk = Boolean(data?.rows.some((r) => typeof r.dkSalary === 'number'));

  ui.renderEventLine(els, data?.event);
  ui.renderTiles(els, {
    event: data?.event,
    visibleRows: state.visible,
    allRows: data?.rows || [],
    missingSkill: data?.missingSkill || 0,
    loadedAt: state.loadedAt,
    stale: state.stale,
    mode: state.settings.mode,
  });

  ui.renderPresetSelect(els, state.settings);
  ui.renderModeNote(els, state.settings);
  els.modeSelect.value = state.settings.mode;

  ui.renderBounds(els, state.settings, data?.summaries, hasOdds, onBoundChange);
  const activeFilters = ui.countActiveFilters(state.settings, hasOdds);
  els.filterCount.hidden = activeFilters === 0;
  els.filterCount.textContent = `${activeFilters} active`;

  state.columns = ui.buildColumns({ hasOdds, hasDk });
  ui.renderTable(els, {
    rows: state.visible,
    columns: state.columns,
    summaries: data?.summaries || {},
    settings: state.settings,
    onSort,
  });

  if (data && weightsAreEmpty(state.settings.weights, state.settings.mode)) {
    ui.renderBanner(els, 'Every weight is zero, so no player has a score. Pick a preset or move a slider.', 'warning');
  }
}

function persist() {
  saveSettings(state.settings);
}

/* ---------------- handlers ---------------- */

function markCustomIfNeeded() {
  const preset = findPreset(state.settings.presetId, state.settings.customPresets);
  if (!preset || !weightsEqual(preset.weights, state.settings.weights)) {
    state.settings.presetId = 'custom';
  }
}

function onWeightChange(key, value) {
  state.settings.weights[key] = value;
  markCustomIfNeeded();
  persist();
  render();
}

function onBoundChange(key, side, value) {
  if (!state.settings.bounds[key]) state.settings.bounds[key] = { min: '', max: '' };
  state.settings.bounds[key][side] = value;
  persist();
  render();
}

function onSort(key) {
  if (state.settings.sortKey === key) {
    state.settings.sortDir = state.settings.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.settings.sortKey = key;
    state.settings.sortDir = key === 'name' ? 'asc' : 'desc';
  }
  persist();
  render();
}

function applyTheme() {
  const theme = state.settings.theme;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  els.themeToggle.title = `Theme: ${theme}`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function wire() {
  ui.renderWeights(els, state.settings, onWeightChange);

  els.presetSelect.addEventListener('change', () => {
    const id = els.presetSelect.value;
    state.settings.presetId = id;
    const preset = findPreset(id, state.settings.customPresets);
    if (preset) state.settings.weights = { ...preset.weights };
    persist();
    ui.renderWeights(els, state.settings, onWeightChange);
    render();
  });

  els.modeSelect.addEventListener('change', () => {
    state.settings.mode = els.modeSelect.value;
    persist();
    ui.renderWeights(els, state.settings, onWeightChange);
    render();
  });

  els.clearWeightsBtn.addEventListener('click', () => {
    state.settings.weights = emptyWeights();
    state.settings.presetId = 'custom';
    persist();
    ui.renderWeights(els, state.settings, onWeightChange);
    render();
  });

  els.savePresetBtn.addEventListener('click', () => {
    els.presetNameInput.value = '';
    els.presetDialog.showModal();
  });

  els.presetDialog.addEventListener('close', () => {
    if (els.presetDialog.returnValue !== 'save') return;
    const name = els.presetNameInput.value.trim();
    if (!name) return;
    const id = `custom-${Date.now().toString(36)}`;
    state.settings.customPresets.push({ id, name, weights: { ...state.settings.weights } });
    state.settings.presetId = id;
    persist();
    render();
  });

  els.deletePresetBtn.addEventListener('click', () => {
    const id = state.settings.presetId;
    state.settings.customPresets = state.settings.customPresets.filter((p) => p.id !== id);
    state.settings.presetId = 'custom';
    persist();
    render();
  });

  els.searchInput.value = state.settings.search;
  els.searchInput.addEventListener('input', debounce(() => {
    state.settings.search = els.searchInput.value;
    persist();
    render();
  }, 150));

  els.requireSkill.checked = state.settings.requireSkill;
  els.requireSkill.addEventListener('change', () => {
    state.settings.requireSkill = els.requireSkill.checked;
    persist();
    render();
  });

  els.excludeAmateurs.checked = state.settings.excludeAmateurs;
  els.excludeAmateurs.addEventListener('change', () => {
    state.settings.excludeAmateurs = els.excludeAmateurs.checked;
    persist();
    render();
  });

  els.clearFiltersBtn.addEventListener('click', () => {
    const fresh = defaultSettings();
    state.settings.bounds = fresh.bounds;
    state.settings.search = '';
    state.settings.excludeAmateurs = false;
    els.searchInput.value = '';
    els.excludeAmateurs.checked = false;
    persist();
    render();
  });

  els.refreshBtn.addEventListener('click', () => load({ force: true }));

  els.exportBtn.addEventListener('click', () => {
    if (!state.visible.length) return;
    const csv = ui.toCsv(state.visible, state.columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (state.data?.event?.name || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    a.href = url;
    a.download = `strokes-gained-${slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  els.themeToggle.addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
    state.settings.theme = next;
    persist();
    applyTheme();
  });

  els.settingsBtn.addEventListener('click', async () => {
    els.apiKeyInput.value = state.apiKey;
    els.tourSelect.value = state.settings.tour;
    const transport = await detectTransport();
    els.transportNote.textContent = transport === 'proxy'
      ? 'Requests go through the local proxy on this machine.'
      : 'No local proxy detected — requests go straight to DataGolf from the browser, which the browser may block. Run `npm start` and open the app from that server.';
    els.settingsDialog.showModal();
  });

  els.settingsDialog.addEventListener('close', () => {
    if (els.settingsDialog.returnValue !== 'save') return;
    const key = els.apiKeyInput.value.trim();
    const tourChanged = els.tourSelect.value !== state.settings.tour;
    state.apiKey = key;
    saveApiKey(key);
    state.settings.tour = els.tourSelect.value;
    persist();
    load({ force: tourChanged });
  });

  els.clearCacheBtn.addEventListener('click', () => {
    clearCache();
    ui.renderBanner(els, 'Cached feed data cleared.', 'info');
  });

  els.resetBtn.addEventListener('click', () => {
    resetSettings();
    state.settings = defaultSettings();
    persist();
    ui.renderWeights(els, state.settings, onWeightChange);
    els.searchInput.value = '';
    els.requireSkill.checked = state.settings.requireSkill;
    els.excludeAmateurs.checked = false;
    applyTheme();
    render();
  });
}

/* ---------------- boot ---------------- */

// Migrate a settings file saved before a preset existed.
if (!findPreset(state.settings.presetId, state.settings.customPresets) && state.settings.presetId !== 'custom') {
  state.settings.presetId = BUILT_IN_PRESETS[0].id;
  state.settings.weights = { ...BUILT_IN_PRESETS[0].weights };
}

applyTheme();
wire();
render();
load();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker is an enhancement; the app works without it.
    });
  });
}
