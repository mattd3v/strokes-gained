// The book: players, rounds, the course, and a couple of rules. It all lives
// in this browser's localStorage. Export/import moves it between phones.

import { DEFAULT_COURSE, HOLES } from './handicap.js';

const KEY = 'nine.book.v1';
export const FORMAT = 'nine-book';

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** YYYY-MM-DD in local time; toISOString would give UTC and slip a day. */
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function copyCourse(course) {
  return {
    name: String(course.name || 'Home nine'),
    rating: Number(course.rating),
    slope: Number(course.slope),
    pars: [...course.pars].map(Number),
    strokeIndex: [...course.strokeIndex].map(Number),
  };
}

export function emptyBook() {
  return {
    players: [],
    rounds: [],
    course: copyCourse(DEFAULT_COURSE),
    rules: { capHoles: true, allowance: 100 },
  };
}

function cleanHoles(holes) {
  const out = Array.from({ length: HOLES }, (_, i) => {
    const v = Array.isArray(holes) ? Number(holes[i]) : NaN;
    return Number.isInteger(v) && v > 0 && v < 30 ? v : null;
  });
  return out;
}

/** Accepts anything and returns a well-formed book, or throws with a reason. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('That is not a Nine book.');
  const book = emptyBook();

  if (raw.course && Array.isArray(raw.course.pars) && raw.course.pars.length === HOLES) {
    book.course = copyCourse({ ...DEFAULT_COURSE, ...raw.course });
  }
  if (raw.rules && typeof raw.rules === 'object') {
    book.rules.capHoles = raw.rules.capHoles !== false;
    const a = Number(raw.rules.allowance);
    if (a > 0 && a <= 100) book.rules.allowance = a;
  }

  const ids = new Set();
  for (const p of Array.isArray(raw.players) ? raw.players : []) {
    if (!p || !p.id || ids.has(p.id)) continue;
    ids.add(String(p.id));
    book.players.push({ id: String(p.id), name: String(p.name || 'Player').slice(0, 24) });
  }

  for (const r of Array.isArray(raw.rounds) ? raw.rounds : []) {
    if (!r || !r.id || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) continue;
    const scores = {};
    for (const [pid, holes] of Object.entries(r.scores || {})) {
      if (ids.has(pid)) scores[pid] = cleanHoles(holes);
    }
    const course = r.course && Array.isArray(r.course.pars) && r.course.pars.length === HOLES
      ? copyCourse({ ...DEFAULT_COURSE, ...r.course })
      : copyCourse(book.course);
    book.rounds.push({
      id: String(r.id),
      date: r.date,
      createdAt: Number(r.createdAt) || 0,
      course,
      scores,
    });
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
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), ...book }, null, 2);
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
  const book = emptyBook();
  const skill = { Alex: 0.15, Jordan: 0.55, Sam: 0.9, Riley: 1.35 };
  book.players = Object.keys(skill).map((name) => ({ id: uid(), name }));

  const weeks = 12;
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(today);
    d.setDate(d.getDate() - w * 7 - 1);
    const scores = {};
    for (const p of book.players) {
      if (rand() < 0.15) continue; // someone always misses a week
      scores[p.id] = book.course.pars.map((par) => {
        const r = rand();
        const over = skill[p.name] + (r - 0.45) * 2.2 + (r > 0.96 ? 3 : 0);
        return Math.max(2, par + Math.round(over));
      });
    }
    book.rounds.push({
      id: uid(),
      date: localDate(d),
      createdAt: d.getTime(),
      course: copyCourse(book.course),
      scores,
    });
  }
  return book;
}
