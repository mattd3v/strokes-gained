// Nine-hole handicap maths. Pure: no DOM, no storage, so it runs under node:test.
//
// The pieces, in the order a round flows through them:
//   1. Adjusted gross score — each hole capped at net double bogey, so one
//      blow-up hole cannot wreck a handicap.
//   2. Score differential — (113 / slope) × (adjusted gross − course rating).
//   3. Handicap index — the best N differentials from the most recent 20,
//      with N taken from the eligible-round table below.
//   4. Course handicap — index × slope / 113 + (rating − par), rounded.
//   5. Strokes to give — each player's course handicap minus the lowest one
//      in the group, spread across holes by stroke index.

export const HOLES = 9;
export const WINDOW = 20;
export const STANDARD_SLOPE = 113;

export const DEFAULT_COURSE = Object.freeze({
  name: 'Home nine',
  rating: 27.3,
  slope: 87,
  pars: Object.freeze([3, 3, 3, 3, 3, 3, 3, 3, 3]),
  strokeIndex: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]),
});

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
  const row = BEST_OF_TABLE.find((r) => eligibleRounds >= r.from && eligibleRounds <= r.to);
  return row ? row.use : 8;
}

export function coursePar(course) {
  return course.pars.reduce((a, b) => a + b, 0);
}

export function isCompleteCard(holes) {
  return Array.isArray(holes)
    && holes.length === HOLES
    && holes.every((h) => Number.isInteger(h) && h > 0);
}

export function grossScore(holes) {
  if (!Array.isArray(holes)) return null;
  const filled = holes.filter((h) => Number.isInteger(h) && h > 0);
  return filled.length ? filled.reduce((a, b) => a + b, 0) : null;
}

/**
 * Strokes received on each hole for a given number of handicap strokes.
 * Strokes land on the lowest stroke index first; more than nine wraps round
 * for a second stroke. A negative count (a plus handicap) gives strokes back
 * starting from the easiest hole.
 */
export function strokesByHole(strokes, strokeIndex) {
  const n = strokeIndex.length;
  const s = Math.round(strokes);
  if (s === 0) return strokeIndex.map(() => 0);
  const sign = Math.sign(s);
  const abs = Math.abs(s);
  const base = Math.floor(abs / n);
  const extra = abs % n;
  return strokeIndex.map((si) => {
    // For giving strokes back, the hardest-to-par hole is the easiest one.
    const rank = sign > 0 ? si : n + 1 - si;
    const count = base + (rank <= extra ? 1 : 0);
    return count ? sign * count : 0;
  });
}

/** Unrounded course handicap; rounding happens where the number is used. */
export function courseHandicapExact(index, course) {
  return index * (course.slope / STANDARD_SLOPE) + (course.rating - coursePar(course));
}

