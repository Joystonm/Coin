/**
 * Unit normalisation for tokenised wrappers.
 *
 * CoinMarketCap groups every wrapper of an underlying under one `rwa_id` and
 * quotes each wrapper in whatever unit that wrapper happens to use: gold per gram
 * next to gold per troy ounce, a 10-share token next to a 1-share token, a
 * split-adjusted token next to an unsplit one. Nothing in the payload says so.
 *
 * We detect the multiplier from the price ratio against a robust reference and
 * normalise. We never invent a unit: an unrecognised ratio is reported as an
 * unexplained dislocation, not silently rescaled.
 */

import { median } from './stats.ts';

export type UnitKind = 'share_ratio' | 'mass' | 'decimal' | 'none';

export interface UnitFactor {
  /** Multiply the wrapper price by this to express it in the reference unit. */
  factor: number;
  label: string;
  kind: UnitKind;
}

const SHARE_RATIOS = [2, 3, 4, 5, 10, 20, 25, 50, 100] as const;
const DECIMALS = [10, 100, 1000] as const;

export const UNIT_FACTORS: readonly UnitFactor[] = [
  // Gold and other precious metals: troy ounce (31.1034768 g) and kilogram (32.1507426 oz).
  { factor: 31.1035, label: 'priced per gram (1 troy oz = 31.1035 g)', kind: 'mass' },
  { factor: 1 / 31.1035, label: 'priced per troy ounce', kind: 'mass' },
  { factor: 32.1507, label: 'priced per gram (1 kg = 32.1507 oz)', kind: 'mass' },
  { factor: 1 / 32.1507, label: 'priced per kilogram', kind: 'mass' },
  // Share ratios: a wrapper for N shares trades at N x the price of a 1-share wrapper.
  ...SHARE_RATIOS.map((n) => ({
    factor: 1 / n,
    label: `priced at ${n}x peers (share ratio, e.g. a ${n}-for-1 split)`,
    kind: 'share_ratio' as UnitKind,
  })),
  ...SHARE_RATIOS.map((n) => ({
    factor: n,
    label: `priced at 1/${n} of peers (fractional unit or reverse split)`,
    kind: 'share_ratio' as UnitKind,
  })),
  // Decimal scaling: 0.1x / 10x style quoting.
  ...DECIMALS.map((n) => ({
    factor: 1 / n,
    label: `priced at ${n}x peers (decimal scaling)`,
    kind: 'decimal' as UnitKind,
  })),
  ...DECIMALS.map((n) => ({
    factor: n,
    label: `priced at 1/${n} of peers (decimal scaling)`,
    kind: 'decimal' as UnitKind,
  })),
];

/** A ratio this close to 1 is the same unit, not a unit difference. */
export const SAME_UNIT_TOLERANCE = 0.25;
/** How close to a known factor counts as that factor. */
export const UNIT_MATCH_TOLERANCE = 0.03;

export interface UnitDetection {
  /** Multiply by this to normalise. 1 when no unit difference was detected. */
  factor: number;
  /** The unit that was detected, if any. */
  unit: UnitFactor | null;
  /** The raw price ratio against the reference. */
  ratio: number;
  /** True when the ratio is far from any known factor: an unexplained dislocation. */
  unexplained: boolean;
}

/**
 * Choose the reference price level for an asset's wrappers.
 *
 * The reference is the price the *majority* of the wrappers agree on, in unit
 * terms. A plain median does this well when the unit split is lopsided — one
 * gram-quoted wrapper among six ounce-quoted ones does not move the median —
 * but it fails when the split is close to even, because the median then lands
 * halfway between two units and explains neither.
 *
 * So: find the largest cluster of wrappers whose prices agree within the
 * same-unit tolerance, and take that cluster's median. Clusters are ranked by
 * how many wrappers they contain, with total volume as the tie-break, because
 * the unit most of the market trades in is the unit most of the market quotes.
 */
export function robustReference(
  prices: readonly number[],
  volumes: readonly number[] = [],
): number | null {
  const usable = prices
    .map((p, i) => ({ price: p, volume: volumes[i] ?? 0 }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0);
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0]?.price ?? null;

  let best: { price: number; volume: number }[] = [];
  let bestVolume = -Infinity;

  for (const candidate of usable) {
    const cluster = usable.filter(
      (x) => Math.abs(x.price / candidate.price - 1) <= SAME_UNIT_TOLERANCE,
    );
    const volume = cluster.reduce((s, x) => s + Math.max(0, x.volume), 0);
    if (cluster.length > best.length || (cluster.length === best.length && volume > bestVolume)) {
      best = cluster;
      bestVolume = volume;
    }
  }
  return median(best.map((x) => x.price));
}

/**
 * Detect the unit of `price` relative to `reference`.
 *
 * `reference` should be a robust central price for the asset (we use
 * `robustReference`, which picks the unit the majority of wrappers use) so a
 * single mis-unit wrapper cannot move it.
 */
export function detectUnit(price: number, reference: number): UnitDetection {
  if (!Number.isFinite(price) || !Number.isFinite(reference) || price <= 0 || reference <= 0) {
    return { factor: 1, unit: null, ratio: NaN, unexplained: false };
  }
  const ratio = reference / price;
  if (Math.abs(ratio - 1) <= SAME_UNIT_TOLERANCE) {
    return { factor: 1, unit: null, ratio, unexplained: false };
  }
  const match = UNIT_FACTORS.find((u) => Math.abs(ratio / u.factor - 1) <= UNIT_MATCH_TOLERANCE);
  if (match) {
    return { factor: match.factor, unit: match, ratio, unexplained: false };
  }
  return { factor: 1, unit: null, ratio, unexplained: true };
}

/**
 * A wrapper that sits at a clean integer multiple of its peers is usually a unit
 * difference. A wrapper at a non-clean ratio is usually a bad print.
 *
 * This is the same test, run against an arbitrary ratio rather than the median.
 */
export function looksLikeUnitRatio(ratio: number): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  return UNIT_FACTORS.some((u) => Math.abs(ratio / u.factor - 1) <= UNIT_MATCH_TOLERANCE);
}
