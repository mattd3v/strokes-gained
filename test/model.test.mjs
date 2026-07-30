import test from 'node:test';
import assert from 'node:assert/strict';

import {
  displayName,
  surname,
  pickOddsModel,
  matchScheduleEntry,
  probabilityScale,
  buildRows,
} from '../public/js/model.js';

test('displayName flips DataGolf\'s "Last, First" ordering', () => {
  assert.equal(displayName('Scheffler, Scottie'), 'Scottie Scheffler');
  assert.equal(displayName('Rahm, Jon'), 'Jon Rahm');
  assert.equal(displayName('Cabrera Bello, Rafa'), 'Rafa Cabrera Bello');
  assert.equal(displayName('Madeupname'), 'Madeupname');
  assert.equal(displayName(undefined), '');
});

test('surname keeps an alphabetical sort key', () => {
  assert.equal(surname('Scheffler, Scottie'), 'scheffler');
  assert.equal(surname('Woods, Tiger'), 'woods');
});

test('pickOddsModel prefers the history-fit baseline', () => {
  const chosen = pickOddsModel({ baseline: [{ dg_id: 1 }], baseline_history_fit: [{ dg_id: 2 }] });
  assert.equal(chosen.model, 'baseline_history_fit');
  assert.equal(chosen.rows[0].dg_id, 2);

  assert.equal(pickOddsModel({ baseline: [{ dg_id: 1 }] }).model, 'baseline');
  assert.equal(pickOddsModel({ baseline: [] }).model, null);
  assert.equal(pickOddsModel(null).model, null);
});

test('probabilityScale converts decimals to percentage points', () => {
  assert.equal(probabilityScale([{ win: 0.04, make_cut: 0.71 }]), 100);
  assert.equal(probabilityScale([{ win: 4, make_cut: 71 }]), 1);
  assert.equal(probabilityScale([]), 1);
});

test('matchScheduleEntry falls back to a partial name match', () => {
  const schedule = { schedule: [{ event_name: 'The Genesis Invitational', course: 'Riviera CC' }] };
  assert.equal(matchScheduleEntry(schedule, 'The Genesis Invitational').course, 'Riviera CC');
  assert.equal(matchScheduleEntry(schedule, 'Genesis Invitational').course, 'Riviera CC');
  assert.equal(matchScheduleEntry(schedule, 'Sony Open'), null);
});

const FIELD = {
  event_name: 'Test Open',
  current_round: 1,
  last_updated: '2026-07-29 18:00:00 UTC',
  field: [
    { dg_id: 1, player_name: 'Alpha, Adam', country: 'USA', am: 0, r1_teetime: '08:10', dk_salary: 11000 },
    { dg_id: 2, player_name: 'Beta, Ben', country: 'ENG', am: 0, r1_teetime: '12:40', dk_salary: 8200 },
    { dg_id: 3, player_name: 'Gamma, Gus', country: 'AUS', am: 1, r1_teetime: '13:00' },
  ],
};

const SKILLS = {
  players: [
    { dg_id: 1, player_name: 'Alpha, Adam', sg_ott: 0.5, sg_app: 0.8, sg_arg: 0.1, sg_putt: 0.2, sg_total: 1.6, driving_dist: 12, driving_acc: -0.02 },
    { dg_id: 2, player_name: 'Beta, Ben', sg_ott: -0.1, sg_app: 0.2, sg_arg: 0.3, sg_putt: 0.4, sg_total: 0.8, driving_dist: -4, driving_acc: 0.03 },
  ],
};

test('buildRows joins field, skills and odds on dg_id', () => {
  const { rows, event, missingSkill } = buildRows({
    field: FIELD,
    skills: SKILLS,
    preTournament: {
      baseline_history_fit: [
        { dg_id: 1, win: 0.06, top_10: 0.31, make_cut: 0.78 },
        { dg_id: 2, win: 0.01, top_10: 0.12, make_cut: 0.6 },
      ],
    },
    schedule: { schedule: [{ event_name: 'Test Open', course: 'Test GC', location: 'Nowhere, USA', start_date: '2026-07-30' }] },
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Adam Alpha');
  assert.equal(rows[0].hasSkill, true);
  assert.ok(Math.abs(rows[0].stats.sg_t2g - 1.4) < 1e-9);
  assert.ok(Math.abs(rows[0].stats.driving_acc - -2) < 1e-9, 'accuracy scaled to points');
  assert.ok(Math.abs(rows[0].odds.win - 6) < 1e-9, 'odds scaled to percent');

  assert.equal(rows[2].hasSkill, false, 'player with no skill row still appears');
  assert.equal(rows[2].amateur, true);
  assert.equal(rows[2].stats.sg_app, null);
  assert.equal(rows[2].odds, null);
  assert.equal(missingSkill, 1);

  assert.equal(event.name, 'Test Open');
  assert.equal(event.course, 'Test GC');
  assert.equal(event.fieldSize, 3);
  assert.equal(event.oddsModel, 'baseline_history_fit');
});

test('buildRows survives missing optional feeds', () => {
  const { rows, event } = buildRows({ field: FIELD, skills: SKILLS, preTournament: null, schedule: null });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].odds, null);
  assert.equal(event.course, '');
  assert.equal(event.name, 'Test Open');
});

test('buildRows returns an empty board rather than throwing on empty feeds', () => {
  const { rows, event } = buildRows({ field: null, skills: null, preTournament: null, schedule: null });
  assert.deepEqual(rows, []);
  assert.equal(event.fieldSize, 0);
});

test('players without a skill row do not distort field statistics', () => {
  const { rows, summaries } = buildRows({ field: FIELD, skills: SKILLS });
  assert.equal(summaries.sg_app.n, 2);
  assert.ok(Math.abs(summaries.sg_app.mean - 0.5) < 1e-9);
  assert.equal(rows[2].z.sg_app, null);
});
