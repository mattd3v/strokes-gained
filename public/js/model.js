// Turns raw DataGolf feed payloads into the row objects the table renders.

import { accuracyScale, extractStats, annotate, summarize } from './scoring.js';

/** DataGolf sends "Scheffler, Scottie"; people read "Scottie Scheffler". */
export function displayName(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(',');
  if (comma === -1) return trimmed;
  const last = trimmed.slice(0, comma).trim();
  const first = trimmed.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}

/** Sort key that keeps alphabetical-by-surname available. */
export function surname(raw) {
  if (typeof raw !== 'string') return '';
  const comma = raw.indexOf(',');
  return (comma === -1 ? raw : raw.slice(0, comma)).trim().toLowerCase();
}

// Null, undefined and empty strings mean "not reported", not zero.
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const ODDS_FIELDS = ['win', 'top_5', 'top_10', 'top_20', 'make_cut'];

/**
 * DataGolf's "percent" odds format returns probabilities as decimals. If every
 * value sits at or below 1 we scale to percentage points so the columns read
 * as 4.2% rather than 0.042.
 */
export function probabilityScale(rows) {
  let sawValue = false;
  for (const row of rows || []) {
    for (const field of ODDS_FIELDS) {
      const v = num(row[field]);
      if (v == null) continue;
      sawValue = true;
      if (v > 1) return 1;
    }
  }
  return sawValue ? 100 : 1;
}

function scaleOdds(row, scale) {
  const out = {};
  for (const field of ODDS_FIELDS) {
    const v = num(row[field]);
    out[field] = v == null ? null : v * scale;
  }
  return out;
}

/**
 * pre-tournament returns several model variants. Prefer the history-fit
 * baseline (it accounts for course history) and fall back to the plain one.
 */
export function pickOddsModel(preTournament) {
  if (!preTournament) return { rows: [], model: null };
  for (const name of ['baseline_history_fit', 'baseline']) {
    const rows = preTournament[name];
    if (Array.isArray(rows) && rows.length) return { rows, model: name };
  }
  return { rows: [], model: null };
}

/** Finds the schedule entry for the event the field feed is reporting on. */
export function matchScheduleEntry(schedule, eventName) {
  const entries = schedule?.schedule;
  if (!Array.isArray(entries) || !eventName) return null;
  const target = eventName.trim().toLowerCase();
  const exact = entries.find((e) => String(e.event_name || '').trim().toLowerCase() === target);
  if (exact) return exact;
  return entries.find((e) => {
    const name = String(e.event_name || '').trim().toLowerCase();
    return name && (name.includes(target) || target.includes(name));
  }) || null;
}

/**
 * Joins the field, skill ratings and odds on DataGolf's player id.
 *
 * Returns { rows, summaries, event, missingSkill } where `rows` covers every
 * player in the field; those with no skill-ratings entry carry null stats and
 * are counted in `missingSkill`.
 */
export function buildRows({ field, skills, preTournament, schedule }) {
  const fieldRows = Array.isArray(field?.field) ? field.field : [];
  const skillRows = Array.isArray(skills?.players) ? skills.players : [];

  const accScale = accuracyScale(skillRows.map((r) => r.driving_acc));
  const skillById = new Map();
  for (const row of skillRows) {
    const id = num(row.dg_id);
    if (id != null) skillById.set(id, row);
  }

  const { rows: oddsRows, model: oddsModel } = pickOddsModel(preTournament);
  const oddsScale = probabilityScale(oddsRows);
  const oddsById = new Map();
  for (const row of oddsRows) {
    const id = num(row.dg_id);
    if (id != null) oddsById.set(id, row);
  }

  let missingSkill = 0;
  const rows = fieldRows.map((entry) => {
    const dgId = num(entry.dg_id);
    const skill = dgId != null ? skillById.get(dgId) : null;
    if (!skill) missingSkill += 1;
    const oddsRow = dgId != null ? oddsById.get(dgId) : null;

    return {
      dgId,
      rawName: entry.player_name || '',
      name: displayName(entry.player_name),
      sortName: surname(entry.player_name),
      country: entry.country || '',
      amateur: Number(entry.am) === 1,
      teeTime: entry.r1_teetime || '',
      startHole: num(entry.start_hole),
      course: entry.course || '',
      dkSalary: num(entry.dk_salary),
      fdSalary: num(entry.fd_salary),
      hasSkill: Boolean(skill),
      stats: extractStats(skill, { accScale }),
      odds: oddsRow ? scaleOdds(oddsRow, oddsScale) : null,
    };
  });

  const { summaries } = annotate(rows);

  // The odds columns are filterable too, so they need field ranges as well.
  for (const field of ODDS_FIELDS) {
    summaries[`odds_${field}`] = summarize(rows.map((r) => r.odds?.[field] ?? null));
  }

  const scheduleEntry = matchScheduleEntry(schedule, field?.event_name);
  const event = {
    name: field?.event_name || scheduleEntry?.event_name || 'Unknown event',
    course: scheduleEntry?.course || '',
    location: scheduleEntry?.location || '',
    startDate: scheduleEntry?.start_date || '',
    currentRound: field?.current_round ?? null,
    lastUpdated: field?.last_updated || '',
    fieldSize: rows.length,
    oddsModel,
    accScaled: accScale !== 1,
  };

  return { rows, summaries, event, missingSkill };
}
