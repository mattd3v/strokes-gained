import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accuracyScale,
  extractStats,
  summarize,
  percentileOf,
  annotate,
  compositeScore,
  passesBounds,
  colorLevel,
  weightsAreEmpty,
  mean,
  stdev,
} from '../public/js/scoring.js';
import { makeWeights } from '../public/js/presets.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('accuracyScale detects fractions and leaves percentage points alone', () => {
  assert.equal(accuracyScale([0.02, -0.031, 0.5]), 100);
  assert.equal(accuracyScale([2.1, -3.4, 0.5]), 1);
  assert.equal(accuracyScale([]), 1);
});

test('extractStats derives tee to green and scales accuracy', () => {
  const stats = extractStats(
    { sg_ott: 0.3, sg_app: 0.5, sg_arg: 0.1, sg_putt: -0.2, sg_total: 0.7, driving_dist: 8, driving_acc: -0.03 },
    { accScale: 100 },
  );
  assert.ok(close(stats.sg_t2g, 0.9));
  assert.ok(close(stats.driving_acc, -3));
  assert.equal(stats.driving_dist, 8);
});

test('extractStats leaves everything null for a player with no skill row', () => {
  const stats = extractStats(null);
  assert.equal(stats.sg_app, null);
  assert.equal(stats.sg_t2g, null);
});

test('extractStats does not invent tee to green from partial components', () => {
  const stats = extractStats({ sg_ott: 0.3, sg_app: null, sg_arg: 0.1 });
  assert.equal(stats.sg_t2g, null);
});

test('mean and population stdev', () => {
  assert.ok(close(mean([1, 2, 3, 4]), 2.5));
  assert.ok(close(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 2));
  assert.equal(stdev([1]), null);
});

test('summarize anchors on zero when the field straddles it', () => {
  const s = summarize([-0.4, 0.1, 0.9]);
  assert.equal(s.anchor, 'zero');
  assert.equal(s.midpoint, 0);
});

test('summarize anchors on the median for an all-positive measure', () => {
  const s = summarize([295, 302, 310]);
  assert.equal(s.anchor, 'median');
  assert.equal(s.midpoint, 302);
});

test('percentileOf counts ties as half', () => {
  const sorted = [1, 2, 2, 3];
  assert.ok(close(percentileOf(sorted, 1), 0.125));
  assert.ok(close(percentileOf(sorted, 2), 0.5));
  assert.ok(close(percentileOf(sorted, 3), 0.875));
  assert.equal(percentileOf(sorted, null), null);
});

function fieldOf(...values) {
  return values.map((sg_app, i) => ({
    name: `P${i}`,
    stats: { sg_app, sg_ott: null, sg_arg: null, sg_putt: null, sg_t2g: null, sg_total: null, driving_dist: null, driving_acc: null },
  }));
}

test('annotate attaches field z-scores and percentiles', () => {
  const rows = fieldOf(-1, 0, 1);
  const { summaries } = annotate(rows);
  assert.ok(close(summaries.sg_app.mean, 0));
  assert.ok(close(rows[2].z.sg_app, 1.224744871391589, 1e-9));
  assert.ok(close(rows[1].pct.sg_app, 0.5));
  assert.equal(rows[0].z.sg_ott, null);
});

test('compositeScore in z mode is a weighted average of z-scores', () => {
  const row = { z: { sg_app: 2, sg_putt: -1 }, stats: {} };
  const weights = makeWeights({ sg_app: 3, sg_putt: 1 });
  assert.ok(close(compositeScore(row, weights, 'z'), (3 * 2 + 1 * -1) / 4));
});

test('compositeScore normalisation makes a single weighted category scale free', () => {
  const row = { z: { sg_app: 1.5 }, stats: {} };
  assert.ok(close(
    compositeScore(row, makeWeights({ sg_app: 1 }), 'z'),
    compositeScore(row, makeWeights({ sg_app: 3 }), 'z'),
  ));
});

test('negative weights penalise a category', () => {
  const good = { z: { sg_putt: 2, sg_app: 0 }, stats: {} };
  const bad = { z: { sg_putt: -2, sg_app: 0 }, stats: {} };
  const weights = makeWeights({ sg_app: 1, sg_putt: -1 });
  assert.ok(compositeScore(bad, weights, 'z') > compositeScore(good, weights, 'z'));
});

test('compositeScore in raw mode sums strokes and ignores driving columns', () => {
  const row = {
    stats: { sg_app: 0.5, sg_putt: 0.25, driving_dist: 20 },
    z: { sg_app: 1, sg_putt: 1, driving_dist: 3 },
  };
  const weights = makeWeights({ sg_app: 2, sg_putt: 1, driving_dist: 5 });
  assert.ok(close(compositeScore(row, weights, 'raw'), 2 * 0.5 + 1 * 0.25));
});

test('compositeScore is null when the player has none of the weighted categories', () => {
  const row = { z: { sg_app: null }, stats: { sg_app: null } };
  assert.equal(compositeScore(row, makeWeights({ sg_app: 1 }), 'z'), null);
});

test('compositeScore uses whatever categories the player does have', () => {
  const row = { z: { sg_app: 2, sg_putt: null }, stats: {} };
  assert.ok(close(compositeScore(row, makeWeights({ sg_app: 1, sg_putt: 1 }), 'z'), 2));
});

test('weightsAreEmpty ignores driving weights in raw mode', () => {
  assert.equal(weightsAreEmpty(makeWeights({ driving_dist: 2 }), 'raw'), true);
  assert.equal(weightsAreEmpty(makeWeights({ driving_dist: 2 }), 'z'), false);
  assert.equal(weightsAreEmpty(makeWeights({ sg_app: 1 }), 'raw'), false);
});

test('passesBounds applies min and max in display units', () => {
  const row = { stats: { sg_app: 0.4 }, odds: { win: 3.2 } };
  assert.equal(passesBounds(row, { sg_app: { min: 0.3, max: '' } }), true);
  assert.equal(passesBounds(row, { sg_app: { min: 0.5, max: '' } }), false);
  assert.equal(passesBounds(row, { sg_app: { min: '', max: 0.3 } }), false);
  assert.equal(passesBounds(row, { odds_win: { min: 2, max: '' } }), true);
  assert.equal(passesBounds(row, { odds_win: { min: 5, max: '' } }), false);
});

test('an active bound excludes players missing that value', () => {
  const row = { stats: { sg_app: null }, odds: null };
  assert.equal(passesBounds(row, { sg_app: { min: 0, max: '' } }), false);
  assert.equal(passesBounds(row, { sg_app: { min: '', max: '' } }), true);
  assert.equal(passesBounds(row, {}), true);
});

test('colorLevel is signed, clamped and zero at the midpoint', () => {
  const summary = { midpoint: 0, stdev: 1 };
  assert.equal(colorLevel(0, summary), 0);
  assert.equal(colorLevel(0.4, summary), 1);
  assert.equal(colorLevel(-0.4, summary), -1);
  assert.equal(colorLevel(9, summary), 4);
  assert.equal(colorLevel(-9, summary), -4);
  assert.equal(colorLevel(null, summary), 0);
  assert.equal(colorLevel(1, { midpoint: 0, stdev: null }), 0);
});
