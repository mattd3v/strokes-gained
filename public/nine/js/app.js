// The Nine: wiring and rendering. The maths lives in handicap.js.

import {
  COURSE,
  STANDARD_SLOPE,
  BEST_OF_TABLE,
  HOLES,
  PAR,
  markFor,
  isValidHole,
  isCompleteCard,
  cardTotal,
  scoreDifferential,
  computeStandings,
  strokesToGive,
} from './handicap.js';
import { uid, localDate, emptyBook, loadBook, saveBook, exportBook, importBook, demoBook } from './store.js';

const DRAFT_KEY = 'nine.draft.v3';
const TODAY_KEY = 'nine.today.v1';

const page = document.getElementById('page');
const toastEl = document.getElementById('toast');

let book = loadBook();
let derived = computeStandings(book.players, book.rounds);
let draft = loadJson(DRAFT_KEY); // { id, date, playing: [ids], scores: { playerId: [9 holes] } }

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
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

function commit(message) {
  derived = computeStandings(book.players, book.rounds);
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

function setDraft(next) {
  draft = next;
  saveJson(DRAFT_KEY, draft);
}

/* ---------------- masthead & routing ---------------- */

function renderMasthead() {
  document.getElementById('stamp-rating').textContent = COURSE.rating.toFixed(1);
  document.getElementById('stamp-slope').textContent = COURSE.slope;
  document.getElementById('stamp-par').textContent = PAR * HOLES;
  document.getElementById('course-line').textContent =
    `${plural(book.players.length, 'player')} · ${plural(book.rounds.length, 'round')}`;
}

const VIEWS = { card: renderCard, strokes: renderStrokes, players: renderPlayers, rounds: renderRounds };

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

const newDraft = () => ({ id: null, date: localDate(), playing: book.players.map((p) => p.id), scores: {} });

function draftFromRound(round) {
  const scores = {};
  for (const [pid, holes] of Object.entries(round.scores)) scores[pid] = [...holes];
  return { id: round.id, date: round.date, playing: Object.keys(round.scores), scores };
}

function draftHoles(pid) {
  if (!draft.scores[pid]) draft.scores[pid] = Array(HOLES).fill(null);
  return draft.scores[pid];
}

function renderCard(roundId) {
  if (!book.players.length) {
    page.innerHTML = emptyPrompt('No players yet', 'Add your group first, or load a demo season to see how the book works.');
    return;
  }
  if (roundId) {
    const round = book.rounds.find((r) => r.id === roundId);
    if (!round) { location.hash = '#card'; return; }
    if (!draft || draft.id !== roundId) setDraft(draftFromRound(round));
  }
  if (!draft) setDraft(newDraft());
  draft.playing = draft.playing.filter((id) => playerById(id));
  const editing = Boolean(draft.id);
  const playing = draft.playing.map(playerById);

  const chips = book.players.map((p) => `
    <label class="chip">
      <input type="checkbox" data-play="${esc(p.id)}" ${draft.playing.includes(p.id) ? 'checked' : ''}>
      <span class="tick" aria-hidden="true"></span>${esc(p.name)}
    </label>`).join('');

  const body = Array.from({ length: HOLES }, (_, i) => `<tr><th class="hole" scope="row">${i + 1}</th>${
    playing.map((p) => `<td><div class="cell ${markFor(draftHoles(p.id)[i])}"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off"
      aria-label="${esc(p.name)}, hole ${i + 1}" data-player="${esc(p.id)}" data-hole="${i}"
      value="${draftHoles(p.id)[i] ?? ''}"></div></td>`).join('')}</tr>`).join('');

  const foot = (label, key, cls = '') => `<tr class="${cls}"><th scope="row">${label}</th>${
    playing.map((p) => `<td data-${key}="${esc(p.id)}"></td>`).join('')}</tr>`;

  page.innerHTML = `
    <div class="page-head">
      <h2>${editing ? 'Edit round' : 'Scorecard'}</h2>
      ${editing ? '<button type="button" class="btn small quiet" data-action="new-card">New round instead</button>' : ''}
    </div>
    <label class="field" style="max-width:220px"><span class="label">Date</span>
      <input type="date" id="card-date" value="${esc(draft.date)}" required></label>
    <h3>Who played</h3>
    <div class="chips">${chips}</div>
    ${playing.length ? `
      <div class="legend"><span><i class="mk circle"></i>birdie</span><span><i class="mk square"></i>bogey</span><span>doubled: eagle or double bogey+</span></div>
      <div class="card-wrap">
        <table class="scorecard">
          <colgroup><col class="c-hole">${playing.map(() => '<col>').join('')}</colgroup>
          <thead><tr><th scope="col">Hole<br><span class="fine">par ${PAR}</span></th>${playing.map((p) => `<th class="player-col" scope="col">${esc(p.name)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
          <tfoot>${foot(`Out <span class="fine">${PAR * HOLES}</span>`, 'total')}${foot('<span aria-label="To par">±</span>', 'topar', 'sub par-row')}${foot('Diff', 'diff', 'sub')}</tfoot>
        </table>
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
  for (const p of playing) showTotals(p.id);
}

function showTotals(pid) {
  const holes = draftHoles(pid);
  const total = cardTotal(holes);
  const played = holes.filter((h) => h != null).length;
  const set = (key, text) => {
    const el = page.querySelector(`[data-${key}="${CSS.escape(pid)}"]`);
    if (el) el.textContent = text;
  };
  set('total', total == null ? '—' : `${total}`);
  const toPar = total == null ? null : total - PAR * played;
  const rel = page.querySelector(`[data-topar="${CSS.escape(pid)}"]`);
  if (rel) rel.textContent = toPar == null ? '' : toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;
  set('diff', isCompleteCard(holes) ? fmtDiff(scoreDifferential(total)) : `${played}/9`);
}

function focusHole(pid, i) {
  const next = page.querySelector(`[data-player="${CSS.escape(pid)}"][data-hole="${i}"]`);
  if (next) next.focus(); else document.activeElement?.blur();
}

/**
 * Steps through the card the way it's filled in on the course: every player
 * on a hole, then the next hole. That's the boxes' order on the page.
 */
function focusStep(from, step) {
  const boxes = [...page.querySelectorAll('[data-hole]')];
  const next = boxes[boxes.indexOf(from) + step];
  if (next) next.focus(); else if (step > 0) from.blur();
}

page.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-hole]')) {
    const clean = t.value.replace(/\D/g, '').slice(0, 2);
    if (clean !== t.value) t.value = clean;
    const n = Number(clean);
    const i = Number(t.dataset.hole);
    draftHoles(t.dataset.player)[i] = isValidHole(n) ? n : null;
    t.closest('.cell').className = `cell ${markFor(n)}`;
    saveJson(DRAFT_KEY, draft);
    showTotals(t.dataset.player);
    // A single 2–9, or any two digits, is a finished score: on to the next
    // player. A lone 1 waits, since it might be the start of 10.
    if (/^[2-9]$|^\d\d$/.test(clean)) focusStep(t, 1);
  } else if (t.id === 'card-date') {
    draft.date = t.value;
    saveJson(DRAFT_KEY, draft);
  }
});

page.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t.matches('[data-hole]')) return;
  const i = Number(t.dataset.hole);
  if (e.key === 'Enter') { e.preventDefault(); focusStep(t, 1); }
  // Backspace in an empty box goes back one; that box's score is selected,
  // so a second Backspace clears it.
  if (e.key === 'Backspace' && t.value === '') { e.preventDefault(); focusStep(t, -1); }
  if (e.key === 'ArrowDown') { e.preventDefault(); focusHole(t.dataset.player, i + 1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); focusHole(t.dataset.player, i - 1); }
});
page.addEventListener('focusin', (e) => { if (e.target.matches('[data-hole]')) e.target.select(); });

function saveCard() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) { toast('Pick a date for the round.'); return; }
  const scores = {};
  const missing = [];
  for (const pid of draft.playing) {
    const holes = draftHoles(pid);
    if (!holes.some((h) => h != null)) continue;
    scores[pid] = [...holes];
    if (!isCompleteCard(holes)) missing.push(playerById(pid).name);
  }
  if (!Object.keys(scores).length) { toast('Nothing on the card yet.'); return; }
  if (missing.length && !confirm(
    `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing holes. Incomplete cards are kept but don't count toward a handicap. Save anyway?`,
  )) return;

  const existing = draft.id && book.rounds.find((r) => r.id === draft.id);
  if (existing) Object.assign(existing, { date: draft.date, scores });
  else book.rounds.push({ id: uid(), date: draft.date, createdAt: Date.now(), scores });
  setDraft(null);
  commit(existing ? 'Round updated.' : 'Card signed.');
  location.hash = '#rounds';
}

/* ---------------- strokes ---------------- */

function renderStrokes() {
  if (!book.players.length) {
    page.innerHTML = emptyPrompt('Nobody to give strokes to', 'Strokes come from each player\'s handicap, which comes from their rounds.');
    return;
  }
  const rated = derived.standings.filter((s) => s.index != null);
  let today = loadJson(TODAY_KEY);
  if (!Array.isArray(today)) today = rated.map((s) => s.player.id);
  today = today.filter((id) => standingFor(id)?.index != null);

  const chips = derived.standings.map((s) => `
    <label class="chip">
      <input type="checkbox" data-today="${esc(s.player.id)}" ${today.includes(s.player.id) ? 'checked' : ''} ${s.index == null ? 'disabled' : ''}>
      <span class="tick" aria-hidden="true"></span>${esc(s.player.name)}
      <span class="fine">${s.index == null ? 'no index' : fmtIndex(s.index)}</span>
    </label>`).join('');

  const rows = strokesToGive(today.map((id) => ({ id, name: playerById(id).name, index: standingFor(id).index })));

  const list = rows.map((r, n) => `<li>
      <div class="who">${esc(r.name)}</div>
      <div class="big ${r.strokes ? '' : 'scratch'}">${r.strokes}<small>${n === 0 ? 'plays off' : 'strokes'}</small></div>
      <div class="meta">Index ${fmtIndex(r.index)} · Course hcp ${r.courseHcp}</div>
    </li>`).join('');

  page.innerHTML = `
    <div class="page-head"><h2>Strokes today</h2></div>
    <h3>Who's playing</h3>
    <div class="chips">${chips}</div>
    ${rows.length >= 2 ? `
      <ul class="giving">${list}</ul>
      <p class="note">Lowest handicap plays off scratch; everyone else gets the difference.</p>` : `<p class="note">${rated.length >= 2 ? 'Tick two or more players.' : 'Strokes appear once two players have signed a card.'}</p>`}
  `;
}

/* ---------------- players ---------------- */

function renderPlayers() {
  const sorted = [...derived.standings].sort((a, b) =>
    (a.index == null) - (b.index == null) || (a.index ?? 0) - (b.index ?? 0) || a.player.name.localeCompare(b.player.name));

  const cards = sorted.map((s) => {
    const shown = s.history.filter((e) => s.window.has(e.roundId));
    const older = s.history.length - shown.length;
    const diffs = shown.map((e) => `<span class="${s.used.has(e.roundId) ? 'used' : ''}" title="${esc(fmtDate(e.date))}: shot ${e.score}">${fmtDiff(e.differential)}</span>`).join('');
    const sub = s.index == null ? 'No rounds yet' : `Best ${s.use} of ${s.eligible} · ${plural(s.history.length, 'round')}`;
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
        ${older ? `<p class="fine">${plural(older, 'older round')} outside the last 20.</p>` : ''}
        <div class="row player-actions">
          <button type="button" class="btn small quiet" data-action="rename" data-id="${esc(s.player.id)}">Rename</button>
          <button type="button" class="btn small danger" data-action="remove-player" data-id="${esc(s.player.id)}">Remove</button>
        </div>
      </article>`;
  }).join('');

  const most = derived.standings.reduce((m, s) => Math.max(m, s.eligible), 0);

  page.innerHTML = `
    <div class="page-head"><h2>Players</h2></div>
    <form class="add-player" id="add-player">
      <label class="field" style="flex:1"><span class="label">New player</span>
        <input class="line-input" id="new-player" maxlength="24" autocomplete="off" placeholder="Name" required>
      </label>
      <button class="btn primary" type="submit">Add</button>
    </form>
    ${book.players.length ? `
      <p class="note">Differentials from the last 20 rounds, oldest first. <b>Circled</b> ones make up the index.</p>
      ${cards}` : '<div class="empty"><p>Add everyone in the group, then start a card.</p><button type="button" class="btn quiet" data-action="demo">Or load a demo book</button></div>'}

    <h3>How it's worked out</h3>
    <div class="formula">Differential = (${STANDARD_SLOPE} ÷ ${COURSE.slope}) × (score − ${COURSE.rating.toFixed(1)})</div>
    <p class="note">The index averages the lowest differentials from each player's most recent rounds:</p>
    <table class="table-book">
      <thead><tr><th>Eligible rounds</th><th>Best rounds used</th></tr></thead>
      <tbody>${BEST_OF_TABLE.map((r) => {
        const label = r.from === r.to ? `${r.from}` : r.to === Infinity ? `${r.from}+` : `${r.from}–${r.to}`;
        return `<tr class="${most >= r.from && most <= r.to ? 'here' : ''}"><td>${label}</td><td>${r.use}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <p class="note">Only the last 20 count. For strokes, each index becomes a course handicap (index × ${COURSE.slope} ÷ ${STANDARD_SLOPE}, rounded) and the lowest plays off scratch.</p>
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
  if (draft && !draft.id) setDraft({ ...draft, playing: [...draft.playing, player.id] });
  commit(`${name} added.`);
  renderPlayers();
  document.getElementById('new-player').focus();
});

/* ---------------- rounds ---------------- */

function renderRounds() {
  const rounds = [...book.rounds].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const slips = rounds.map((r) => {
    const lines = Object.entries(r.scores)
      .filter(([pid]) => playerById(pid))
      .map(([pid, holes]) => [pid, holes, cardTotal(holes)])
      .sort((a, b) => isCompleteCard(b[1]) - isCompleteCard(a[1]) || a[2] - b[2])
      .map(([pid, holes, total]) => {
        const counts = standingFor(pid)?.used.has(r.id);
        return `<tr>
          <td>${esc(playerById(pid).name)}</td>
          <td>${total}${isCompleteCard(holes) ? '' : ` <span class="fine">(${holes.filter((h) => h != null).length}/9)</span>`}</td>
          <td class="${counts ? 'counts' : ''}" ${counts ? 'title="Counts toward current index"' : ''}>${fmtDiff(derived.diffs.get(`${r.id}:${pid}`))}</td>
        </tr>`;
      }).join('');
    return `
      <article class="round">
        <div class="round-head">
          <span class="round-date">${esc(fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</span>
          <a class="btn small quiet" href="#card/${esc(r.id)}">Edit</a>
        </div>
        <table>
          <thead><tr><th>Player</th><th>Score</th><th>Diff</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
      </article>`;
  }).join('');

  page.innerHTML = `
    <div class="page-head"><h2>Rounds</h2><a class="btn small" href="#card">New card</a></div>
    ${rounds.length
      ? `<p class="note"><b style="color:var(--red)">Red</b> differentials count toward that player's index right now.</p>${slips}`
      : '<div class="empty"><p>No rounds yet. Sign a card and it lands here.</p><a class="btn primary" href="#card">Start a card</a></div>'}

    <h3>The book</h3>
    <div class="row">
      <button type="button" class="btn small" data-action="export">Download</button>
      <label class="btn small" style="display:inline-grid;place-items:center">Import<input type="file" id="import-file" accept="application/json,.json" hidden></label>
      <button type="button" class="btn small quiet" data-action="demo">Load demo</button>
      <button type="button" class="btn small danger" data-action="erase">Erase all</button>
    </div>
    <p class="fine">Everything is stored in this browser only. One person keeps the book and shares a download with the group; importing replaces what's here.</p>
  `;
}

/* ---------------- shared actions ---------------- */

page.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-play]')) {
    const id = t.dataset.play;
    draft.playing = book.players.map((p) => p.id)
      .filter((pid) => (pid === id ? t.checked : draft.playing.includes(pid)));
    saveJson(DRAFT_KEY, draft);
    renderCard(draft.id || undefined);
  } else if (t.matches('[data-today]')) {
    saveJson(TODAY_KEY, [...page.querySelectorAll('[data-today]:checked')].map((el) => el.dataset.today));
    renderStrokes();
  } else if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then((text) => {
      const incoming = importBook(text);
      if (!confirm(`Replace this book with ${plural(incoming.players.length, 'player')} and ${plural(incoming.rounds.length, 'round')}?`)) return;
      book = incoming;
      setDraft(null);
      commit('Book imported.');
      route();
    }).catch((err) => toast(err.message));
  }
});

function replaceBook(next, message) {
  book = next;
  setDraft(null);
  saveJson(TODAY_KEY, null);
  commit(message);
  route();
}

page.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'save-card') saveCard();
  else if (action === 'clear-card') {
    const editing = draft?.id;
    if (!editing && Object.values(draft?.scores || {}).some(cardTotal) && !confirm('Clear every score on this card?')) return;
    setDraft(editing ? draftFromRound(book.rounds.find((r) => r.id === editing)) : newDraft());
    renderCard(editing || undefined);
  } else if (action === 'new-card') {
    setDraft(newDraft());
    location.hash = '#card';
  } else if (action === 'delete-round') {
    if (!confirm('Delete this round for everyone on it?')) return;
    book.rounds = book.rounds.filter((r) => r.id !== draft.id);
    setDraft(null);
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
    replaceBook(demoBook(), 'Demo book loaded — four friends, twelve weeks.');
  } else if (action === 'erase') {
    if (!confirm('Erase every player and round? Download the book first if you want a copy.')) return;
    replaceBook(emptyBook(), 'Book erased.');
  } else if (action === 'export') {
    const blob = new Blob([exportBook(book)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `the-nine-${localDate()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
