// The Nine: wiring and rendering. The maths lives in handicap.js.

import {
  HOLES,
  BEST_OF_TABLE,
  STANDARD_SLOPE,
  coursePar,
  computeStandings,
  strokesToGive,
  strokeMatrix,
  courseProblems,
  isCompleteCard,
  grossScore,
} from './handicap.js';
import {
  uid,
  localDate,
  copyCourse,
  emptyBook,
  loadBook,
  saveBook,
  exportBook,
  importBook,
  demoBook,
} from './store.js';

const DRAFT_KEY = 'nine.draft.v1';
const TODAY_KEY = 'nine.today.v1';
const THEME_KEY = 'nine.theme.v1';

const page = document.getElementById('page');
const toastEl = document.getElementById('toast');

let book = loadBook();
let derived = derive();
let draft = loadJson(DRAFT_KEY);

/* ---------------- small helpers ---------------- */

function loadJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function saveJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage blocked: the page still works for this visit */ }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtIndex = (x) => (x == null ? '—' : x < 0 ? `+${Math.abs(x).toFixed(1)}` : x.toFixed(1));
const fmtDiff = (x) => (x == null ? '—' : x.toFixed(1));

function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

function derive() {
  return computeStandings(book.players, book.rounds, { capHoles: book.rules.capHoles });
}

function commit(message) {
  derived = derive();
  if (!saveBook(book)) message = 'Could not save — storage is full or blocked.';
  renderMasthead();
  if (message) toast(message);
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

const playerById = (id) => book.players.find((p) => p.id === id);
const standingFor = (id) => derived.standings.find((s) => s.player.id === id);

/* ---------------- theme ---------------- */

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
applyTheme(loadJson(THEME_KEY));

/* ---------------- masthead & routing ---------------- */

function renderMasthead() {
  const c = book.course;
  document.getElementById('stamp-rating').textContent = c.rating.toFixed(1);
  document.getElementById('stamp-slope').textContent = c.slope;
  document.getElementById('stamp-par').textContent = coursePar(c);
  const n = book.rounds.length;
  document.getElementById('course-line').textContent =
    `${c.name} · ${book.players.length} player${book.players.length === 1 ? '' : 's'} · ${n} round${n === 1 ? '' : 's'}`;
}

document.getElementById('course-stamp').addEventListener('click', () => { location.hash = '#course'; });

const VIEWS = { card: renderCard, strokes: renderStrokes, players: renderPlayers, rounds: renderRounds, course: renderCourse };

function route() {
  const [name, arg] = (location.hash.slice(1) || 'card').split('/');
  const view = VIEWS[name] ? name : 'card';
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  VIEWS[view](arg);
}

window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});

function emptyPrompt(title, body) {
  return `
    <div class="empty">
      <h2>${esc(title)}</h2>
      <p>${body}</p>
      <div class="row" style="justify-content:center">
        <a class="btn primary" href="#players">Add players</a>
        <button type="button" class="btn quiet" data-action="demo">Load demo book</button>
      </div>
    </div>`;
}

/* ---------------- card ---------------- */

function newDraft() {
  return { id: null, date: localDate(), playing: book.players.map((p) => p.id), scores: {} };
}

function draftFromRound(round) {
  const scores = {};
  for (const [pid, holes] of Object.entries(round.scores)) scores[pid] = [...holes];
  return { id: round.id, date: round.date, playing: Object.keys(round.scores), scores };
}

function draftHoles(pid) {
  if (!draft.scores[pid]) draft.scores[pid] = Array(HOLES).fill(null);
  return draft.scores[pid];
}

function draftCourse() {
  const editing = draft.id && book.rounds.find((r) => r.id === draft.id);
  return editing ? editing.course : book.course;
}

/** Standings as if the draft were already saved, for live totals. */
function projectDraft() {
  const course = draftCourse();
  const id = draft.id || '__draft__';
  const scores = {};
  for (const pid of draft.playing) scores[pid] = draftHoles(pid);
  const rounds = book.rounds.filter((r) => r.id !== draft.id);
  rounds.push({ id, date: draft.date, createdAt: Date.now(), course, scores });
  return { id, result: computeStandings(book.players, rounds, { capHoles: book.rules.capHoles }) };
}

