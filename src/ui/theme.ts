/**
 * Verdict vocabulary and the one accent colour.
 *
 * The five verdicts are the product's language, so they get one colour each
 * and those colours are used everywhere a verdict appears — table cell, chart
 * point, legend swatch, chip.
 */

import { VERDICT_ORDER, type CrossingVerdict } from '../lib/crossing.ts';

export interface VerdictMeta {
  /** The verdict as we write it. */
  label: string;
  /** A short form for axis ticks and tight columns. */
  short: string;
  /** The colour, used for the swatch and the text. */
  color: string;
  /** One line: what the verdict means. */
  meaning: string;
}

export const VERDICT_META: Record<CrossingVerdict, VerdictMeta> = {
  capturable: {
    label: 'capturable',
    short: 'capturable',
    color: '#35d6a4',
    meaning: 'the spread is larger than the cost of executing it — the round trip clears its own friction',
  },
  'not-capturable': {
    label: 'not capturable',
    short: 'not capt.',
    color: '#f2b544',
    meaning: 'the spread is real, and it is smaller than the cost of executing it',
  },
  'not-distinguishable': {
    label: 'not distinguishable',
    short: 'indistinct',
    color: '#8b93a1',
    meaning: 'the two prices are not distinguishable — the difference is noise or a stale print',
  },
  'dead-side': {
    label: 'dead side',
    short: 'dead side',
    color: '#ff6b6b',
    meaning: 'one side cannot be traded at all, so there is no round trip to price',
  },
  unpriceable: {
    label: 'unpriceable',
    short: 'unpriceable',
    color: '#b18cff',
    meaning: 'we cannot price the execution — no priced pool, or the two sides sit on different chains',
  },
};

export { VERDICT_ORDER };

/** The accent. One colour, used for anything that is not a verdict. */
export const ACCENT = '#4cc2ff';

export const SEVERITY_LABEL: Record<1 | 2 | 3, string> = {
  3: 'blocks the product',
  2: 'material defect',
  1: 'cosmetic',
};

export const SEVERITY_SHORT: Record<1 | 2 | 3, string> = {
  3: 'severity 3',
  2: 'severity 2',
  1: 'severity 1',
};
