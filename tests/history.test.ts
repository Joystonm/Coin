/**
 * The time-series arm.
 *
 * CoinMarketCap's historical endpoint reports the *aggregate* tokenized price
 * for an asset, not per-wrapper prices. So this arm cannot tell you which
 * wrapper moved — it tells you how much the asset moves on its own, and
 * whether today's level is new.
 */

import { describe, expect, it } from 'vitest';
import {
  dailyMovesBps,
  gapVsOwnVolatility,
  MIN_HISTORY_POINTS,
  positionInHistory,
  stabilityOfSeries,
  summariseHistory,
  type HistoryPoint,
} from '../src/lib/history.ts';

function series(prices: (number | null)[]): HistoryPoint[] {
  return prices.map((price, i) => ({
    timestamp: new Date(Date.parse('2026-11-01T00:00:00.000Z') + i * 86_400_000).toISOString(),
    price,
    tokenizedMarketCap: null,
    tokenizedVolume24h: null,
  }));
}

describe('dailyMovesBps', () => {
  it('measures the move between consecutive points', () => {
    const moves = dailyMovesBps(series([100, 101]));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toBeCloseTo(100, 6);
  });

  it('skips points with no price', () => {
    const moves = dailyMovesBps(series([100, null, 102]));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toBeCloseTo(200, 6);
  });

  it('does not treat a long gap as a daily move', () => {
    // A four-day hole is a weekend plus a halt, not a daily move.
    const points = [
      { timestamp: '2026-11-01T00:00:00.000Z', price: 100, tokenizedMarketCap: null, tokenizedVolume24h: null },
      { timestamp: '2026-11-05T00:00:00.000Z', price: 110, tokenizedMarketCap: null, tokenizedVolume24h: null },
    ];
    expect(dailyMovesBps(points)).toHaveLength(0);
  });
});

describe('summariseHistory', () => {
  it('summarises a flat series as flat', () => {
    const stats = summariseHistory(series(Array.from({ length: 20 }, () => 100)));
    expect(stats.observations).toBe(20);
    expect(stats.medianAbsMoveBps).toBeCloseTo(0, 6);
    expect(stats.maxAbsMoveBps).toBeCloseTo(0, 6);
    expect(stats.thin).toBe(false);
  });

  it('measures a volatile series', () => {
    const stats = summariseHistory(series([100, 102, 100, 102, 100, 102, 100, 102, 100, 102]));
    expect(stats.medianAbsMoveBps).toBeCloseTo(200, 6);
    expect(stats.maxAbsMoveBps).toBeCloseTo(200, 6);
  });

  it('calls a short series thin', () => {
    const stats = summariseHistory(series([100, 101, 102]));
    expect(stats.thin).toBe(true);
    expect(stats.observations).toBeLessThan(MIN_HISTORY_POINTS);
  });

  it('reports no statistics for an empty series', () => {
    const stats = summariseHistory([]);
    expect(stats.observations).toBe(0);
    expect(stats.medianPrice).toBeNull();
    expect(stats.medianAbsMoveBps).toBeNull();
    expect(stats.totalMoveBps).toBeNull();
  });
});

describe('positionInHistory', () => {
  it('places a value against the historical range', () => {
    const points = series([100, 100, 100, 100, 200]);
    const position = positionInHistory(200, points);
    expect(position.percentile).toBe(100);
    expect(position.n).toBe(5);
  });

  it('has nothing to say with too few points', () => {
    expect(positionInHistory(100, series([100])).percentile).toBeNull();
  });
});

describe('gapVsOwnVolatility', () => {
  const stats = summariseHistory(series(Array.from({ length: 20 }, (_, i) => 100 + (i % 2) * 4)));

  it('calls a gap smaller than a normal day ordinary', () => {
    const result = gapVsOwnVolatility(50, stats);
    expect(result.ordinary).toBe(true);
    expect(result.ratio).not.toBeNull();
  });

  it('calls a gap larger than a normal day unusual', () => {
    expect(gapVsOwnVolatility(5000, stats).ordinary).toBe(false);
  });

  it('refuses to judge when the history is thin', () => {
    const thin = summariseHistory(series([100, 101]));
    const result = gapVsOwnVolatility(50, thin);
    expect(result.ordinary).toBeNull();
    expect(result.basis).toMatch(/too thin/);
  });

  it('refuses to judge when there is no gap', () => {
    expect(gapVsOwnVolatility(null, stats).ordinary).toBeNull();
  });
});

describe('stabilityOfSeries', () => {
  it('finds a long flat stretch', () => {
    const result = stabilityOfSeries(series(Array.from({ length: 20 }, () => 100)));
    expect(result.flatStreakDays).toBe(20);
    expect(result.brokeOut).toBe(false);
    expect(result.note).toMatch(/held within/);
  });

  it('notices a breakout', () => {
    const points = series([...Array.from({ length: 19 }, () => 100), 150]);
    const result = stabilityOfSeries(points);
    expect(result.brokeOut).toBe(true);
    expect(result.flatStreakDays).toBe(19);
    expect(result.note).toMatch(/broke out/);
  });

  it('does not call a drift a breakout', () => {
    // A series that drifts by the same amount every day has no level to break
    // out of, and its last move is not bigger than its own noise.
    const points = series([100, 102, 101, 103, 102, 104, 103, 105, 104, 106]);
    const result = stabilityOfSeries(points);
    expect(result.brokeOut).toBe(false);
    expect(result.note).not.toMatch(/broke out/);
  });

  it('does not call a breakout when the level was never tight', () => {
    // The last move here is large, but the series was too scattered for there
    // to have been a level to leave.
    const points = series([100, 104, 99, 106, 101, 108, 97, 110, 103, 112]);
    const result = stabilityOfSeries(points);
    expect(result.brokeOut).toBe(false);
    expect(result.note).not.toMatch(/broke out/);
  });

  it('says nothing when the series is too short', () => {
    const result = stabilityOfSeries(series([100, 101, 102]));
    expect(result.flatStreakDays).toBeNull();
    expect(result.note).toMatch(/too little|not enough/i);
  });
});
