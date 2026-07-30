// Field-relative statistics and the weighted composite score.
//
// Everything here is pure so it can be unit tested without a browser.

/**
 * The stat categories the app knows about. `source` is how the value is
 * obtained from a DataGolf skill-ratings row; derived categories compute
 * from the others.
 */
export const CATEGORIES = [
  { key: 'sg_ott', label: 'OTT', name: 'Off the tee', group: 'core', decimals: 2, unit: 'sg' },
  { key: 'sg_app', label: 'APP', name: 'Approach', group: 'core', decimals: 2, unit: 'sg' },
  { key: 'sg_arg', label: 'ARG', name: 'Around the green', group: 'core', decimals: 2, unit: 'sg' },
  { key: 'sg_putt', label: 'PUTT', name: 'Putting', group: 'core', decimals: 2, unit: 'sg' },
  { key: 'sg_t2g', label: 'T2G', name: 'Tee to green', group: 'composite', decimals: 2, unit: 'sg', derived: true },
  { key: 'sg_total', label: 'TOTAL', name: 'Total', group: 'composite', decimals: 2, unit: 'sg' },
  { key: 'driving_dist', label: 'DIST', name: 'Driving distance', group: 'driving', decimals: 1, unit: 'yds' },
  { key: 'driving_acc', label: 'ACC', name: 'Driving accuracy', group: 'driving', decimals: 1, unit: 'pct' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

/** Categories that are plain strokes-gained-per-round numbers. */
export const SG_KEYS = CATEGORIES.filter((c) => c.unit === 'sg').map((c) => c.key);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Coerces a feed value to a number. Null, undefined and empty strings are
 * missing data, not zero — Number(null) is 0, which would silently turn an
 * absent category into an exactly-average one.
 */
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * DataGolf reports driving accuracy as a fraction in some feeds and as
 * percentage points in others. If every value sits inside +/-1 we treat it as
 * a fraction and scale to points so the column reads consistently.
 */
export function accuracyScale(values) {
  const nums = values.map(toNum).filter(isNum);
  if (nums.length === 0) return 1;
  return nums.every((v) => Math.abs(v) <= 1) ? 100 : 1;
}

/** Pulls the eight category values out of a raw skill-ratings row. */
export function extractStats(skillRow, { accScale = 1 } = {}) {
  const stats = {};
  for (const key of CATEGORY_KEYS) stats[key] = null;
  if (!skillRow) return stats;

  for (const key of ['sg_ott', 'sg_app', 'sg_arg', 'sg_putt', 'sg_total', 'driving_dist']) {
    stats[key] = toNum(skillRow[key]);
  }
  const acc = toNum(skillRow.driving_acc);
  stats.driving_acc = acc === null ? null : acc * accScale;

  const parts = [stats.sg_ott, stats.sg_app, stats.sg_arg];
  stats.sg_t2g = parts.every(isNum) ? parts.reduce((a, b) => a + b, 0) : null;

  return stats;
}

export function mean(values) {
  const nums = values.filter(isNum);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Population standard deviation, which is what we want for field z-scores. */
export function stdev(values) {
  const nums = values.filter(isNum);
  if (nums.length < 2) return null;
  const m = mean(nums);
  const variance = nums.reduce((acc, v) => acc + (v - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

export function median(values) {
  const nums = values.filter(isNum).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * Summary statistics for one category across the field.
 *
 * `midpoint` is the value the diverging colour scale centres on. Strokes
 * gained has a meaningful zero (tour average), so we use it whenever the field
 * actually straddles zero. Absolute measures such as raw driving distance in
 * yards do not, so those centre on the field median instead.
 */
export function summarize(values) {
  const nums = values.filter(isNum);
  const min = nums.length ? Math.min(...nums) : null;
  const max = nums.length ? Math.max(...nums) : null;
  const straddlesZero = nums.length > 0 && min < 0 && max > 0;
  return {
    n: nums.length,
    min,
    max,
    mean: mean(nums),
    stdev: stdev(nums),
    median: median(nums),
    midpoint: straddlesZero ? 0 : median(nums),
    anchor: straddlesZero ? 'zero' : 'median',
  };
}

/** Per-category field summaries, keyed by category. */
export function summarizeField(rows) {
  const out = {};
  for (const key of CATEGORY_KEYS) {
    out[key] = summarize(rows.map((r) => r.stats?.[key] ?? null));
  }
  return out;
}

/**
 * Percentile of `value` within `sorted` (ascending), counting ties as half.
 * Returns 0..1.
 */
export function percentileOf(sorted, value) {
  if (!isNum(value) || sorted.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return (below + equal / 2) / sorted.length;
}

/** Builds ascending value lists per category, for percentile lookups. */
export function sortedValues(rows) {
  const out = {};
  for (const key of CATEGORY_KEYS) {
    out[key] = rows
      .map((r) => r.stats?.[key] ?? null)
      .filter(isNum)
      .sort((a, b) => a - b);
  }
  return out;
}

/**
 * Attaches `z` and `pct` maps to each row, computed against the field.
 * Mutates and returns the rows for convenience.
 */
export function annotate(rows) {
  const summaries = summarizeField(rows);
  const sorted = sortedValues(rows);
  for (const row of rows) {
    row.z = {};
    row.pct = {};
    for (const key of CATEGORY_KEYS) {
      const v = row.stats?.[key];
      const s = summaries[key];
      row.z[key] = isNum(v) && s.stdev ? (v - s.mean) / s.stdev : null;
      row.pct[key] = percentileOf(sorted[key], v);
    }
  }
  return { rows, summaries };
}

/**
 * Weighted composite score.
 *
 * mode 'z'   - weighted average of field z-scores, divided by the total
 *              absolute weight so the number stays on a z-like scale and is
 *              comparable across weight sets. Mixes strokes gained with
 *              distance and accuracy safely because everything is unitless.
 * mode 'raw' - weighted sum of raw strokes gained per round. Distance and
 *              accuracy are excluded because yards and percentage points do
 *              not add to strokes.
 *
 * Returns null when the player is missing every weighted category.
 */
export function compositeScore(row, weights, mode = 'z') {
  const keys = mode === 'raw' ? SG_KEYS : CATEGORY_KEYS;
  let total = 0;
  let weightSum = 0;
  let used = 0;

  for (const key of keys) {
    const w = Number(weights[key]) || 0;
    if (w === 0) continue;
    const v = mode === 'raw' ? row.stats?.[key] : row.z?.[key];
    if (!isNum(v)) continue;
    total += w * v;
    weightSum += Math.abs(w);
    used += 1;
  }

  if (used === 0) return null;
  return mode === 'raw' ? total : total / weightSum;
}

/** True when no category carries a non-zero weight for the active mode. */
export function weightsAreEmpty(weights, mode = 'z') {
  const keys = mode === 'raw' ? SG_KEYS : CATEGORY_KEYS;
  return keys.every((k) => (Number(weights[k]) || 0) === 0);
}

/**
 * Applies min/max bounds. `bounds` is { [key]: {min, max} } where either side
 * may be null/'' for unbounded. Values are compared in display units.
 */
export function passesBounds(row, bounds) {
  for (const [key, bound] of Object.entries(bounds || {})) {
    if (!bound) continue;
    const min = bound.min === '' || bound.min == null ? null : Number(bound.min);
    const max = bound.max === '' || bound.max == null ? null : Number(bound.max);
    if (min == null && max == null) continue;

    const v = key.startsWith('odds_') ? row.odds?.[key.slice(5)] : row.stats?.[key];
    if (!isNum(v)) return false; // an active bound excludes players with no value
    if (min != null && Number.isFinite(min) && v < min) return false;
    if (max != null && Number.isFinite(max) && v > max) return false;
  }
  return true;
}

/**
 * Maps a value to a diverging colour level in -4..4 relative to the field.
 * Level 0 means "at the midpoint". Uses the field's spread so the scale
 * adapts to how tightly bunched the category is.
 */
export function colorLevel(value, summary) {
  if (!isNum(value) || !summary || !summary.stdev) return 0;
  const delta = (value - summary.midpoint) / summary.stdev;
  const magnitude = Math.min(4, Math.ceil(Math.abs(delta) / 0.5));
  return delta < 0 ? -magnitude : magnitude;
}
