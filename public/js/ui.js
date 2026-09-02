// Rendering. Every function here reads state and writes DOM; none of them
// fetch or mutate settings.

import { CATEGORIES, CATEGORY_BY_KEY, SG_KEYS, colorLevel, summarize } from './scoring.js';
import { BUILT_IN_PRESETS } from './presets.js';

const ODDS_COLUMNS = [
  { key: 'win', label: 'Win%' },
  { key: 'top_10', label: 'T10%' },
  { key: 'make_cut', label: 'Cut%' },
];

export function fmt(value, decimals = 2, { sign = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const body = Math.abs(value).toFixed(decimals);
  if (!sign) return value < 0 ? `-${body}` : body;
  if (value > 0) return `+${body}`;
  if (value < 0) return `-${body}`;
  return `0${decimals ? `.${'0'.repeat(decimals)}` : ''}`;
}

export function formatStat(key, value, summaries) {
  const cat = CATEGORY_BY_KEY[key];
  if (!cat) return fmt(value);
  const signed = summaries?.[key]?.anchor === 'zero';
  return fmt(value, cat.decimals, { sign: signed });
}

function money(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US')}`;
}

function relativeTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ---------------- header, banner, tiles ---------------- */

export function renderBanner(els, message, kind = 'info', actions = []) {
  if (!message) {
    els.banner.hidden = true;
    els.banner.replaceChildren();
    return;
  }
  els.banner.hidden = false;
  els.banner.dataset.kind = kind;
  els.banner.replaceChildren();

  const icon = el('span', 'banner-icon', kind === 'error' ? '!' : kind === 'warning' ? '△' : 'i');
  const body = el('span', 'banner-body');
  body.textContent = message;
  els.banner.append(icon, body);

  if (actions.length) {
    const bar = el('span', 'banner-actions');
    for (const action of actions) {
      const button = el('button', 'btn btn-sm', action.label);
      button.type = 'button';
      button.addEventListener('click', action.onClick);
      bar.append(button);
    }
    els.banner.append(bar);
  }
}

export function renderEventLine(els, event) {
  if (!event) {
    els.eventLine.textContent = 'No data loaded yet — add your API key in Settings.';
    return;
  }
  const bits = [event.name];
  if (event.course) bits.push(event.course);
  if (event.location) bits.push(event.location);
  els.eventLine.textContent = bits.join(' · ');
}

export function renderTiles(els, { event, visibleRows, allRows, missingSkill, loadedAt, stale, mode }) {
  els.tileEvent.textContent = event ? event.name : '—';
  els.tileEventNote.textContent = event
    ? [event.location, event.startDate ? `starts ${event.startDate}` : '']
        .filter(Boolean)
        .join(' · ')
    : '';

  els.tileCount.textContent = allRows.length
    ? `${visibleRows.length} of ${allRows.length}`
    : '—';
  els.tileCountNote.textContent = missingSkill
    ? `${missingSkill} in field without skill data`
    : allRows.length
      ? 'full field has skill data'
      : '';

  const leader = visibleRows[0];
  els.tileLeader.textContent = leader ? leader.name : '—';
  els.tileLeaderNote.textContent = leader && typeof leader.score === 'number'
    ? `score ${fmt(leader.score, 2, { sign: mode === 'z' })}`
    : '';

  els.tileUpdated.textContent = loadedAt ? relativeTime(loadedAt) : '—';
  els.tileUpdatedNote.textContent = stale
    ? 'showing cached data'
    : event?.lastUpdated
      ? `feed: ${event.lastUpdated}`
      : '';
}

/* ---------------- api usage ---------------- */

/**
 * Picks the clearest headline the available data supports: a server-reported
 * remaining count if DataGolf sends one, otherwise our own count of requests
 * made today.
 */
export function renderUsage(els, stats, rateLimit) {
  const remaining = rateLimit && (
    rateLimit['x-ratelimit-remaining']
    ?? rateLimit['ratelimit-remaining']
    ?? rateLimit['x-rate-limit-remaining']
    ?? rateLimit['x-requests-remaining']
    ?? rateLimit['x-quota-remaining']
  );

  if (remaining != null) {
    const limit = rateLimit['x-ratelimit-limit'] ?? rateLimit['ratelimit-limit'] ?? rateLimit['x-rate-limit-limit'];
    els.tileUsage.textContent = limit != null ? `${remaining} / ${limit}` : `${remaining} left`;
    els.tileUsageNote.textContent = `${stats.today} sent today · ${stats.lastHour}/hr · ${stats.lastMinute}/min`;
    return;
  }

  els.tileUsage.textContent = `${stats.today} today`;
  const bits = [`${stats.lastHour}/hr`, `${stats.lastMinute}/min`];
  if (stats.cacheHits) bits.push(`${stats.cacheHits} from cache`);
  if (stats.errors) bits.push(`${stats.errors} failed`);
  els.tileUsageNote.textContent = bits.join(' · ');
}

/**
 * Bar chart of requests per minute. One series, so no legend; the value is in
 * each bar's tooltip and the peak is labelled.
 */
export function renderSparkline(container, values) {
  const width = 100;
  const height = 34;
  const max = Math.max(1, ...values);
  const slot = width / values.length;
  const barW = Math.max(0.8, slot - 0.6);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Requests per minute over the last ${values.length} minutes. Peak ${max}, total ${values.reduce((a, b) => a + b, 0)}.`);

  values.forEach((value, i) => {
    // Idle minutes keep a stub so all 30 slots read as a timeline.
    const h = value === 0 ? 0.8 : Math.max(1.5, (value / max) * (height - 2));
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(i * slot));
    rect.setAttribute('y', String(height - h));
    rect.setAttribute('width', String(barW));
    rect.setAttribute('height', String(h));
    rect.setAttribute('rx', '0.6');
    rect.setAttribute('class', value === 0 ? 'spark-bar spark-bar-empty' : 'spark-bar');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    const minutesAgo = values.length - 1 - i;
    title.textContent = `${value} request${value === 1 ? '' : 's'} · ${minutesAgo === 0 ? 'this minute' : `${minutesAgo} min ago`}`;
    rect.append(title);
    svg.append(rect);
  });

  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  axis.setAttribute('x1', '0');
  axis.setAttribute('x2', String(width));
  axis.setAttribute('y1', String(height - 0.25));
  axis.setAttribute('y2', String(height - 0.25));
  axis.setAttribute('class', 'spark-axis');
  svg.append(axis);

  container.replaceChildren(svg, el('span', 'spark-peak', `peak ${max}/min`));
}

export function renderDiagStats(container, stats) {
  const cells = [
    ['Today', stats.today],
    ['Last hour', stats.lastHour],
    ['Last minute', stats.lastMinute],
    ['Logged total', stats.total],
    ['From cache', stats.cacheHits],
    ['Failed', stats.errors],
  ];
  container.replaceChildren(...cells.map(([label, value]) => {
    const box = el('div', 'diag-stat');
    box.append(el('span', 'diag-stat-value', String(value)));
    box.append(el('span', 'diag-stat-label', label));
    if (label === 'Failed' && value > 0) box.classList.add('is-bad');
    return box;
  }));
}

export function renderDiagErrors(container, errors) {
  if (!errors.length) {
    container.replaceChildren(el('p', 'hint', 'No failed requests logged.'));
    return;
  }
  container.replaceChildren(...errors.map((e) => {
    const box = el('div', 'diag-error');
    const head = el('div', 'diag-error-head');
    head.append(el('code', null, e.endpoint || 'unknown'));
    head.append(el('span', 'diag-error-meta',
      `${e.status ?? 'no response'} · ${new Date(e.ts).toLocaleTimeString()} · via ${e.transport || '—'}`));
    box.append(head);
    box.append(el('p', 'diag-error-msg', e.error || 'Unknown error'));
    if (e.bodySnippet) box.append(el('pre', 'diag-error-body', e.bodySnippet));
    return box;
  }));
}

/* ---------------- weights ---------------- */

const GROUP_LABEL = {
  core: 'Core',
  composite: 'Composite',
  driving: 'Driving',
};

export function renderWeights(els, settings, onChange) {
  const grid = els.weightsGrid;
  grid.replaceChildren();

  for (const cat of CATEGORIES) {
    const disabled = settings.mode === 'raw' && !SG_KEYS.includes(cat.key);
    const wrap = el('div', 'weight');
    wrap.dataset.disabled = String(disabled);

    const label = el('label', 'weight-label');
    label.htmlFor = `w-${cat.key}`;
    label.append(document.createTextNode(cat.label));
    const sub = el('small');
    sub.textContent = disabled
      ? `${cat.name} — not used in raw mode`
      : `${cat.name} (${GROUP_LABEL[cat.group]})`;
    label.append(sub);

    const value = el('span', 'weight-value', fmt(Number(settings.weights[cat.key]) || 0, 2, { sign: true }));

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `w-${cat.key}`;
    slider.min = '-2';
    slider.max = '3';
    slider.step = '0.25';
    slider.value = String(Number(settings.weights[cat.key]) || 0);
    slider.disabled = disabled;
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      value.textContent = fmt(v, 2, { sign: true });
      onChange(cat.key, v);
    });

    wrap.append(label, value, slider);
    grid.append(wrap);
  }
}

export function renderPresetSelect(els, settings) {
  const select = els.presetSelect;

  // Rebuilding the option list while the select has focus tears out the node
  // the browser is mid-event on, so only rebuild when the list really changed.
  const signature = [
    'custom',
    ...BUILT_IN_PRESETS.map((p) => p.id),
    ...settings.customPresets.map((p) => `${p.id}:${p.name}`),
  ].join('|');

  if (select.dataset.signature !== signature) {
    select.dataset.signature = signature;
    select.replaceChildren();

    const custom = el('option', null, 'Custom');
    custom.value = 'custom';
    select.append(custom);

    const builtIn = document.createElement('optgroup');
    builtIn.label = 'Built in';
    for (const preset of BUILT_IN_PRESETS) {
      const option = el('option', null, preset.name);
      option.value = preset.id;
      option.title = preset.note;
      builtIn.append(option);
    }
    select.append(builtIn);

    if (settings.customPresets.length) {
      const saved = document.createElement('optgroup');
      saved.label = 'Saved';
      for (const preset of settings.customPresets) {
        const option = el('option', null, preset.name);
        option.value = preset.id;
        saved.append(option);
      }
      select.append(saved);
    }
  }

  select.value = settings.presetId || 'custom';
  els.deletePresetBtn.hidden = !settings.customPresets.some((p) => p.id === settings.presetId);
}

export function renderModeNote(els, settings) {
  els.modeNote.textContent = settings.mode === 'raw'
    ? 'Raw mode adds weighted strokes gained per round. Driving distance and accuracy are excluded because yards and percentage points do not add to strokes.'
    : 'Z-score mode ranks each category against this field, then takes the weighted average. Distance and accuracy mix in safely because everything is unitless. Negative weights penalise a category.';
}

/* ---------------- filters ---------------- */

function buildBoundsRow(spec, onChange) {
  const tr = document.createElement('tr');
  tr.dataset.key = spec.key;
  tr.append(el('td', null, spec.label));

  for (const side of ['min', 'max']) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.placeholder = 'any';
    input.dataset.side = side;
    input.setAttribute('aria-label', `${spec.label} ${side}`);
    input.addEventListener('change', () => onChange(spec.key, side, input.value));
    td.append(input);
    tr.append(td);
  }

  tr.append(el('td', 'range-note', '—'));
  return tr;
}

export function renderBounds(els, settings, summaries, hasOdds, onChange) {
  const body = els.boundsBody;

  const specs = [
    ...CATEGORIES.map((c) => ({
      key: c.key,
      label: `${c.label} · ${c.name}`,
      summary: summaries?.[c.key],
      decimals: c.decimals,
    })),
    ...(hasOdds
      ? ODDS_COLUMNS.map((o) => ({
          key: `odds_${o.key}`,
          label: `${o.label} · pre-tournament`,
          summary: summaries?.[`odds_${o.key}`],
          decimals: 1,
        }))
      : []),
  ];

  // The rows are rebuilt only when the set of categories changes. Re-creating
  // them on every render would rip out the input the user is typing in.
  const signature = specs.map((s) => s.key).join('|');
  if (body.dataset.signature !== signature) {
    body.dataset.signature = signature;
    body.replaceChildren(...specs.map((spec) => buildBoundsRow(spec, onChange)));
  }

  for (const spec of specs) {
    const tr = body.querySelector(`tr[data-key="${spec.key}"]`);
    if (!tr) continue;

    for (const input of tr.querySelectorAll('input')) {
      const stored = settings.bounds[spec.key]?.[input.dataset.side] ?? '';
      if (input !== document.activeElement && input.value !== String(stored)) {
        input.value = stored;
      }
    }

    const note = tr.querySelector('.range-note');
    const signed = spec.summary?.anchor === 'zero';
    note.textContent = spec.summary && spec.summary.n
      ? `${fmt(spec.summary.min, spec.decimals, { sign: signed })} … ${fmt(spec.summary.max, spec.decimals, { sign: signed })}`
      : '—';
  }
}

export function countActiveFilters(settings, hasOdds) {
  let count = 0;
  for (const [key, bound] of Object.entries(settings.bounds)) {
    if (!hasOdds && key.startsWith('odds_')) continue;
    if (bound && (bound.min !== '' || bound.max !== '')) count += 1;
  }
  if (settings.search.trim()) count += 1;
  if (settings.excludeAmateurs) count += 1;
  // requireSkill is on by default and is a data-quality toggle rather than a
  // filter the user chose, so it does not light up the badge.
  return count;
}

/* ---------------- board ---------------- */

export function buildColumns({ hasOdds, hasDk }) {
  const columns = [
    { key: 'rank', label: '#', cls: 'col-rank', sortable: false },
    { key: 'name', label: 'Player', cls: 'col-player' },
    { key: 'score', label: 'Score', cls: 'score' },
    ...CATEGORIES.map((c) => ({ key: c.key, label: c.label, cls: 'stat', title: c.name })),
  ];
  if (hasOdds) {
    for (const o of ODDS_COLUMNS) columns.push({ key: `odds_${o.key}`, label: o.label, cls: 'stat' });
  }
  if (hasDk) columns.push({ key: 'dkSalary', label: 'DK', cls: 'stat' });
  columns.push({ key: 'teeTime', label: 'R1 tee', cls: 'stat' });
  return columns;
}

export function renderTable(els, { rows, columns, summaries, settings, onSort }) {
  const head = els.boardHead;
  head.replaceChildren();
  const headRow = document.createElement('tr');

  for (const col of columns) {
    const th = el('th', col.cls, col.label);
    th.scope = 'col';
    if (col.title) th.title = col.title;
    if (col.sortable === false) {
      th.style.cursor = 'default';
    } else {
      th.setAttribute('aria-sort',
        settings.sortKey === col.key
          ? (settings.sortDir === 'asc' ? 'ascending' : 'descending')
          : 'none');
      th.tabIndex = 0;
      th.addEventListener('click', () => onSort(col.key));
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col.key); }
      });
    }
    headRow.append(th);
  }
  head.append(headRow);

  const scoreSummary = summarize(rows.map((r) => r.score));
  const body = els.boardBody;
  const frag = document.createDocumentFragment();

  rows.forEach((row, index) => {
    const tr = document.createElement('tr');

    for (const col of columns) {
      let td;
      switch (col.key) {
        case 'rank':
          td = el('td', 'col-rank', String(index + 1));
          break;
        case 'name': {
          td = el('td', 'col-player');
          const name = el('span', 'player-name', row.name || '—');
          td.append(name);
          if (row.amateur) td.append(el('span', 'badge-am', 'AM'));
          const meta = [row.country, row.course].filter(Boolean).join(' · ');
          if (meta) {
            td.append(document.createElement('br'));
            td.append(el('span', 'player-meta', meta));
          }
          break;
        }
        case 'score': {
          td = el('td', 'stat score', fmt(row.score, 2, { sign: settings.mode === 'z' }));
          td.classList.add(`lv-${colorLevel(row.score, scoreSummary)}`);
          if (typeof row.score !== 'number') td.classList.add('missing');
          break;
        }
        case 'dkSalary':
          td = el('td', 'stat', money(row.dkSalary));
          break;
        case 'teeTime':
          td = el('td', 'stat', row.teeTime || '—');
          break;
        default: {
          if (col.key.startsWith('odds_')) {
            const v = row.odds?.[col.key.slice(5)];
            td = el('td', 'stat', typeof v === 'number' ? `${fmt(v, 1)}%` : '—');
            if (typeof v !== 'number') td.classList.add('missing');
          } else {
            const v = row.stats?.[col.key];
            td = el('td', 'stat', formatStat(col.key, v, summaries));
            if (typeof v === 'number') {
              td.classList.add(`lv-${colorLevel(v, summaries[col.key])}`);
              const pct = row.pct?.[col.key];
              if (typeof pct === 'number') {
                td.title = `${CATEGORY_BY_KEY[col.key].name}: ${Math.round(pct * 100)}th percentile in this field`;
              }
            } else {
              td.classList.add('missing');
            }
          }
        }
      }
      tr.append(td);
    }
    frag.append(tr);
  });

  body.replaceChildren(frag);

  const empty = rows.length === 0;
  els.boardEmpty.hidden = !empty;
  if (empty) {
    els.boardEmpty.textContent = settings.requireSkill
      ? 'No players match. Try loosening the bounds, or turn off "Only players with DataGolf skill data".'
      : 'No players match the current filters.';
  }
}

export function toCsv(rows, columns) {
  const header = columns.filter((c) => c.key !== 'rank').map((c) => c.label);
  const lines = [header.join(',')];

  for (const row of rows) {
    const cells = columns
      .filter((c) => c.key !== 'rank')
      .map((col) => {
        if (col.key === 'name') return row.name;
        if (col.key === 'score') return typeof row.score === 'number' ? row.score.toFixed(4) : '';
        if (col.key === 'dkSalary') return row.dkSalary ?? '';
        if (col.key === 'teeTime') return row.teeTime || '';
        if (col.key.startsWith('odds_')) {
          const v = row.odds?.[col.key.slice(5)];
          return typeof v === 'number' ? v.toFixed(2) : '';
        }
        const v = row.stats?.[col.key];
        return typeof v === 'number' ? v.toFixed(CATEGORY_BY_KEY[col.key].decimals) : '';
      })
      .map((cell) => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      });
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}
