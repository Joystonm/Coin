/**
 * The time-series arm.
 *
 * `parity.ts` measures dispersion *across* wrappers right now — the
 * cross-sectional noise floor. This module measures dispersion *through time* —
 * the sequential noise floor — from CoinMarketCap's own historical RWA quotes.
 *
 * They answer different questions and they can disagree, which is the point:
 *
 *   cross-sectional: "how far apart do these wrappers normally sit?"
 *   time-series:     "how much does this asset's tokenized price move on its own?"
 *
 * A cross-sectional gap that is large compared with the peers' normal spread,
 * but small compared with the asset's own daily movement, is a gap you would
 * be trading noise into.
 *
 * There is a second, sharper use. CoinMarketCap's historical endpoint reports
 * the *aggregate* tokenized price for an asset, not per-wrapper prices. So when
 * the aggregate series has been pinned to a level for thirty days and the
 * wrappers now disagree, the disagreement is *new* — it opened recently. That
 * is the difference between a structural difference (two share classes that
 * will never converge) and an event (something changed today).
 *
 * Pure: no clock, no network, no globals.
 */

import { median, percentile, stdev } from './stats.ts';

/** One point in an asset's tokenized price history. */
export interface HistoryPoint {
  /** ISO-8601 UTC timestamp, the start of the interval period. */
  timestamp: string;
  /** CoinMarketCap's aggregate tokenized price for the asset. */
  price: number | null;
  tokenizedMarketCap: number | null;
  tokenizedVolume24h: number | null;
}

/** One asset's history. */
export interface AssetHistory {
  rwaId: number | null;
  symbol: string;
  name: string;
  slug: string | null;
  assetType: string | null;
  points: HistoryPoint[];
}

export interface HistoryStats {
  /** How many points carry a usable price. */
  observations: number;
  /** Oldest and newest point with a price. */
  from: string | null;
  to: string | null;
  /** Median price over the window. */
  medianPrice: number | null;
  /** Median absolute day-over-day move, in basis points. */
  medianAbsMoveBps: number | null;
  /** 95th percentile absolute day-over-day move, in basis points. */
  p95AbsMoveBps: number | null;
  /** Largest absolute day-over-day move, in basis points. */
  maxAbsMoveBps: number | null;
  /** Standard deviation of daily returns, in basis points. */
  dailyStdevBps: number | null;
  /** Total change across the window, in basis points. */
  totalMoveBps: number | null;
  /**
   * True when there are too few points for the statistics to mean anything.
   * A median over four observations is not a median.
   */
  thin: boolean;
}

/** Below this many observations we refuse to call a series a history. */
export const MIN_HISTORY_POINTS = 8;

/**
 * Below this many days at one level, we do not call the level a level.
 *
 * A series that moved yesterday and the day before that has not been holding a
 * price; it has been drifting. Treating a one-day drift as a "breakout" would
 * be a story about noise.
 */
export const MIN_STABLE_DAYS = 3;

/**
 * Day-over-day moves in basis points.
 *
 * Only consecutive points that both carry a price count, and a gap of more
 * than three days between them is skipped: a move across a weekend or a halt
 * is not a daily move and would inflate the volatility.
 */
export function dailyMovesBps(points: readonly HistoryPoint[]): number[] {
  const moves: number[] = [];
  let previous: { price: number; at: number } | null = null;

  for (const point of points) {
    if (point.price == null || !Number.isFinite(point.price) || point.price <= 0) continue;
    const at = Date.parse(point.timestamp);
    if (!Number.isFinite(at)) continue;
    if (previous) {
      const gapMs = at - previous.at;
      const days = gapMs / 86_400_000;
      if (days > 0 && days <= 3.5) {
        moves.push((point.price / previous.price - 1) * 10_000);
      }
    }
    previous = { price: point.price, at };
  }
  return moves;
}

/**
 * Summarise a price series.
 *
 * Everything that cannot be measured is null, and `thin` says so out loud.
 */
export function summariseHistory(points: readonly HistoryPoint[]): HistoryStats {
  const priced = points.filter(
    (p): p is HistoryPoint & { price: number } =>
      p.price != null && Number.isFinite(p.price) && p.price > 0,
  );
  const moves = dailyMovesBps(points);
  const absMoves = moves.map(Math.abs);

  const first = priced[0];
  const last = priced[priced.length - 1];

  return {
    observations: priced.length,
    from: first?.timestamp ?? null,
    to: last?.timestamp ?? null,
    medianPrice: median(priced.map((p) => p.price)),
    medianAbsMoveBps: median(absMoves),
    p95AbsMoveBps: percentile(absMoves, 95),
    maxAbsMoveBps: absMoves.length ? Math.max(...absMoves) : null,
    dailyStdevBps: stdev(moves),
    totalMoveBps:
      first && last ? (last.price / first.price - 1) * 10_000 : null,
    thin: priced.length < MIN_HISTORY_POINTS,
  };
}

/**
 * Where does today's anchor sit against the asset's own history?
 *
 * `percentile` is the share of historical prices below `value`. A value at the
 * 50th percentile is ordinary; one at the 100th is new.
 */
