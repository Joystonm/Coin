/**
 * The consensus anchor.
 *
 * The anchor is the number every wrapper is judged against, so it has to be
 * auditable: who voted, who did not, and why. A wrapper that cannot be
 * explained is excluded rather than included and diluted.
 */

import { describe, expect, it } from 'vitest';
import { computeParity, extremes, issuerTrackingError, statusOf, spreadBps } from '../src/lib/parity.ts';
import type { Wrapper } from '../src/lib/types.ts';

function wrapper(overrides: Partial<Wrapper> & { cryptoId: number; symbol: string }): Wrapper {
  return {
    name: overrides.symbol,
    issuerId: 'issuer-1',
    issuerName: 'Issuer One',
    price: 100,
    marketCap: 1_000_000,
    volume24h: 1_000_000,
    ...overrides,
  };
}

describe('statusOf', () => {
  it('rejects a wrapper with no price', () => {
    expect(statusOf({ price: null, volume24h: 100 })).toBe('no-price');
  });

  it('rejects a price that is not a positive number', () => {
    expect(statusOf({ price: 0, volume24h: 100 })).toBe('no-data');
    expect(statusOf({ price: -3, volume24h: 100 })).toBe('no-data');
  });

  it('calls a wrapper with no volume illiquid rather than fine', () => {
    expect(statusOf({ price: 100, volume24h: null })).toBe('no-volume');
    expect(statusOf({ price: 100, volume24h: 1000 })).toBe('illiquid');
  });

  it('accepts a liquid, priced wrapper', () => {
    expect(statusOf({ price: 100, volume24h: 1_000_000 })).toBe('ok');
  });
});

describe('computeParity', () => {
  it('sets a volume-weighted anchor and lets every agreeing wrapper vote', () => {
    const { anchor, anchorMethod, rows } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'A', price: 100, volume24h: 3_000_000 }),
      wrapper({ cryptoId: 2, symbol: 'B', price: 100, volume24h: 1_000_000 }),
    ]);
    expect(anchor).toBeCloseTo(100, 6);
    expect(anchorMethod).toBe('volume-weighted mean');
    expect(rows.every((r) => r.eligible)).toBe(true);
    expect(rows.every((r) => Math.abs(r.deviationBps ?? 0) < 1e-6)).toBe(true);
  });

  it('excludes a wrapper with no price and says why', () => {
    const { rows } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'A' }),
      wrapper({ cryptoId: 2, symbol: 'B', price: null }),
    ]);
    const b = rows.find((r) => r.wrapper.symbol === 'B');
    expect(b?.eligible).toBe(false);
    expect(b?.excludedBecause).toBe('no price reported');
    expect(b?.deviationBps).toBeNull();
  });

  it('excludes a wrapper at an unexplained ratio rather than rescaling it', () => {
    const { rows } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'A' }),
      wrapper({ cryptoId: 2, symbol: 'B' }),
      wrapper({ cryptoId: 3, symbol: 'C', price: 73 }),
    ]);
    const c = rows.find((r) => r.wrapper.symbol === 'C');
    expect(c?.unexplainedRatio).toBe(true);
    expect(c?.eligible).toBe(false);
    expect(c?.excludedBecause).toMatch(/unexplained price ratio/);
  });

  it('flags a wrapper that is far from its peers with no unit to explain it', () => {
    const { rows } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'A' }),
      wrapper({ cryptoId: 2, symbol: 'B' }),
      wrapper({ cryptoId: 3, symbol: 'C', price: 115 }),
    ]);
    const c = rows.find((r) => r.wrapper.symbol === 'C');
    expect(c?.offPeg).toBe(true);
    expect(c?.eligible).toBe(false);
    expect(c?.excludedBecause).toMatch(/off-peg/);
  });

  it('normalises a wrapper quoted in a different unit before comparing it', () => {
    const { rows } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'OZ', price: 3525 }),
      wrapper({ cryptoId: 2, symbol: 'G', price: 3525 / 31.1035 }),
    ]);
    const g = rows.find((r) => r.wrapper.symbol === 'G');
    expect(g?.unit?.kind).toBe('mass');
    expect(g?.normalizedPrice).toBeCloseTo(3525, 2);
    expect(g?.eligible).toBe(true);
  });

  it('scores a wrapper against its peers, not against itself', () => {
    const { rows } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'BIG', price: 100, volume24h: 10_000_000 }),
      wrapper({ cryptoId: 2, symbol: 'SMALL', price: 101, volume24h: 100_000 }),
    ]);
    const big = rows.find((r) => r.wrapper.symbol === 'BIG');
    const small = rows.find((r) => r.wrapper.symbol === 'SMALL');
    // The anchor is volume-weighted, so it sits almost exactly on the big
    // wrapper — its deviation from the anchor is nearly zero.
    expect(big?.deviationBps).toBeCloseTo(-1, 0);
    // But its deviation from the *other* wrappers is measured against a peer
    // set that excludes itself: it is 99 bps away from the only other
    // wrapper, and it cannot be graded by the number it helped produce.
    expect(big?.peerDeviationBps).toBeCloseTo(-99, 0);
    expect(small?.peerDeviationBps).toBeCloseTo(100, 0);
  });

  it('has no anchor when nothing can vote', () => {
    const { anchor, anchorMethod } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'A', price: null }),
    ]);
    expect(anchor).toBeNull();
    expect(anchorMethod).toBe('none');
  });
});

describe('extremes and spread', () => {
  it('finds the cheapest and richest voting wrappers', () => {
    const { rows } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'LO', price: 99 }),
      wrapper({ cryptoId: 2, symbol: 'MID', price: 100 }),
      wrapper({ cryptoId: 3, symbol: 'HI', price: 101 }),
    ]);
    const { cheapest, richest } = extremes(rows);
    expect(cheapest?.wrapper.symbol).toBe('LO');
    expect(richest?.wrapper.symbol).toBe('HI');
    expect(spreadBps(cheapest, richest)).toBeCloseTo(202.02, 1);
  });

  it('has no spread when one side is missing', () => {
    expect(spreadBps(null, null)).toBeNull();
  });
});

describe('issuerTrackingError', () => {
  it('scores an issuer against the consensus of the other wrappers', () => {
    const { rows } = computeParity([
      wrapper({ cryptoId: 1, symbol: 'A', issuerId: 'x', volume24h: 1_000_000 }),
      wrapper({ cryptoId: 2, symbol: 'B', issuerId: 'y', volume24h: 1_000_000 }),
      wrapper({ cryptoId: 3, symbol: 'C', issuerId: 'x', price: 102, volume24h: 1_000_000 }),
    ]);
    const error = issuerTrackingError(rows, 'x');
    expect(error.sample).toBe(2);
    expect(error.medianAbsPeerDeviationBps).not.toBeNull();
  });

  it('has nothing to say about an issuer that is not in the asset', () => {
    const { rows } = computeParity([wrapper({ cryptoId: 1, symbol: 'A' })]);
    const error = issuerTrackingError(rows, 'nobody');
    expect(error.sample).toBe(0);
    expect(error.medianAbsPeerDeviationBps).toBeNull();
  });
});
