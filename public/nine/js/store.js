// The book: players and rounds, kept in this browser's localStorage.
// Export/import moves it between phones.

import { HOLES, isValidHole } from './handicap.js';

const KEY = 'nine.book.v3';
export const FORMAT = 'nine-book';

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** YYYY-MM-DD in local time; toISOString would give UTC and slip a day. */
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function emptyBook() {
  return { players: [], rounds: [] };
}

/** Accepts anything and returns a well-formed book, or throws with a reason. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('That is not a Nine book.');
  const book = emptyBook();

  const ids = new Set();
  for (const p of Array.isArray(raw.players) ? raw.players : []) {
    if (!p || !p.id || ids.has(String(p.id))) continue;
    ids.add(String(p.id));
    book.players.push({ id: String(p.id), name: String(p.name || 'Player').slice(0, 24) });
  }

  for (const r of Array.isArray(raw.rounds) ? raw.rounds : []) {
    if (!r || !r.id || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) continue;
    const scores = {};
    for (const [pid, holes] of Object.entries(r.scores || {})) {
      if (!ids.has(pid) || !Array.isArray(holes)) continue;
      const clean = Array.from({ length: HOLES }, (_, i) => (isValidHole(Number(holes[i])) ? Number(holes[i]) : null));
      if (clean.some((h) => h != null)) scores[pid] = clean;
    }
    if (!Object.keys(scores).length) continue;
    book.rounds.push({ id: String(r.id), date: r.date, createdAt: Number(r.createdAt) || 0, scores });
  }
  return book;
}

export function loadBook() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw ? normalize(raw) : emptyBook();
  } catch {
    return emptyBook();
  }
}

export function saveBook(book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
    return true;
  } catch {
    return false;
  }
}

export function exportBook(book) {
  return JSON.stringify({ format: FORMAT, version: 3, exportedAt: new Date().toISOString(), ...book }, null, 2);
}

export function importBook(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (raw && raw.format && raw.format !== FORMAT) throw new Error('That file is not a Nine book.');
  return normalize(raw);
}

/**
 * A believable season for four friends, so the pages have something on them.
 * Seeded, so the demo looks the same every time.
 */
export function demoBook(today = new Date()) {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const typical = { Alex: 3.2, Jordan: 3.6, Sam: 3.9, Riley: 4.3 }; // strokes per hole
  const book = emptyBook();
  book.players = Object.keys(typical).map((name) => ({ id: uid(), name }));

  for (let w = 11; w >= 0; w--) {
    const d = new Date(today);
    d.setDate(d.getDate() - w * 7 - 1);
    const scores = {};
    for (const p of book.players) {
      if (rand() < 0.15) continue; // someone always misses a week
      scores[p.id] = Array.from({ length: HOLES }, () =>
        Math.max(2, Math.round(typical[p.name] + (rand() + rand() - 1) * 1.6)));
    }
    book.rounds.push({ id: uid(), date: localDate(d), createdAt: d.getTime(), scores });
  }
  return book;
}