export function courseHandicap(index, course) {
  if (index == null) return null;
  const r = Math.round(courseHandicapExact(index, course));
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Caps each hole for handicap purposes. With a course handicap the cap is
 * net double bogey (par + 2 + strokes received). With no index yet the cap
 * is par + 5, the usual rule for a player's first rounds.
 */
export function adjustedHoles(holes, course, courseHcp) {
  const received = courseHcp == null ? null : strokesByHole(courseHcp, course.strokeIndex);
  return holes.map((score, i) => {
    const par = course.pars[i];
    const cap = received ? par + 2 + received[i] : par + 5;
    return Math.min(score, cap);
  });
}

export function scoreDifferential(adjustedGross, course) {
  return round1((STANDARD_SLOPE / course.slope) * (adjustedGross - course.rating));
}

/**
 * Handicap index from a player's differentials, oldest first. Only the most
 * recent twenty count; the best N of those are averaged.
 */
export function handicapIndex(entries) {
  const recent = entries.slice(-WINDOW);
  const use = bestCountFor(recent.length);
  if (!use) return { index: null, used: [], window: recent, use: 0 };

  // Stable on ties: the earlier round wins, so the same card always counts.
  const ranked = recent
    .map((e, order) => ({ e, order }))
    .sort((a, b) => a.e.differential - b.e.differential || a.order - b.order)
    .slice(0, use)
    .map(({ e }) => e);
  const avg = ranked.reduce((sum, e) => sum + e.differential, 0) / use;
  return { index: round1(avg), used: ranked, window: recent, use };
}

export function sortRounds(rounds) {
  return [...rounds].sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * Replays every round in date order. Each card is adjusted using the index
 * the player carried into that round, which is what makes the cap honest:
 * editing an old round re-flows everything after it.
 */
export function computeStandings(players, rounds, { capHoles = true } = {}) {
  const byPlayer = new Map(players.map((p) => [p.id, []]));
  const cards = new Map();

  for (const round of sortRounds(rounds)) {
    const course = round.course;
    for (const [playerId, holes] of Object.entries(round.scores || {})) {
      const history = byPlayer.get(playerId);
      if (!history) continue;
      const key = `${round.id}:${playerId}`;
      const gross = grossScore(holes);

      if (!isCompleteCard(holes)) {
        cards.set(key, { roundId: round.id, playerId, gross, complete: false });
        continue;
      }

      const before = handicapIndex(history).index;
      const ch = courseHandicap(before, course);
      const adjusted = capHoles ? adjustedHoles(holes, course, ch) : [...holes];
      const adjustedGross = adjusted.reduce((a, b) => a + b, 0);
      const entry = {
        roundId: round.id,
        playerId,
        date: round.date,
        gross,
        adjustedGross,
        adjusted,
        indexBefore: before,
        differential: scoreDifferential(adjustedGross, course),
        complete: true,
      };
      history.push(entry);
      cards.set(key, entry);
    }
  }

  const standings = players.map((p) => {
    const history = byPlayer.get(p.id);
    const result = handicapIndex(history);
    return {
      player: p,
      history,
      index: result.index,
      used: new Set(result.used.map((e) => e.roundId)),
      window: new Set(result.window.map((e) => e.roundId)),
      use: result.use,
      eligible: result.window.length,
      total: history.length,
    };
  });

  return { standings, cards };
}

/**
 * Who gets how many from whom. The lowest playing handicap plays off
 * scratch and everyone else receives the difference, allocated hole by hole.
 */
export function strokesToGive(entries, course, allowance = 100) {
  const rated = entries
    .filter((e) => e.index != null)
    .map((e) => {
      const exact = courseHandicapExact(e.index, course);
      const courseHcp = Math.round(exact);
      const playing = Math.round(exact * (allowance / 100));
      return { ...e, courseHcp: Object.is(courseHcp, -0) ? 0 : courseHcp, playing: Object.is(playing, -0) ? 0 : playing };
    })
    .sort((a, b) => a.playing - b.playing || a.index - b.index);

  if (!rated.length) return { low: null, rows: [] };
  const low = rated[0].playing;
  const rows = rated.map((e) => {
    const strokes = e.playing - low;
    return { ...e, strokes, perHole: strokesByHole(strokes, course.strokeIndex) };
  });
  return { low: rated[0], rows };
}

/** Strokes the row player gives the column player (negative: receives). */
export function strokeMatrix(rows) {
  return rows.map((a) => rows.map((b) => b.playing - a.playing));
}

/** Plain problems with a course's numbers, as sentences. Empty means fine. */
export function courseProblems(course) {
  const problems = [];
  if (!(course.slope >= 55 && course.slope <= 155)) {
    problems.push('Slope should be between 55 and 155 (113 is average).');
  }
  const par = coursePar(course);
  if (!(course.rating > 0) || Math.abs(course.rating - par) > 12) {
    problems.push(`Course rating is normally within a few strokes of par (${par}).`);
  }
  if (!course.pars.every((p) => Number.isInteger(p) && p >= 3 && p <= 6)) {
    problems.push('Each par should be a whole number from 3 to 6.');
  }
  const si = [...course.strokeIndex].sort((a, b) => a - b);
  if (!si.every((v, i) => v === i + 1)) {
    problems.push('Stroke index should use each number 1 to 9 once.');
  }
  return problems;
}