function markClass(score, par) {
  if (!score) return '';
  const d = score - par;
  if (d <= -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 1) return 'bogey';
  if (d >= 2) return 'double';
  return '';
}

function renderCard(roundId) {
  if (!book.players.length) {
    page.innerHTML = emptyPrompt('No players yet', 'Add your group first, or load a demo season to see how the book works.');
    return;
  }

  if (roundId) {
    const round = book.rounds.find((r) => r.id === roundId);
    if (!round) { location.hash = '#card'; return; }
    if (!draft || draft.id !== roundId) draft = draftFromRound(round);
  }
  if (!draft) draft = newDraft();
  draft.playing = draft.playing.filter((id) => playerById(id));
  saveJson(DRAFT_KEY, draft);

  const course = draftCourse();
  const editing = Boolean(draft.id);
  const playing = draft.playing.map(playerById);

  // Dots show today's strokes, so only on a fresh card.
  const strokes = new Map();
  if (!editing) {
    const { rows } = strokesToGive(
      playing.map((p) => ({ id: p.id, index: standingFor(p.id)?.index ?? null })),
      course,
      book.rules.allowance,
    );
    for (const r of rows) strokes.set(r.id, r);
  }

  const chips = book.players.map((p) => `
    <label class="chip">
      <input type="checkbox" data-play="${esc(p.id)}" ${draft.playing.includes(p.id) ? 'checked' : ''}>
      <span class="tick" aria-hidden="true"></span>${esc(p.name)}
    </label>`).join('');

  const head = playing.map((p) => {
    const s = strokes.get(p.id);
    const gets = editing ? '' : s ? (s.strokes ? `gets ${s.strokes}` : 'scratch') : 'no index';
    return `<th class="player-col" scope="col">${esc(p.name)}<span class="gets">${gets}</span></th>`;
  }).join('');

  const body = Array.from({ length: HOLES }, (_, i) => {
    const cells = playing.map((p) => {
      const v = draftHoles(p.id)[i];
      const n = strokes.get(p.id)?.perHole[i] || 0;
      const dots = n > 0 ? `<span class="dots" aria-hidden="true">${'<i></i>'.repeat(n)}</span>` : '';
      return `<td><div class="cell ${markClass(v, course.pars[i])}">${dots}
        <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off"
          aria-label="${esc(p.name)}, hole ${i + 1}${n ? `, gets ${n}` : ''}"
          data-player="${esc(p.id)}" data-hole="${i}" value="${v ?? ''}">
        <span class="capped" data-capped="${esc(p.id)}:${i}"></span></div></td>`;
    }).join('');
    return `<tr><th class="hole" scope="row">${i + 1}</th><td class="par">${course.pars[i]}</td><td class="si">${course.strokeIndex[i]}</td>${cells}</tr>`;
  }).join('');

  const foot = (label, key, cls = '') => `<tr class="${cls}"><th colspan="3" scope="row">${label}</th>${
    playing.map((p) => `<td data-${key}="${esc(p.id)}">—</td>`).join('')}</tr>`;

  page.innerHTML = `
    <div class="page-head">
      <h2>${editing ? 'Edit card' : 'Scorecard'}</h2>
      ${editing ? '<button type="button" class="btn small quiet" data-action="new-card">Start a new card</button>' : ''}
    </div>
    <div class="fields">
      <label class="field"><span class="label">Date</span><input type="date" id="card-date" value="${esc(draft.date)}" required></label>
      <div class="field"><span class="label">Course</span><span class="line-input" style="display:block;border-bottom-style:dotted">${esc(course.name)} <span class="fine">${course.rating.toFixed(1)} / ${course.slope}</span></span></div>
    </div>
    <h3>Who played</h3>
    <div class="chips">${chips}</div>
    ${playing.length ? `
      <div class="card-wrap">
        <table class="scorecard">
          <colgroup><col class="c-hole"><col class="c-par"><col class="c-si">${playing.map(() => '<col>').join('')}</colgroup>
          <thead><tr><th scope="col">Hole</th><th scope="col">Par</th><th scope="col">Hcp</th>${head}</tr></thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr><th colspan="3" scope="row">Out <span class="fine">${coursePar(course)}</span></th>${
              playing.map((p) => `<td data-gross="${esc(p.id)}">—</td>`).join('')}</tr>
            ${foot('Adj', 'adj', 'sub')}
            ${foot('Diff', 'diff', 'sub')}
          </tfoot>
        </table>
      </div>
      <div class="legend">
        <span><i class="mk circle"></i>birdie</span>
        <span><i class="mk square"></i>bogey</span>
        ${editing ? '' : '<span><i class="mk dot"></i>stroke received</span>'}
        ${book.rules.capHoles ? '<span>small number: hole capped at net double bogey</span>' : ''}
      </div>
      <div class="sticky-actions spread">
        <div class="row">
          ${editing ? '<button type="button" class="btn danger small" data-action="delete-round">Delete</button>' : ''}
          <button type="button" class="btn quiet small" data-action="clear-card">${editing ? 'Discard changes' : 'Clear'}</button>
        </div>
        <button type="button" class="btn primary" data-action="save-card">${editing ? 'Save changes' : 'Sign card'}</button>
      </div>`
    : '<p class="note">Tick who played to open the card.</p>'}
  `;
  refreshCardLive();
}

