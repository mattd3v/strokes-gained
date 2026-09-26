import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bestCountFor,
  isValidScore,
  courseHandicap,
  scoreDifferential,
  handicapIndex,
  computeStandings,
  strokesToGive,
  strokeMatrix,
} from '../public/nine/js/handicap.js';

test('bestCountFor follows the eligible-round table', () => {
  const expected = {
    0: 0, 1: 1, 5: 1, 6: 2, 8: 2, 9: 3, 11: 3, 12: 4, 14: 4,
    15: 5, 16: 5, 17: 6, 18: 6, 19: 7, 20: 8, 35: 8,
  };
  for (const [n, use] of Object.entries(expected)) {
    assert.equal(bestCountFor(Number(n)), use, `${n} rounds`);
  }
});

test('score differential uses 113 / slope against the rating', () => {
  // (113 / 87) × (36 − 27.3) = 11.30
  assert.equal(scoreDifferential(36), 11.3);
  assert.equal(scoreDifferential(30), 3.5);
  // Under the rating goes negative.
  assert.equal(scoreDifferential(27), -0.4);
});

test('scores must be whole nine-hole totals', () => {
  assert.ok(isValidScore(34));
  assert.ok(!isValidScore(8));
  assert.ok(!isValidScore(34.5));
  assert.ok(!isValidScore(null));
});

test('handicap index averages the best N of the most recent 20', () => {
  const diffs = [10, 4, 8, 6, 12, 5]; // 6 rounds → best 2
  const entries = diffs.map((d, i) => ({ roundId: `r${i}`, differential: d }));
  const result = handicapIndex(entries);
  assert.equal(result.use, 2);
  assert.equal(result.index, 4.5);
  assert.deepEqual(result.used.map((e) => e.roundId), ['r1', 'r5']);
});

test('only the most recent 20 rounds are eligible', () => {
  // A brilliant round 21 rounds ago no longer counts.
  const entries = [{ roundId: 'old', differential: -5 }];
  for (let i = 0; i < 20; i++) entries.push({ roundId: `r${i}`, differential: 10 + i });
  const result = handicapIndex(entries);
  assert.equal(result.use, 8);
  assert.ok(!result.used.some((e) => e.roundId === 'old'));
  assert.equal(result.index, 13.5); // mean of 10..17
});

test('no rounds means no index', () => {
  assert.equal(handicapIndex([]).index, null);
  assert.equal(courseHandicap(null), null);
});

test('course handicap scales the index by slope', () => {
  assert.equal(courseHandicap(10), 8);   // 7.70
  assert.equal(courseHandicap(0), 0);
  assert.equal(courseHandicap(-1), -1);  // plus handicap: -0.77
});

test('standings read rounds in date order, skipping bad scores', () => {
  const players = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }];
  const rounds = [
    // Entered out of order on purpose.
    { id: 'r2', date: '2026-06-08', scores: { a: 30 } },
    { id: 'r1', date: '2026-06-01', scores: { a: 36, b: 5, ghost: 33 } },
  ];
  const { standings, diffs } = computeStandings(players, rounds);
  const ann = standings.find((s) => s.player.id === 'a');
  const bo = standings.find((s) => s.player.id === 'b');

  assert.deepEqual(ann.history.map((e) => e.roundId), ['r1', 'r2']);
  assert.equal(diffs.get('r1:a'), 11.3);
  assert.equal(ann.index, 3.5); // 2 rounds → best 1
  assert.ok(ann.used.has('r2'));
  assert.equal(bo.index, null);
  assert.equal(diffs.has('r1:b'), false);
});

test('strokes to give are relative to the lowest course handicap', () => {
  const rows = strokesToGive([
    { id: 'a', index: 10 },   // 7.70 → 8
    { id: 'b', index: 3 },    // 2.31 → 2
    { id: 'c', index: 22.4 }, // 17.25 → 17
    { id: 'd', index: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.courseHcp, r.strokes]), [['b', 2, 0], ['a', 8, 6], ['c', 17, 15]]);

  const m = strokeMatrix(rows);
  assert.equal(m[0][2], 15);  // b gives c 15
  assert.equal(m[2][1], -9);  // c receives 9 from a
});
