import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_COURSE,
  bestCountFor,
  strokesByHole,
  courseHandicap,
  adjustedHoles,
  scoreDifferential,
  handicapIndex,
  computeStandings,
  strokesToGive,
  strokeMatrix,
  courseProblems,
} from '../public/nine/js/handicap.js';

const course = DEFAULT_COURSE;
const card = (...holes) => holes;

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
  assert.equal(scoreDifferential(36, course), 11.3);
  // Under the rating goes negative.
  assert.equal(scoreDifferential(27, course), -0.4);
});

test('handicap index averages the best N of the most recent 20', () => {
  const diffs = [10, 4, 8, 6, 12, 5];                 // 6 rounds → best 2
  const entries = diffs.map((d, i) => ({ roundId: `r${i}`, differential: d }));
  const result = handicapIndex(entries);
  assert.equal(result.use, 2);
  assert.equal(result.index, 4.5);
  assert.deepEqual(result.used.map((e) => e.roundId), ['r1', 'r5']);
});

test('only the most recent 20 rounds are eligible', () => {
  // A brilliant round 21 cards ago no longer counts.
  const entries = [{ roundId: 'old', differential: -5 }];
  for (let i = 0; i < 20; i++) entries.push({ roundId: `r${i}`, differential: 10 + i });
  const result = handicapIndex(entries);
  assert.equal(result.use, 8);
  assert.ok(!result.used.some((e) => e.roundId === 'old'));
  assert.equal(result.index, 13.5);                   // mean of 10..17
});

test('no rounds means no index', () => {
  assert.equal(handicapIndex([]).index, null);
  assert.equal(courseHandicap(null, course), null);
});

test('strokes land on the hardest holes first and wrap past nine', () => {
  const si = [3, 1, 9, 5, 2, 7, 4, 8, 6];
  assert.deepEqual(strokesByHole(0, si), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(strokesByHole(2, si), [0, 1, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(strokesByHole(11, si), [1, 2, 1, 1, 2, 1, 1, 1, 1]);
  // A plus handicap gives back on the easiest hole.
  assert.deepEqual(strokesByHole(-1, si), [0, 0, -1, 0, 0, 0, 0, 0, 0]);
});

test('course handicap scales by slope and adds rating minus par', () => {
  // 10 × 87/113 + (27.3 − 27) = 7.999 → 8
  assert.equal(courseHandicap(10, course), 8);
  assert.equal(courseHandicap(0, course), 0);
});

test('holes are capped at par + 5 before a player has an index', () => {
  const holes = card(3, 9, 4, 3, 3, 3, 3, 3, 3);
  assert.deepEqual(adjustedHoles(holes, course, null), [3, 8, 4, 3, 3, 3, 3, 3, 3]);
});

test('holes are capped at net double bogey once a player has an index', () => {
  const holes = card(7, 7, 7, 3, 3, 3, 3, 3, 3);
  // Two strokes → one each on SI 1 and 2 (holes 1 and 2). Caps: 6, 6, 5.
  assert.deepEqual(adjustedHoles(holes, course, 2), [6, 6, 5, 3, 3, 3, 3, 3, 3]);
});

test('standings replay rounds in date order with the index carried in', () => {
  const players = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }];
  const rounds = [
    // Entered out of order on purpose.
    { id: 'r2', date: '2026-06-08', course, scores: { a: card(3, 4, 3, 3, 4, 3, 3, 3, 4) } },
    {
      id: 'r1', date: '2026-06-01', course, scores: {
        a: card(3, 12, 3, 3, 3, 3, 3, 3, 3),          // 12 capped to 8 → 32
        b: card(4, 4, 4, 4, 4, 4, 4, 4, null),       // incomplete: ignored
      },
    },
  ];
  const { standings, cards } = computeStandings(players, rounds);
  const ann = standings.find((s) => s.player.id === 'a');
  const bo = standings.find((s) => s.player.id === 'b');

  const first = cards.get('r1:a');
  assert.equal(first.gross, 36);
  assert.equal(first.adjustedGross, 32);
  assert.equal(first.indexBefore, null);
  assert.equal(first.differential, 6.1);            // 113/87 × 4.7

  const second = cards.get('r2:a');
  assert.equal(second.indexBefore, 6.1);
  assert.equal(second.differential, 3.5);           // 30 − 27.3 = 2.7 → 3.5

  assert.equal(ann.index, 3.5);                     // 2 rounds → best 1
  assert.equal(ann.eligible, 2);
  assert.ok(ann.used.has('r2'));
  assert.equal(bo.index, null);
  assert.equal(cards.get('r1:b').complete, false);
});

test('turning the cap off uses gross scores as posted', () => {
  const players = [{ id: 'a', name: 'Ann' }];
  const rounds = [{ id: 'r1', date: '2026-06-01', course, scores: { a: card(3, 12, 3, 3, 3, 3, 3, 3, 3) } }];
  const { cards } = computeStandings(players, rounds, { capHoles: false });
  assert.equal(cards.get('r1:a').adjustedGross, 36);
});

test('strokes to give are relative to the lowest playing handicap', () => {
  const { low, rows } = strokesToGive(
    [
      { id: 'a', name: 'Ann', index: 10 },  // CH 8
      { id: 'b', name: 'Bo', index: 3 },    // 3 × 0.77 + 0.3 = 2.6 → 3
      { id: 'c', name: 'Cy', index: 22.4 }, // 17.25 + 0.3 = 17.5 → 18
      { id: 'd', name: 'Di', index: null },
    ],
    course,
  );
  assert.equal(low.id, 'b');
  assert.deepEqual(rows.map((r) => [r.id, r.courseHcp, r.strokes]), [['b', 3, 0], ['a', 8, 5], ['c', 18, 15]]);
  assert.deepEqual(rows[1].perHole, [1, 1, 1, 1, 1, 0, 0, 0, 0]);
  assert.equal(rows[2].perHole.reduce((x, y) => x + y, 0), 15);

  const m = strokeMatrix(rows);
  assert.equal(m[0][2], 15);   // Bo gives Cy 15
  assert.equal(m[2][1], -10);  // Cy receives 10 from Ann
});

test('allowance scales the playing handicap before the difference', () => {
  const { rows } = strokesToGive([{ id: 'a', index: 20 }, { id: 'b', index: 0 }], course, 50);
  // exact CH 15.7 → playing 7.8 → 8; 0.3 → 0.15 → 0
  assert.equal(rows.find((r) => r.id === 'a').strokes, 8);
});

test('courseProblems flags a swapped rating and slope', () => {
  assert.deepEqual(courseProblems(course), []);
  const swapped = { ...course, rating: 87, slope: 27.3 };
  assert.equal(courseProblems(swapped).length, 2);
});