function refreshCardLive() {
  if (!draft || !page.querySelector('.scorecard')) return;
  const { id, result } = projectDraft();
  for (const pid of draft.playing) {
    const card = result.cards.get(`${id}:${pid}`);
    const holes = draftHoles(pid);
    const set = (attr, text) => {
      const el = page.querySelector(`[data-${attr}="${CSS.escape(pid)}"]`);
      if (el) el.textContent = text;
    };
    set('gross', card?.gross ?? '—');
    set('adj', card?.complete ? card.adjustedGross : '—');
    set('diff', card?.complete ? fmtDiff(card.differential) : `${holes.filter(Boolean).length}/9`);
    for (let i = 0; i < HOLES; i++) {
      const el = page.querySelector(`[data-capped="${CSS.escape(`${pid}:${i}`)}"]`);
      if (!el) continue;
      const adj = card?.complete ? card.adjusted[i] : null;
      el.textContent = adj != null && adj < holes[i] ? adj : '';
      el.title = el.textContent ? `Counts as ${adj} for handicap` : '';
    }
  }
}

page.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-hole]')) {
    const clean = t.value.replace(/\D/g, '').slice(0, 2);
    if (clean !== t.value) t.value = clean;
    const n = clean ? Number(clean) : null;
    const i = Number(t.dataset.hole);
    draftHoles(t.dataset.player)[i] = n > 0 ? n : null;
    t.closest('.cell').className = `cell ${markClass(n, draftCourse().pars[i])}`;
    saveJson(DRAFT_KEY, draft);
    refreshCardLive();
    // A single 2–9, or any two digits, is a finished score: drop to the next hole.
    // A lone 1 waits, since it might be the start of 10.
    if (/^[2-9]$|^\d\d$/.test(clean)) focusHole(t.dataset.player, i + 1);
  } else if (t.id === 'card-date') {
    draft.date = t.value;
    saveJson(DRAFT_KEY, draft);
    refreshCardLive();
  }
});

function focusHole(pid, i) {
  const next = page.querySelector(`[data-player="${CSS.escape(pid)}"][data-hole="${i}"]`);
  if (next) { next.focus(); next.select(); } else document.activeElement?.blur();
}

page.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t.matches('[data-hole]')) return;
  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusHole(t.dataset.player, Number(t.dataset.hole) + 1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); focusHole(t.dataset.player, Number(t.dataset.hole) - 1); }
});
page.addEventListener('focusin', (e) => { if (e.target.matches('[data-hole]')) e.target.select(); });

