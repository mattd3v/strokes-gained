// Weight presets. Values are per-category multipliers; anything omitted is 0.

import { CATEGORY_KEYS } from './scoring.js';

export function emptyWeights() {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0]));
}

export function makeWeights(partial) {
  return { ...emptyWeights(), ...partial };
}

export const BUILT_IN_PRESETS = [
  {
    id: 'balanced',
    name: 'Balanced',
    note: 'Equal weight across the four core categories.',
    weights: makeWeights({ sg_ott: 1, sg_app: 1, sg_arg: 1, sg_putt: 1 }),
  },
  {
    id: 'ball-strikers',
    name: 'Ball strikers',
    note: 'Approach-led tee-to-green play, putting ignored.',
    weights: makeWeights({ sg_ott: 1, sg_app: 2, sg_arg: 0.5, sg_putt: 0 }),
  },
  {
    id: 'approach-heavy',
    name: 'Approach heavy',
    note: 'For iron-demanding tracks with small greens.',
    weights: makeWeights({ sg_ott: 0.5, sg_app: 3, sg_arg: 0.5, sg_putt: 0.5 }),
  },
  {
    id: 'bombers',
    name: 'Bombers',
    note: 'Length off the tee first, accuracy discounted.',
    weights: makeWeights({ sg_ott: 1.5, sg_app: 1, driving_dist: 2, driving_acc: -0.5 }),
  },
  {
    id: 'position',
    name: 'Position players',
    note: 'Fairways and irons for tight, penal layouts.',
    weights: makeWeights({ sg_ott: 1, sg_app: 1.5, driving_acc: 1.5, driving_dist: -0.25 }),
  },
  {
    id: 'short-game',
    name: 'Short game',
    note: 'Scrambling and putting for firm, tricky greens.',
    weights: makeWeights({ sg_arg: 2, sg_putt: 1.5, sg_app: 0.5 }),
  },
  {
    id: 'putting-contest',
    name: 'Putting contest',
    note: 'Bentgrass birdie-fests where the flat stick decides it.',
    weights: makeWeights({ sg_putt: 2, sg_app: 1, sg_ott: 0.5 }),
  },
  {
    id: 'total',
    name: 'Total only',
    note: 'Straight DataGolf overall skill estimate.',
    weights: makeWeights({ sg_total: 1 }),
  },
];

export function findPreset(id, custom = []) {
  return [...BUILT_IN_PRESETS, ...custom].find((p) => p.id === id) || null;
}

/** True when two weight maps are equal within floating point noise. */
export function weightsEqual(a, b) {
  return CATEGORY_KEYS.every((k) => Math.abs((Number(a?.[k]) || 0) - (Number(b?.[k]) || 0)) < 1e-9);
}
