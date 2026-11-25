/**
 * The verdict.
 *
 * Five states, and the discipline that keeps them apart:
 *
 *   capturable           the spread beats its own friction
 *   not-capturable       the spread is real but smaller than the friction
 *   not-distinguishable  the two prices are not two prices
 *   dead-side            one side cannot be traded at the quoted price
 *   unpriceable          we cannot measure the execution
 *
 * The last three are not failures. They are the answer, and a product that
 * rounds them into "no" is a product that lies.
 */

import { describe, expect, it } from 'vitest';
import { judgeCrossing, cheapestReachable, noiseFloorBps, summariseCrossings } from '../src/lib/crossing.ts';
import type { DepthAssessment } from '../src/lib/depth.ts';
import type { ParityRow } from '../src/lib/parity.ts';
import type { Wrapper } from '../src/lib/types.ts';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');

function wrapper(overrides: Partial<Wrapper> & { cryptoId: number; symbol: string }): Wrapper {
  return {
    name: overrides.symbol,
    issuerId: 'issuer-a',
    issuerName: 'Issuer A',
    price: 100,
    marketCap: 1_000_000,
    volume24h: 1_000_000,
    ...overrides,
  };
}

function row(overrides: Partial<ParityRow> & { wrapper: Wrapper }): ParityRow {
  return {
    status: 'ok',
    normalizedPrice: overrides.wrapper.price ?? 100,
    unit: null,
    unitRatio: null,
    unexplainedRatio: false,
    offPeg: false,
    eligible: true,
    excludedBecause: null,
    deviationBps: 0,
    peerDeviationBps: 0,
    volumeShare: 0.5,
    setsAnchor: false,
    ...overrides,
  };
}

function depth(overrides: Partial<DepthAssessment> & { cryptoId: number; symbol: string }): DepthAssessment {
  return {
    freshness: 'live',
    quoteAgeMs: 60_000,
    quoteUpdatedAt: new Date(NOW - 60_000).toISOString(),
    priceStale: false,
    poolLiquidityUsd: 10_000_000,
    volume24h: 1_000_000,
    daysToExit: 0.1,
    roundTripImpactBps: 198.02,
    tradeability: 'tradeable',
    unknownBecause: null,
    pools: [],
    ...overrides,
  };
}

const cheap = row({ wrapper: wrapper({ cryptoId: 1, symbol: 'CHEAP', price: 99 }) });
const rich = row({ wrapper: wrapper({ cryptoId: 2, symbol: 'RICH', price: 101, issuerId: 'issuer-b', issuerName: 'Issuer B' }) });
const peers = [cheap, rich];

