/**
 * The execution side: can you actually get the price?
 *
 * Two questions a quote cannot answer:
 *   1. Is this price fresh?  (a wrapper whose own quote has not moved for days
 *      is a price that may not exist any more)
 *   2. Is this price reachable? (is there a pool with enough depth to take the
 *      size you want, and what does crossing it cost you?)
 *
 * Both are measured from CoinMarketCap rows. Where CMC does not tell us, we
 * say "unknown" — we never round an unmeasured thing down to zero.
 */

import type { Pool, TokenQuote } from './types.ts';

/** A quote older than this is treated as stale for trading purposes. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** A quote older than this is treated as dormant. */
export const DORMANT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type Freshness = 'live' | 'stale' | 'dormant' | 'unknown';

export type Tradeability = 'tradeable' | 'thin' | 'unknown' | 'not-tradeable';

export interface DepthAssessment {
  cryptoId: number;
  symbol: string;
  /** How fresh the token's own quote is. */
  freshness: Freshness;
  /** Age of the token's own quote in ms, when known. */
  quoteAgeMs: number | null;
  /** When the token's own quote was struck. */
  quoteUpdatedAt: string | null;
  /** Whether the price we used for this wrapper came from a different, fresher source. */
  priceStale: boolean;
  /** Total USD liquidity across the pools we can price. */
  poolLiquidityUsd: number | null;
  /** 24h volume, from the token's own quote. */
  volume24h: number | null;
  /** Days to sell `sizeUsd` at the reported 24h volume. */
  daysToExit: number | null;
  /** Price impact of a `sizeUsd` buy-and-sell round trip, in bps. */
  roundTripImpactBps: number | null;
  /** Whether we could measure execution at all. */
  tradeability: Tradeability;
  /** Why we could not measure it, in words. */
  unknownBecause: string | null;
  pools: Pool[];
}

export interface DepthOptions {
  /** Notional size of the hypothetical trade, in USD. */
  sizeUsd: number;
  /** Reference time for freshness. Passed in so the function stays pure. */
  now: number;
}

/**
 * Constant-product price impact.
 *
 * For a balanced pool quoted in USD terms, a trade of `size` against `liquidity`
 * moves the execution price by `size / (liquidity + size)`. Round trip (buy then
 * sell) pays it twice.
 *
 * Assumption, stated: balanced pool, no concentrated-liquidity range effects, no
 * gas. For Uniswap v3 pools this is an approximation, and we say so.
 */
export function priceImpactBps(sizeUsd: number, liquidityUsd: number): number | null {
  if (!Number.isFinite(sizeUsd) || !Number.isFinite(liquidityUsd)) return null;
  if (liquidityUsd <= 0) return null;
  if (sizeUsd <= 0) return 0;
  const impact = sizeUsd / (liquidityUsd + sizeUsd);
  return impact * 10_000;
}

/** Round-trip impact: you pay the impact on the way in and on the way out. */
export function roundTripImpactBps(sizeUsd: number, liquidityUsd: number | null): number | null {
  if (liquidityUsd == null) return null;
  const oneWay = priceImpactBps(sizeUsd, liquidityUsd);
  if (oneWay == null) return null;
  return oneWay * 2;
}

/** Days needed to sell `sizeUsd` at `volume24h`. */
export function daysToExit(sizeUsd: number, volume24h: number | null): number | null {
  if (volume24h == null || !Number.isFinite(volume24h) || volume24h <= 0) return null;
  return sizeUsd / volume24h;
}

/** Classify freshness from the age of a token's own quote. */
export function freshnessOf(quote: TokenQuote | undefined, now: number): {
  freshness: Freshness;
  ageMs: number | null;
} {
  if (!quote?.lastUpdated) return { freshness: 'unknown', ageMs: null };
  const ts = Date.parse(quote.lastUpdated);
  if (!Number.isFinite(ts)) return { freshness: 'unknown', ageMs: null };
  const age = now - ts;
  if (age >= DORMANT_AFTER_MS) return { freshness: 'dormant', ageMs: age };
  if (age >= STALE_AFTER_MS) return { freshness: 'stale', ageMs: age };
  return { freshness: 'live', ageMs: age };
}

/**
 * Assess whether a wrapper can actually be traded at the quoted price.
 *
 * Depth comes from DEX pools. When CMC exposes no pool for the token we do not
 * assume the token is illiquid — we record that we could not see its liquidity,
 * which is a different and weaker claim.
 */
export function assessDepth(
  cryptoId: number,
  symbol: string,
  quote: TokenQuote | undefined,
  pools: readonly Pool[],
  options: DepthOptions,
): DepthAssessment {
  const { sizeUsd, now } = options;
  const { freshness, ageMs } = freshnessOf(quote, now);
  const quoteUpdatedAt = quote?.lastUpdated ?? null;

  const pricedPools = pools.filter((p) => p.liquidityUsd != null && p.liquidityUsd > 0);
  const poolLiquidityUsd = pricedPools.length
    ? pricedPools.reduce((s, p) => s + (p.liquidityUsd as number), 0)
    : null;

  const volume24h = quote?.volume24h ?? null;
  const impact = roundTripImpactBps(sizeUsd, poolLiquidityUsd);
  const exit = daysToExit(sizeUsd, volume24h);

  let tradeability: Tradeability;
  let unknownBecause: string | null = null;

  if (pools.length === 0) {
    tradeability = 'unknown';
    unknownBecause =
      'CoinMarketCap lists no DEX pool for this token, so we cannot see where it is quoted on-chain. Absence of a pool is not evidence of illiquidity — the venue may be a broker or ATS we cannot see.';
  } else if (poolLiquidityUsd == null) {
    tradeability = 'unknown';
    unknownBecause = 'pools exist but CoinMarketCap reports no USD liquidity for them';
  } else if (poolLiquidityUsd < sizeUsd) {
    tradeability = 'not-tradeable';
    unknownBecause = `deepest visible pool holds $${poolLiquidityUsd.toFixed(0)} in total, less than the $${sizeUsd.toLocaleString('en-US')} position`;
  } else if (impact != null && impact >= 100) {
    tradeability = 'thin';
    unknownBecause = `a $${sizeUsd.toLocaleString('en-US')} round trip costs ${impact.toFixed(0)} bps of price impact`;
  } else {
    tradeability = 'tradeable';
  }

  return {
    cryptoId,
    symbol,
    freshness,
    quoteAgeMs: ageMs,
    quoteUpdatedAt,
    priceStale: freshness === 'stale' || freshness === 'dormant',
    poolLiquidityUsd,
    volume24h,
    daysToExit: exit,
    roundTripImpactBps: impact,
    tradeability,
    unknownBecause,
    pools: [...pools],
  };
}