function saveCard() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) { toast('Pick a date for the round.'); return; }
  const scores = {};
  const missing = [];
  for (const pid of draft.playing) {
    const holes = draftHoles(pid);
    if (!holes.some(Boolean)) continue;
    scores[pid] = [...holes];
    if (!isCompleteCard(holes)) missing.push(playerById(pid).name);
  }
  if (!Object.keys(scores).length) { toast('Nothing on the card yet.'); return; }
  if (missing.length && !confirm(
    `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing holes. Incomplete cards are kept but don't count toward a handicap. Save anyway?`,
  )) return;

  const existing = draft.id && book.rounds.find((r) => r.id === draft.id);
  if (existing) {
    existing.date = draft.date;
    existing.scores = scores;
  } else {
    book.rounds.push({ id: uid(), date: draft.date, createdAt: Date.now(), course: copyCourse(book.course), scores });
  }
  draft = null;
  saveJson(DRAFT_KEY, null);
  commit(existing ? 'Card updated.' : 'Card signed.');
  location.hash = '#rounds';
}

/* ---------------- strokes ---------------- */

function renderStrokes() {
  if (!book.players.length) {
    page.innerHTML = emptyPrompt('Nobody to give strokes to', 'Strokes come from each player\'s handicap, which comes from their rounds.');
    return;
  }
  const course = book.course;
  const rated = derived.standings.filter((s) => s.index != null);
  let today = loadJson(TODAY_KEY);
  if (!Array.isArray(today)) today = rated.map((s) => s.player.id);
  today = today.filter((id) => playerById(id));
  const allowance = book.rules.allowance;

  const chips = derived.standings.map((s) => `
    <label class="chip">
      <input type="checkbox" data-today="${esc(s.player.id)}" ${today.includes(s.player.id) ? 'checked' : ''} ${s.index == null ? 'disabled' : ''}>
      <span class="tick" aria-hidden="true"></span>${esc(s.player.name)}
      <span class="fine">${s.index == null ? 'no index' : fmtIndex(s.index)}</span>
    </label>`).join('');

  const { rows } = strokesToGive(
    today.map((id) => ({ id, name: playerById(id).name, index: standingFor(id).index })),
    course,
    allowance,
  );

  const list = rows.map((r, n) => {
    const strip = r.perHole.map((k, i) => `<span class="${k ? 'on' : ''}">${i + 1}<span class="d">${'<i></i>'.repeat(k)}</span></span>`).join('');
    return `<li>
      <div class="who">${esc(r.name)}</div>
      <div class="big ${r.strokes ? '' : 'scratch'}">${r.strokes || '0'}<small>${n === 0 ? 'plays off' : 'strokes'}</small></div>
      <div class="meta">Index ${fmtIndex(r.index)} · Course hcp ${r.courseHcp}${allowance !== 100 ? ` · Playing ${r.playing}` : ''}</div>
      ${r.strokes ? `<div class="holes-strip" aria-label="Strokes on holes">${strip}</div>` : ''}
    </li>`;
  }).join('');

  let matrix = '';
  if (rows.length >= 3) {
    const m = strokeMatrix(rows);
    matrix = `
      <h3>Head to head</h3>
      <p class="note">Row gives column. Read across your own name for every side match.</p>
      <div class="card-wrap"><table class="matrix">
        <thead><tr><th></th>${rows.map((r) => `<th scope="col">${esc(r.name)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((a, i) => `<tr><th scope="row">${esc(a.name)}</th>${rows.map((b, j) => {
          if (i === j) return '<td class="self"></td>';
          const v = m[i][j];
          return v > 0 ? `<td class="give">gives ${v}</td>` : v < 0 ? `<td>gets ${-v}</td>` : '<td class="zero">even</td>';
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
  }

  page.innerHTML = `
    <div class="page-head"><h2>Strokes today</h2>
      <label class="field" style="min-width:120px"><span class="label">Allowance</span>
        <select id="allowance">${[100, 95, 90, 85, 80, 75].map((a) => `<option value="${a}" ${a === allowance ? 'selected' : ''}>${a}%</option>`).join('')}</select>
      </label>
    </div>
    <h3>Who's playing</h3>
    <div class="chips">${chips}</div>
    ${rows.length ? `
      <ul class="giving">${list}</ul>
      <p class="note">Lowest handicap plays off scratch; everyone else gets the difference. Dots mark the holes the strokes fall on, hardest first by the card's Hcp row.</p>
      ${matrix}` : `<p class="note">${rated.length ? 'Tick two or more players.' : 'No one has a handicap yet — sign a complete nine-hole card first.'}</p>`}
  `;
}

/* ---------------- players ---------------- */

function renderPlayers() {
  const sorted = [...derived.standings].sort((a, b) =>
    (a.index == null) - (b.index == null) || (a.index ?? 0) - (b.index ?? 0) || a.player.name.localeCompare(b.player.name));

  const cards = sorted.map((s) => {
    const shown = s.history.filter((e) => s.window.has(e.roundId));
    const older = s.history.length - shown.length;
    const diffs = shown.map((e) => `<span class="${s.used.has(e.roundId) ? 'used' : ''}" title="${esc(fmtDate(e.date))}: ${e.gross}${e.adjustedGross !== e.gross ? ` (adj ${e.adjustedGross})` : ''}">${fmtDiff(e.differential)}</span>`).join('');
    const sub = s.index == null
      ? 'No complete nine yet'
      : `Best ${s.use} of ${s.eligible} · ${s.total} round${s.total === 1 ? '' : 's'} on file`;
    return `
      <article class="player">
        <div class="player-head">
          <div>
            <h2 class="player-name">${esc(s.player.name)}</h2>
            <p class="player-sub">${sub}</p>
          </div>
          <div class="index-box">
            <span class="label">Index</span>
            <div class="val ${s.index == null ? 'none' : ''}">${fmtIndex(s.index)}</div>
          </div>
        </div>
        ${shown.length ? `<div class="diffs" aria-label="Differentials, oldest to newest; circled ones count">${diffs}</div>` : ''}
        ${older ? `<p class="fine">${older} older round${older === 1 ? '' : 's'} outside the last 20.</p>` : ''}
        <div class="row player-actions">
          <button type="button" class="btn small quiet" data-action="rename" data-id="${esc(s.player.id)}">Rename</button>
          <button type="button" class="btn small danger" data-action="remove-player" data-id="${esc(s.player.id)}">Remove</button>
        </div>
      </article>`;
  }).join('');

  page.innerHTML = `
    <div class="page-head"><h2>Players</h2></div>
    <form class="add-player" id="add-player">
      <label class="field" style="flex:1"><span class="label">New player</span>
        <input class="line-input" id="new-player" maxlength="24" autocomplete="off" placeholder="Name" required>
      </label>
      <button class="btn primary" type="submit">Add</button>
    </form>
    ${book.players.length ? `
      <p class="note">Differentials from the last 20 nines, oldest first. <b>Circled</b> ones make up the index.</p>
      ${cards}` : '<div class="empty"><p>Add everyone in the group, then start a card.</p><button type="button" class="btn quiet" data-action="demo">Or load a demo book</button></div>'}
  `;
}

page.addEventListener('submit', (e) => {
  if (e.target.id !== 'add-player') return;
  e.preventDefault();
  const input = document.getElementById('new-player');
  const name = input.value.trim();
  if (!name) return;
  if (book.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast(`${name} is already in the book.`); return; }
  const player = { id: uid(), name };
  book.players.push(player);
  if (draft && !draft.id) draft.playing.push(player.id);
  saveJson(DRAFT_KEY, draft);
  commit(`${name} added.`);
  renderPlayers();
  document.getElementById('new-player').focus();
});

/* ---------------- rounds ---------------- */

function renderRounds() {
  const rounds = [...book.rounds].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const slips = rounds.map((r) => {
    const lines = Object.keys(r.scores).filter(playerById).map((pid) => {
      const card = derived.cards.get(`${r.id}:${pid}`);
      const counts = standingFor(pid)?.used.has(r.id);
      return `<tr>
        <td>${esc(playerById(pid).name)}</td>
        <td>${card?.gross ?? '—'}${card?.complete ? '' : ` <span class="fine">(${r.scores[pid].filter(Boolean).length}/9)</span>`}</td>
        <td>${card?.complete ? card.adjustedGross : '—'}</td>
        <td class="${counts ? 'counts' : ''}" ${counts ? 'title="Counts toward current index"' : ''}>${card?.complete ? fmtDiff(card.differential) : '—'}</td>
      </tr>`;
    }).join('');
    return `
      <article class="round">
        <div class="round-head">
          <span class="round-date">${esc(fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</span>
          <span class="round-course">${esc(r.course.name)} · ${r.course.rating.toFixed(1)}/${r.course.slope}</span>
        </div>
        <table>
          <thead><tr><th>Player</th><th>Gross</th><th>Adj</th><th>Diff</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
        <div class="row end round-actions"><a class="btn small quiet" href="#card/${esc(r.id)}">Edit card</a></div>
      </article>`;
  }).join('');

  page.innerHTML = `
    <div class="page-head"><h2>Rounds</h2><a class="btn small" href="#card">New card</a></div>
    ${rounds.length
      ? `<p class="note">Adj is the score after capping blow-up holes. <b style="color:var(--red)">Red</b> differentials count toward that player's index right now.</p>${slips}`
      : '<div class="empty"><p>No rounds yet. Sign a card and it lands here.</p><a class="btn primary" href="#card">Start a card</a></div>'}
  `;
}

/* ---------------- course ---------------- */

function renderCourse() {
  const c = book.course;
  const hole = (i) => `<span class="hn">${i + 1}</span>`;
  const n = derived.standings.reduce((m, s) => Math.max(m, s.eligible), 0);
  const theme = loadJson(THEME_KEY) || 'auto';

  page.innerHTML = `
    <div class="page-head"><h2>Course</h2></div>
    <form id="course-form">
      <div class="fields">
        <label class="field" style="grid-column:1/-1"><span class="label">Name</span><input id="c-name" maxlength="40" value="${esc(c.name)}"></label>
        <label class="field"><span class="label">Course rating</span><input id="c-rating" inputmode="decimal" value="${c.rating}"></label>
        <label class="field"><span class="label">Slope</span><input id="c-slope" inputmode="numeric" value="${c.slope}"></label>
      </div>
      <h3>Holes</h3>
      <div class="hole-grid">
        <span class="hd" style="border-bottom:2px solid var(--ink)">Hole</span>${Array.from({ length: HOLES }, (_, i) => hole(i)).join('')}
        <span class="hd">Par</span>${c.pars.map((p, i) => `<input inputmode="numeric" maxlength="1" aria-label="Par, hole ${i + 1}" data-par="${i}" value="${p}">`).join('')}
        <span class="hd">Hcp</span>${c.strokeIndex.map((p, i) => `<input inputmode="numeric" maxlength="1" aria-label="Stroke index, hole ${i + 1}" data-si="${i}" value="${p}">`).join('')}
      </div>
      <p class="fine">Hcp is the stroke index: 1 is the hardest hole and gets the first stroke.</p>
      <div id="course-problems"></div>
      <label class="switch" style="margin-top:12px"><input type="checkbox" id="c-rerate">
        <span>Also apply to rounds already played <span class="fine">— otherwise each round keeps the course it was played on</span></span></label>
      <div class="row end" style="margin-top:12px"><button class="btn primary" type="submit">Save course</button></div>
    </form>

    <h3>Rules</h3>
    <label class="switch"><input type="checkbox" id="r-cap" ${book.rules.capHoles ? 'checked' : ''}>
      <span>Cap blow-up holes at net double bogey<br><span class="fine">Par + 2 + any strokes received. Before a player has an index the cap is par + 5.</span></span></label>

    <h3>How the index works</h3>
    <div class="formula">Differential = (113 ÷ ${c.slope}) × (Adj score − ${c.rating.toFixed(1)})</div>
    <p class="note">Of the most recent eligible nines, the lowest differentials are averaged${n ? ' (highlighted: where the most-played player in the book sits)' : ''}:</p>
    <table class="table-book">
      <thead><tr><th>Eligible rounds</th><th>Best rounds used</th></tr></thead>
      <tbody>${BEST_OF_TABLE.map((r) => {
        const label = r.from === r.to ? `${r.from}` : r.to === Infinity ? `${r.from}+` : `${r.from}–${r.to}`;
        const here = n >= r.from && n <= r.to;
        return `<tr class="${here ? 'here' : ''}"><td>${label}</td><td>${r.use}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <p class="note">Only the last 20 count. Strokes use course handicap: index × ${c.slope} ÷ ${STANDARD_SLOPE} + (${c.rating.toFixed(1)} − ${coursePar(c)}), rounded, and the lowest plays off scratch.</p>

    <h3>The book</h3>
    <div class="row">
      <button type="button" class="btn small" data-action="export">Download</button>
      <button type="button" class="btn small" data-action="copy">Copy</button>
      <label class="btn small" style="display:inline-grid;place-items:center">Import<input type="file" id="import-file" accept="application/json,.json" hidden></label>
      <button type="button" class="btn small quiet" data-action="demo">Load demo</button>
      <button type="button" class="btn small danger" data-action="erase">Erase all</button>
    </div>
    <p class="fine">Everything is stored in this browser only. One person keeps the book and shares a download with the group; importing replaces what's here.</p>

    <h3>Paper</h3>
    <label class="field" style="max-width:200px"><span class="label">Theme</span>
      <select id="theme-select">
        ${['auto', 'light', 'dark'].map((t) => `<option value="${t}" ${t === theme ? 'selected' : ''}>${{ auto: 'Match device', light: 'Daylight', dark: 'Under a lamp' }[t]}</option>`).join('')}
      </select>
    </label>
  `;
  showCourseProblems(readCourseForm());
}

function readCourseForm() {
  const num = (id) => Number(String(document.getElementById(id).value).replace(',', '.'));
  return {
    name: document.getElementById('c-name').value.trim() || 'Home nine',
    rating: num('c-rating'),
    slope: num('c-slope'),
    pars: [...page.querySelectorAll('[data-par]')].map((el) => Number(el.value)),
    strokeIndex: [...page.querySelectorAll('[data-si]')].map((el) => Number(el.value)),
  };
}

function showCourseProblems(course) {
  const problems = courseProblems(course);
  if (course.slope >= 1 && course.slope < 55 && course.rating >= 55 && course.rating <= 155) {
    problems.unshift(`Rating and slope look swapped — try rating ${course.slope} and slope ${course.rating}.`);
  }
  const box = document.getElementById('course-problems');
  box.innerHTML = problems.length ? `<div class="problems">${problems.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : '';
  return problems;
}

page.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-play]')) {
    const id = t.dataset.play;
    draft.playing = t.checked
      ? book.players.map((p) => p.id).filter((pid) => pid === id || draft.playing.includes(pid))
      : draft.playing.filter((pid) => pid !== id);
    saveJson(DRAFT_KEY, draft);
    renderCard(draft.id || undefined);
  } else if (t.matches('[data-today]')) {
    const ids = [...page.querySelectorAll('[data-today]:checked')].map((el) => el.dataset.today);
    saveJson(TODAY_KEY, ids);
    renderStrokes();
  } else if (t.id === 'allowance') {
    book.rules.allowance = Number(t.value);
    commit();
    renderStrokes();
  } else if (t.id === 'r-cap') {
    book.rules.capHoles = t.checked;
    commit(t.checked ? 'Holes capped at net double bogey.' : 'Scores count as played.');
    renderCourse();
  } else if (t.id === 'theme-select') {
    saveJson(THEME_KEY, t.value === 'auto' ? null : t.value);
    applyTheme(t.value);
  } else if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then((text) => {
      const incoming = importBook(text);
      if (!confirm(`Replace this book with ${incoming.players.length} players and ${incoming.rounds.length} rounds?`)) return;
      book = incoming;
      draft = null;
      saveJson(DRAFT_KEY, null);
      commit('Book imported.');
      route();
    }).catch((err) => toast(err.message));
  }
});

page.addEventListener('input', (e) => {
  if (e.target.closest('#course-form')) showCourseProblems(readCourseForm());
});

page.addEventListener('submit', (e) => {
  if (e.target.id !== 'course-form') return;
  e.preventDefault();
  const course = readCourseForm();
  if (showCourseProblems(course).length) { toast('Fix the course numbers first.'); return; }
  book.course = copyCourse(course);
  const rerate = document.getElementById('c-rerate').checked;
  if (rerate) for (const r of book.rounds) r.course = copyCourse(course);
  commit(rerate ? `Course saved; ${book.rounds.length} rounds re-rated.` : 'Course saved for new rounds.');
  renderCourse();
});

/* ---------------- shared actions ---------------- */

page.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'save-card') saveCard();
  else if (action === 'clear-card') {
    const editing = draft?.id;
    if (!editing && Object.values(draft?.scores || {}).some((h) => grossScore(h)) && !confirm('Clear every score on this card?')) return;
    draft = editing ? draftFromRound(book.rounds.find((r) => r.id === editing)) : newDraft();
    saveJson(DRAFT_KEY, draft);
    renderCard(editing || undefined);
  } else if (action === 'new-card') {
    draft = newDraft();
    saveJson(DRAFT_KEY, draft);
    location.hash = '#card';
    renderCard();
  } else if (action === 'delete-round') {
    if (!confirm('Delete this round for everyone on it?')) return;
    book.rounds = book.rounds.filter((r) => r.id !== draft.id);
    draft = null;
    saveJson(DRAFT_KEY, null);
    commit('Round deleted.');
    location.hash = '#rounds';
  } else if (action === 'rename') {
    const p = playerById(el.dataset.id);
    const name = prompt('Rename player', p.name)?.trim();
    if (!name || name === p.name) return;
    p.name = name.slice(0, 24);
    commit('Renamed.');
    renderPlayers();
  } else if (action === 'remove-player') {
    const p = playerById(el.dataset.id);
    if (!confirm(`Remove ${p.name} and all of their scores?`)) return;
    book.players = book.players.filter((x) => x.id !== p.id);
    for (const r of book.rounds) delete r.scores[p.id];
    book.rounds = book.rounds.filter((r) => Object.keys(r.scores).length);
    commit(`${p.name} removed.`);
    renderPlayers();
  } else if (action === 'demo') {
    if (book.rounds.length && !confirm('Replace this book with the demo season?')) return;
    book = demoBook();
    draft = null;
    saveJson(DRAFT_KEY, null);
    saveJson(TODAY_KEY, null);
    commit('Demo book loaded — four friends, twelve weeks.');
    route();
  } else if (action === 'erase') {
    if (!confirm('Erase every player and round in this book? Download it first if you want a copy.')) return;
    book = emptyBook();
    draft = null;
    saveJson(DRAFT_KEY, null);
    saveJson(TODAY_KEY, null);
    commit('Book erased.');
    route();
  } else if (action === 'export') {
    const blob = new Blob([exportBook(book)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `the-nine-${localDate()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } else if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(exportBook(book));
      toast('Book copied. Paste it into a .json file to import elsewhere.');
    } catch {
      toast('Clipboard is blocked here — use Download instead.');
    }
  }
});

/* ---------------- start ---------------- */

renderMasthead();
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is an extra; the book works without it.
    });
  });
}