describe('judgeCrossing', () => {
  it('calls a wide, cheap-to-trade spread capturable', () => {
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      cheap,
      rich,
      depth({ cryptoId: 1, symbol: 'CHEAP' }),
      depth({ cryptoId: 2, symbol: 'RICH' }),
      peers,
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.verdict).toBe('capturable');
    expect(crossing.spreadBps).toBeCloseTo(202.02, 1);
    expect(crossing.costBps).toBeCloseTo(198.02, 1);
    expect(crossing.netBps).toBeGreaterThan(0);
    expect(crossing.reasons.join(' ')).toMatch(/clears/);
  });

  it('calls a spread smaller than its friction not-capturable, and says by how much', () => {
    const slightlyCheap = row({ wrapper: wrapper({ cryptoId: 1, symbol: 'CHEAP', price: 99.95 }) });
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      slightlyCheap,
      rich,
      depth({ cryptoId: 1, symbol: 'CHEAP' }),
      depth({ cryptoId: 2, symbol: 'RICH' }),
      [slightlyCheap, rich],
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.verdict).toBe('not-capturable');
    expect(crossing.netBps).toBeLessThan(0);
    expect(crossing.reasons.join(' ')).toMatch(/short by/);
  });

  it('calls a gap inside the noise floor not-distinguishable', () => {
    const a = row({ wrapper: wrapper({ cryptoId: 1, symbol: 'A', price: 100 }) });
    const b = row({ wrapper: wrapper({ cryptoId: 2, symbol: 'B', price: 100.02 }) });
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      a,
      b,
      depth({ cryptoId: 1, symbol: 'A' }),
      depth({ cryptoId: 2, symbol: 'B' }),
      [a, b],
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.verdict).toBe('not-distinguishable');
    expect(crossing.reasons.join(' ')).toMatch(/not distinguishable/);
  });

  it('refuses to call a stale print a spread', () => {
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      cheap,
      rich,
      depth({ cryptoId: 1, symbol: 'CHEAP', priceStale: true, freshness: 'stale', quoteAgeMs: 3 * 86_400_000 }),
      depth({ cryptoId: 2, symbol: 'RICH' }),
      peers,
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.verdict).toBe('not-distinguishable');
    expect(crossing.reasons.join(' ')).toMatch(/may no longer exist/);
  });

  it('calls a side with no volume a dead side, not an arbitrage', () => {
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      cheap,
      rich,
      depth({ cryptoId: 1, symbol: 'CHEAP', tradeability: 'not-tradeable', volume24h: 0, unknownBecause: 'no 24h volume' }),
      depth({ cryptoId: 2, symbol: 'RICH' }),
      peers,
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.verdict).toBe('dead-side');
    expect(crossing.reasons.join(' ')).toMatch(/not an arbitrage/);
  });

  it('refuses to price a side CMC has no pool for', () => {
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      cheap,
      rich,
      depth({ cryptoId: 1, symbol: 'CHEAP', poolLiquidityUsd: null, roundTripImpactBps: null, tradeability: 'unknown' }),
      depth({ cryptoId: 2, symbol: 'RICH' }),
      peers,
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.verdict).toBe('unpriceable');
    expect(crossing.costBps).toBeNull();
    expect(crossing.netBps).toBeNull();
    expect(crossing.reasons.join(' ')).toMatch(/not evidence of a free trade/);
  });

  it('refuses to price a trade between two chains', () => {
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      cheap,
      rich,
      depth({ cryptoId: 1, symbol: 'CHEAP', pools: [{ poolAddress: '0x1', dexName: 'uniswap', platform: 'Ethereum', liquidityUsd: 10_000_000, baseTokenSymbol: 'CHEAP', quoteTokenSymbol: 'USDC', volume24h: 1_000_000, createdAt: null, source: 'dex/pairs/quotes/latest' }] }),
      depth({ cryptoId: 2, symbol: 'RICH', pools: [{ poolAddress: '0x2', dexName: 'uniswap', platform: 'Polygon', liquidityUsd: 10_000_000, baseTokenSymbol: 'RICH', quoteTokenSymbol: 'USDC', volume24h: 1_000_000, createdAt: null, source: 'dex/pairs/quotes/latest' }] }),
      peers,
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.verdict).toBe('unpriceable');
    expect(crossing.chainMismatch).toBe(true);
    expect(crossing.reasons.join(' ')).toMatch(/bridge/);
  });

  it('refuses to compare a pair where one side has no price', () => {
    const noPrice = row({ wrapper: wrapper({ cryptoId: 3, symbol: 'NOPRICE', price: null }), normalizedPrice: null, deviationBps: null });
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      noPrice,
      rich,
      null,
      depth({ cryptoId: 2, symbol: 'RICH' }),
      [noPrice, rich],
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.verdict).toBe('not-distinguishable');
    expect(crossing.spreadBps).toBeNull();
  });

  it('flags that the two wrappers need a redemption, not a swap', () => {
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      cheap,
      rich,
      depth({ cryptoId: 1, symbol: 'CHEAP' }),
      depth({ cryptoId: 2, symbol: 'RICH' }),
      peers,
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.issuerMismatch).toBe(true);
    expect(crossing.reasons.join(' ')).toMatch(/redemption rather than a swap/);
  });

  it('says when the gap is smaller than the asset own daily movement', () => {
    const a = row({ wrapper: wrapper({ cryptoId: 1, symbol: 'A', price: 100 }) });
    const b = row({ wrapper: wrapper({ cryptoId: 2, symbol: 'B', price: 101 }) });
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      a,
      b,
      depth({ cryptoId: 1, symbol: 'A', poolLiquidityUsd: 100_000_000 }),
      depth({ cryptoId: 2, symbol: 'B', poolLiquidityUsd: 100_000_000 }),
      [a, b],
      {
        sizeUsd: 100_000,
        now: NOW,
        history: {
          observations: 30,
          from: '2026-10-26T00:00:00.000Z',
          to: '2026-11-24T00:00:00.000Z',
          medianPrice: 100,
          medianAbsMoveBps: 150,
          p95AbsMoveBps: 300,
          maxAbsMoveBps: 400,
          dailyStdevBps: 120,
          totalMoveBps: 50,
          thin: false,
        },
      },
    );
    expect(crossing.verdict).toBe('capturable');
    expect(crossing.reasons.join(' ')).toMatch(/smaller than the asset's own daily movement/);
  });

  it('says nothing about volatility when there is no history', () => {
    const a = row({ wrapper: wrapper({ cryptoId: 1, symbol: 'A', price: 100 }) });
    const b = row({ wrapper: wrapper({ cryptoId: 2, symbol: 'B', price: 101 }) });
    const crossing = judgeCrossing(
      'TEST',
      'Test',
      a,
      b,
      depth({ cryptoId: 1, symbol: 'A' }),
      depth({ cryptoId: 2, symbol: 'B' }),
      [a, b],
      { sizeUsd: 100_000, now: NOW },
    );
    expect(crossing.reasons.join(' ')).not.toMatch(/daily movement/);
  });
});

