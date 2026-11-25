/**
 * Execution.
 *
 * The whole product turns on one question: can you actually get the price, and
 * what does crossing it cost? These tests pin down the arithmetic and, more
 * importantly, the refusals — a missing liquidity figure must stay missing.
 */

import { describe, expect, it } from 'vitest';
import {
  assessDepth,
  daysToExit,
  DORMANT_AFTER_MS,
  freshnessOf,
  priceImpactBps,
  roundTripImpactBps,
  STALE_AFTER_MS,
} from '../src/lib/depth.ts';
import type { Pool, TokenQuote } from '../src/lib/types.ts';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');

function quote(overrides: Partial<TokenQuote> = {}): TokenQuote {
  return {
    cryptoId: 1,
    symbol: 'T',
    name: 'Test',
    price: 100,
    volume24h: 1_000_000,
    marketCap: 10_000_000,
    lastUpdated: new Date(NOW - 60_000).toISOString(),
    percentChange24h: 0.1,
    isStale: false,
    ...overrides,
  };
}

function pool(overrides: Partial<Pool> = {}): Pool {
  return {
    poolAddress: '0xabc',
    dexName: 'uniswap-v3',
    platform: 'Ethereum',
    liquidityUsd: 10_000_000,
    baseTokenSymbol: 'T',
    quoteTokenSymbol: 'USDC',
    volume24h: 500_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'dex/pairs/quotes/latest',
    ...overrides,
  };
}

describe('priceImpactBps', () => {
  it('prices a trade as size over liquidity plus size', () => {
    // 100k into 10M: 100k / 10.1M = 0.9901% = 99.01 bps
    expect(priceImpactBps(100_000, 10_000_000)).toBeCloseTo(99.01, 1);
  });

  it('is larger in a shallower pool', () => {
    const deep = priceImpactBps(100_000, 10_000_000) as number;
    const shallow = priceImpactBps(100_000, 1_000_000) as number;
    expect(shallow).toBeGreaterThan(deep);
  });

  it('refuses to price against a pool with no liquidity', () => {
    expect(priceImpactBps(100_000, 0)).toBeNull();
    expect(priceImpactBps(100_000, -5)).toBeNull();
  });

  it('refuses to price a size that is not a number', () => {
    expect(priceImpactBps(Number.NaN, 1_000_000)).toBeNull();
    expect(priceImpactBps(100_000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('costs nothing to trade nothing', () => {
    expect(priceImpactBps(0, 1_000_000)).toBe(0);
  });
});

describe('roundTripImpactBps', () => {
  it('pays the impact twice', () => {
    expect(roundTripImpactBps(100_000, 10_000_000)).toBeCloseTo((priceImpactBps(100_000, 10_000_000) as number) * 2, 6);
  });

  it('is unknown when the liquidity is unknown', () => {
    expect(roundTripImpactBps(100_000, null)).toBeNull();
  });
});

describe('daysToExit', () => {
  it('divides the size by the daily volume', () => {
    expect(daysToExit(100_000, 1_000_000)).toBeCloseTo(0.1, 6);
  });

  it('is unknown when there is no volume to exit into', () => {
    expect(daysToExit(100_000, null)).toBeNull();
    expect(daysToExit(100_000, 0)).toBeNull();
  });
});

describe('freshnessOf', () => {
  it('calls a recent quote live', () => {
    const { freshness } = freshnessOf(quote(), NOW);
    expect(freshness).toBe('live');
  });

  it('calls a quote older than a day stale', () => {
    const { freshness } = freshnessOf(quote({ lastUpdated: new Date(NOW - STALE_AFTER_MS - 1000).toISOString() }), NOW);
    expect(freshness).toBe('stale');
  });

  it('calls a quote older than a week dormant', () => {
    const { freshness } = freshnessOf(quote({ lastUpdated: new Date(NOW - DORMANT_AFTER_MS - 1000).toISOString() }), NOW);
    expect(freshness).toBe('dormant');
  });

  it('cannot judge a quote with no timestamp', () => {
    expect(freshnessOf(quote({ lastUpdated: null }), NOW).freshness).toBe('unknown');
    expect(freshnessOf(undefined, NOW).freshness).toBe('unknown');
  });
});

describe('assessDepth', () => {
  const options = { sizeUsd: 100_000, now: NOW };

  it('calls a deep, live, liquid wrapper tradeable', () => {
    // $100M of liquidity against a $100k position: a 20 bps round trip.
    const depth = assessDepth(1, 'T', quote(), [pool({ liquidityUsd: 100_000_000 })], options);
    expect(depth.tradeability).toBe('tradeable');
    expect(depth.poolLiquidityUsd).toBe(100_000_000);
    expect(depth.roundTripImpactBps).toBeCloseTo(19.98, 1);
    expect(depth.priceStale).toBe(false);
  });

  it('calls a wrapper thin once the round trip costs a percent', () => {
    // $10M against a $100k position: a 198 bps round trip, which is thin.
    const depth = assessDepth(1, 'T', quote(), [pool({ liquidityUsd: 10_000_000 })], options);
    expect(depth.tradeability).toBe('thin');
    expect(depth.roundTripImpactBps).toBeCloseTo(198.02, 1);
  });

  it('refuses to call a wrapper tradeable when CMC lists no pool for it', () => {
    const depth = assessDepth(1, 'T', quote(), [], options);
    expect(depth.tradeability).toBe('unknown');
    expect(depth.poolLiquidityUsd).toBeNull();
    expect(depth.roundTripImpactBps).toBeNull();
    expect(depth.unknownBecause).toMatch(/Absence of a pool is not evidence of illiquidity/);
  });

  it('calls a wrapper not-tradeable when the pool is shallower than the position', () => {
    const depth = assessDepth(1, 'T', quote(), [pool({ liquidityUsd: 50_000 })], options);
    expect(depth.tradeability).toBe('not-tradeable');
    expect(depth.unknownBecause).toMatch(/less than the/);
  });

  it('calls a wrapper thin when the round trip costs more than a percent', () => {
    const depth = assessDepth(1, 'T', quote(), [pool({ liquidityUsd: 1_000_000 })], options);
    expect(depth.tradeability).toBe('thin');
  });

  it('is unknown when the pools have no priced liquidity', () => {
    const depth = assessDepth(1, 'T', quote(), [pool({ liquidityUsd: null })], options);
    expect(depth.tradeability).toBe('unknown');
    expect(depth.unknownBecause).toMatch(/no USD liquidity/);
  });

  it('marks a stale price as stale however deep the pool is', () => {
    const depth = assessDepth(
      1,
      'T',
      quote({ lastUpdated: new Date(NOW - 3 * 86_400_000).toISOString() }),
      [pool()],
      options,
    );
    expect(depth.priceStale).toBe(true);
    expect(depth.freshness).toBe('stale');
    // The liquidity is still measured — staleness and depth are separate axes.
    expect(depth.poolLiquidityUsd).toBe(10_000_000);
  });

  it('adds up the liquidity across every pool it can price', () => {
    const depth = assessDepth(
      1,
      'T',
      quote(),
      [pool({ liquidityUsd: 4_000_000 }), pool({ liquidityUsd: 6_000_000, poolAddress: '0xdef' })],
      options,
    );
    expect(depth.poolLiquidityUsd).toBe(10_000_000);
  });
});
