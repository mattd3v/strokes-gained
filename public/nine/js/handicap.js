// Nine-hole handicap maths for one course. Pure: no DOM, no storage, so it
// runs under node:test.
//
//   Differential     = (113 / slope) × (score − course rating)
//   Handicap index   = average of the best N differentials from the most
//                      recent 20, with N from the table below
//   Course handicap  = index × slope / 113, rounded
//   Strokes to give  = each course handicap minus the lowest in the group

export const COURSE = Object.freeze({ rating: 27.3, slope: 87 });
export const STANDARD_SLOPE = 113;
export const WINDOW = 20;

/** Eligible rounds → how many of the best differentials count. */
export const BEST_OF_TABLE = Object.freeze([
  { from: 1, to: 5, use: 1 },
  { from: 6, to: 8, use: 2 },
  { from: 9, to: 11, use: 3 },
  { from: 12, to: 14, use: 4 },
  { from: 15, to: 16, use: 5 },
  { from: 17, to: 18, use: 6 },
  { from: 19, to: 19, use: 7 },
  { from: 20, to: Infinity, use: 8 },
]);

/** Rounds to one decimal, and never returns -0. */
export function round1(x) {
  const r = Math.round(x * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

export function bestCountFor(eligibleRounds) {
  if (!(eligibleRounds >= 1)) return 0;
  return BEST_OF_TABLE.find((r) => eligibleRounds >= r.from && eligibleRounds <= r.to).use;
}

/** A plausible nine-hole total: a whole number from 9 to 99. */
export function isValidScore(score) {
  return Number.isInteger(score) && score >= 9 && score <= 99;
}

export function scoreDifferential(score, course = COURSE) {
  return round1((STANDARD_SLOPE / course.slope) * (score - course.rating));
}

export function courseHandicap(index, course = COURSE) {
  if (index == null) return null;
  const r = Math.round(index * (course.slope / STANDARD_SLOPE));
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Handicap index from a player's differentials, oldest first. Only the most
 * recent twenty count; the best N of those are averaged.
 */
export function handicapIndex(entries) {
  const recent = entries.slice(-WINDOW);
  const use = bestCountFor(recent.length);
  if (!use) return { index: null, used: [], window: recent, use: 0 };

  // Stable on ties: the earlier round wins, so the same one always counts.
  const best = recent
    .map((e, order) => ({ e, order }))
    .sort((a, b) => a.e.differential - b.e.differential || a.order - b.order)
    .slice(0, use)
    .map(({ e }) => e);
  const avg = best.reduce((sum, e) => sum + e.differential, 0) / use;
  return { index: round1(avg), used: best, window: recent, use };
}

export function sortRounds(rounds) {
  return [...rounds].sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

/** Every player's index, and the differential for every score on file. */
export function computeStandings(players, rounds, course = COURSE) {
  const byPlayer = new Map(players.map((p) => [p.id, []]));
  const diffs = new Map(); // `${roundId}:${playerId}` → differential

  for (const round of sortRounds(rounds)) {
    for (const [playerId, score] of Object.entries(round.scores || {})) {
      const history = byPlayer.get(playerId);
      if (!history || !isValidScore(score)) continue;
      const differential = scoreDifferential(score, course);
      history.push({ roundId: round.id, date: round.date, score, differential });
      diffs.set(`${round.id}:${playerId}`, differential);
    }
  }

  const standings = players.map((player) => {
    const history = byPlayer.get(player.id);
    const { index, used, window, use } = handicapIndex(history);
    return {
      player,
      history,
      index,
      used: new Set(used.map((e) => e.roundId)),
      window: new Set(window.map((e) => e.roundId)),
      use,
      eligible: window.length,
    };
  });

  return { standings, diffs };
}

/**
 * Who gets how many. The lowest course handicap plays off scratch and
 * everyone else receives the difference. Players without an index are left out.
 */
export function strokesToGive(entries, course = COURSE) {
  const rows = entries
    .filter((e) => e.index != null)
    .map((e) => ({ ...e, courseHcp: courseHandicap(e.index, course) }))
    .sort((a, b) => a.courseHcp - b.courseHcp || a.index - b.index);
  if (!rows.length) return [];
  const low = rows[0].courseHcp;
  return rows.map((r) => ({ ...r, strokes: r.courseHcp - low }));
}

/** Strokes the row player gives the column player (negative: receives). */
export function strokeMatrix(rows) {
  return rows.map((a) => rows.map((b) => b.courseHcp - a.courseHcp));
}