export function positionInHistory(
  value: number | null,
  points: readonly HistoryPoint[],
): { percentile: number | null; vsMedianBps: number | null; n: number } {
  const prices = points
    .map((p) => p.price)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (value == null || prices.length < 2) {
    return { percentile: null, vsMedianBps: null, n: prices.length };
  }
  const below = prices.filter((p) => p <= value).length;
  const med = median(prices);
  return {
    percentile: (below / prices.length) * 100,
    vsMedianBps: med == null ? null : (value / med - 1) * 10_000,
    n: prices.length,
  };
}

/**
 * Is a cross-sectional gap ordinary for this asset?
 *
 * The gap is measured against the asset's own daily movement: a 40 bps gap on
 * a token that moves 30 bps a day is a real dislocation; the same gap on a
 * token that moves 400 bps a day is not something you could capture before the
 * price moved against you.
 *
 * Returns null when the history is too thin to say. Absent history is not
 * evidence of safety.
 */
export function gapVsOwnVolatility(
  gapBps: number | null,
  stats: HistoryStats,
): { ordinary: boolean | null; ratio: number | null; basis: string } {
  if (gapBps == null) {
    return { ordinary: null, ratio: null, basis: 'no gap to compare' };
  }
  const floor = stats.medianAbsMoveBps;
  if (stats.thin || floor == null) {
    return {
      ordinary: null,
      ratio: null,
      basis: `the asset's own history is too thin to compare against (${stats.observations} observations)`,
    };
  }
  const ratio = gapBps / floor;
  return {
    ordinary: ratio < 1,
    ratio,
    basis:
      `the asset's own tokenized price moves a median of ${floor.toFixed(1)} bps a day, ` +
      `so a ${gapBps.toFixed(1)} bps gap is ${ratio.toFixed(2)}x a normal day's move`,
  };
}

/**
 * How long has the aggregate price been holding its level?
 *
 * A long flat stretch followed by a move means the move is new. This is the
 * "when did this open?" signal, and it is the reason the history endpoint is
 * worth a call.
 *
 * A move out of a level that was never held is not a breakout. A series that
 * has drifted every day for a month has no level to break out of, and calling
 * that a breakout would be a story about noise. So a breakout needs three
 * things at once:
 *
 *   1. the observations before the last one sat on a tight level,
 *   2. that level was held for at least a few days, and
 *   3. the last move is more than twice the series' own daily noise.
 */
export function stabilityOfSeries(points: readonly HistoryPoint[]): {
  flatStreakDays: number | null;
  brokeOut: boolean | null;
  note: string;
} {
  const priced = points
    .filter((p): p is HistoryPoint & { price: number } => p.price != null && p.price > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (priced.length < MIN_HISTORY_POINTS) {
    return {
      flatStreakDays: null,
      brokeOut: false,
      note: 'not enough history to say whether the price level is stable',
    };
  }
  const med = median(priced.map((p) => p.price));
  if (med == null || med <= 0) {
    return { flatStreakDays: null, brokeOut: null, note: 'no median price to compare against' };
  }
  // The series' own noise floor: one median daily move, never tighter than 5 bps.
  const moves = dailyMovesBps(priced);
  const floor = Math.max(median(moves.map(Math.abs)) ?? 0, 5);

  const inside = priced.map((p) => Math.abs((p.price / med - 1) * 10_000) <= floor);

  // How many trailing observations sit inside the floor.
  let trailing = 0;
  for (let i = inside.length - 1; i >= 0 && inside[i]; i--) trailing += 1;

  // The level before the last observation, and how tightly it was held.
  const preBreak = priced.slice(0, -1);
  const level = median(preBreak.map((p) => p.price));
  const dispersion =
    level == null || level <= 0
      ? null
      : (median(preBreak.map((p) => Math.abs((p.price / level - 1) * 10_000))) ?? 0);
  const secondLast = preBreak[preBreak.length - 1];
  const last = priced[priced.length - 1];
  const lastMoveBps =
    secondLast && last && secondLast.price > 0
      ? (last.price / secondLast.price - 1) * 10_000
      : null;

  const brokeOut =
    preBreak.length >= MIN_STABLE_DAYS &&
    dispersion != null &&
    dispersion <= floor &&
    lastMoveBps != null &&
    Math.abs(lastMoveBps) > 2 * floor;

  if (brokeOut) {
    return {
      flatStreakDays: preBreak.length,
      brokeOut: true,
      note:
        `the aggregate price broke out of a level it had held for ${preBreak.length} ` +
        `day${preBreak.length === 1 ? '' : 's'}`,
    };
  }

  return {
    flatStreakDays: trailing,
    brokeOut: false,
    note:
      trailing === 0
        ? `the aggregate price has not held a level inside a ${floor.toFixed(1)} bps band`
        : trailing === priced.length
          ? `the aggregate price has held within ${floor.toFixed(1)} bps of its level for the whole ${priced.length}-day window`
          : `the aggregate price has stayed inside a ${floor.toFixed(1)} bps band for the last ${trailing} of ${priced.length} days`,
  };
}