describe('noiseFloorBps', () => {
  it('measures the dispersion of the peers, excluding the pair under test', () => {
    const a = row({ wrapper: wrapper({ cryptoId: 1, symbol: 'A' }), deviationBps: -50 });
    const b = row({ wrapper: wrapper({ cryptoId: 2, symbol: 'B' }), deviationBps: 50 });
    const c = row({ wrapper: wrapper({ cryptoId: 3, symbol: 'C' }), deviationBps: 10 });
    // Excluding A and B leaves C alone, so the floor is C's dispersion.
    expect(noiseFloorBps([a, b, c], [1, 2])).toBeCloseTo(10, 6);
  });
});

describe('cheapestReachable', () => {
  it('spots the case where the cheapest on screen is not the cheapest you can buy', () => {
    const a = row({ wrapper: wrapper({ cryptoId: 1, symbol: 'CHEAP' }) , deviationBps: -20 });
    const b = row({ wrapper: wrapper({ cryptoId: 2, symbol: 'BUYABLE' }), deviationBps: -5 });
    const depths = new Map<number, DepthAssessment>([
      [1, depth({ cryptoId: 1, symbol: 'CHEAP', tradeability: 'unknown', poolLiquidityUsd: null })],
      [2, depth({ cryptoId: 2, symbol: 'BUYABLE' })],
    ]);
    const result = cheapestReachable([a, b], depths);
    expect(result.trap).toBe(true);
    expect(result.cheapestOnScreen?.wrapper.symbol).toBe('CHEAP');
    expect(result.cheapestReachable?.wrapper.symbol).toBe('BUYABLE');
  });

  it('reports no trap when the cheapest on screen is buyable', () => {
    const a = row({ wrapper: wrapper({ cryptoId: 1, symbol: 'A' }), deviationBps: -20 });
    const depths = new Map<number, DepthAssessment>([[1, depth({ cryptoId: 1, symbol: 'A' })]]);
    const result = cheapestReachable([a], depths);
    expect(result.trap).toBe(false);
  });
});

describe('summariseCrossings', () => {
  it('counts every verdict and reports the capturable share', () => {
    const summary = summariseCrossings([
      { verdict: 'capturable' } as never,
      { verdict: 'capturable' } as never,
      { verdict: 'unpriceable' } as never,
      { verdict: 'unpriceable' } as never,
    ]);
    expect(summary.total).toBe(4);
    expect(summary.byVerdict.capturable).toBe(2);
    expect(summary.capturableShare).toBe(50);
  });

  it('has no capturable share when nothing was judged', () => {
    expect(summariseCrossings([]).capturableShare).toBeNull();
  });
});
