/**
 * Hand-rolled statistics.
 *
 * No stats dependency: every function here is pure, total, and unit-tested, and
 * the numbers it produces are the numbers the product ships.
 */

/** Median of a numeric list. Returns null for an empty list. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Linear-interpolated percentile, `p` in [0, 100].
 * Matches the common spreadsheet definition (PERCENTILE.INC).
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo] as number;
  const w = rank - lo;
  return (sorted[lo] as number) * (1 - w) + (sorted[hi] as number) * w;
}

/** Volume-weighted mean. Returns null when there is nothing to weight. */
export function volumeWeightedMean(
  rows: readonly { value: number; weight: number }[],
): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.value) || !Number.isFinite(r.weight) || r.weight < 0) continue;
    num += r.value * r.weight;
    den += r.weight;
  }
  if (den === 0) return null;
  return num / den;
}

/** Arithmetic mean, or null for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Population standard deviation. */
export function stdev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  if (m == null) return null;
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return Math.sqrt(acc / (values.length - 1));
}

/** Least-squares fit of y on x, with correlation and R². */
export interface Fit {
  n: number;
  slope: number | null;
  intercept: number | null;
  correlation: number | null;
  r2: number | null;
}

export function fit(xs: readonly number[], ys: readonly number[]): Fit {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { n, slope: null, intercept: null, correlation: null, r2: null };
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i] as number;
    my += ys[i] as number;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? null : sxy / sxx;
  const correlation = sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
  return {
    n,
    slope,
    intercept: slope == null ? null : my - slope * mx,
    correlation,
    r2: correlation == null ? null : correlation * correlation,
  };
}

/** Clamp a value into [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Round to `dp` decimal places, returning null for null. */
export function round(value: number | null, dp = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
