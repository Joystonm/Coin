/**
 * The core: can this spread actually be captured?
 *
 * A screener shows that two wrappers of the same stock trade 40 bps apart and
 * calls the cheaper one a buy. That is a price comparison, not a trade. To
 * capture the spread you have to buy the cheap side and sell the rich side, and
 * that costs money in three places:
 *
 *   1. price impact buying the cheap side into its pool,
 *   2. price impact selling the rich side out of its pool,
 *   3. the fact that the two wrappers may not be reachable from each other at
 *      all — different chains, different issuers, no route between them.
 *
 * We measure 1 and 2 from CoinMarketCap's DEX data and refuse to guess 3.
 *
 * Every verdict is one of five states. "We could not measure it" is a first
 * class answer and is never rounded into "no".
 */

import { median } from './stats.ts';
import { priceImpactBps } from './depth.ts';
import type { DepthAssessment } from './depth.ts';
import type { HistoryStats } from './history.ts';
import type { ParityRow } from './parity.ts';

/**
 * A spread smaller than this is not a spread, it is two quotes disagreeing.
 * Expressed in basis points and scaled by the asset's own dispersion.
 */
export const MIN_SPREAD_BPS = 10;

export type CrossingVerdict =
  /** The spread is larger than the cost of executing it. */
  | 'capturable'
  /** The spread is real but smaller than the cost of executing it. */
  | 'not-capturable'
  /** The two prices are not distinguishable — the difference is noise or a stale print. */
  | 'not-distinguishable'
  /** One side cannot be traded at all. */
  | 'dead-side'
  /** We cannot price the execution. Different chains, or no visible pool. */
  | 'unpriceable';

export const VERDICT_ORDER: readonly CrossingVerdict[] = [
  'capturable',
  'not-capturable',
  'not-distinguishable',
  'dead-side',
  'unpriceable',
];

export interface CrossingPair {
  assetSymbol: string;
  assetName: string;
  /** The cheaper wrapper. */
  cheap: ParityRow;
  /** The richer wrapper. */
  rich: ParityRow;
  /** The gap between them, in basis points. */
  spreadBps: number | null;
  /** Estimated cost of executing both legs, in basis points. */
  costBps: number | null;
  /** Spread minus cost. Positive means the trade survives its own friction. */
  netBps: number | null;
  /** The noise floor: the asset's own dispersion, measured leave-one-out. */
  noiseBps: number | null;
  verdict: CrossingVerdict;
  /** Every reason behind the verdict, in words. */
  reasons: string[];
  /** The depth assessments for both sides. */
  depth: { cheap: DepthAssessment | null; rich: DepthAssessment | null };
  /** Whether the two wrappers sit on different chains. */
  chainMismatch: boolean;
  /** Whether the two wrappers come from different issuers. */
  issuerMismatch: boolean;
}

export interface CrossingOptions {
  /** Notional size of the hypothetical trade, in USD. */
  sizeUsd: number;
  /** Reference time. Passed in so the function stays pure. */
  now: number;
  /**
   * The asset's own price history, when it was pulled.
   *
   * Optional: with no history the judge says nothing about volatility rather
   * than assuming the asset is calm. When it is present, a gap smaller than
   * the asset's typical daily move gets said out loud — you can be right about
   * the spread and still be wrong about the trade.
   */
  history?: HistoryStats | null;
}

/**
 * The noise floor for one asset: how far apart do its wrappers normally sit?
 *
 * Measured leave-one-out — for the pair under test, the noise is the dispersion
 * of the *other* voting wrappers — so a wide pair does not define its own noise.
 */
export function noiseFloorBps(rows: readonly ParityRow[], exclude: readonly number[]): number | null {
  const excluded = new Set(exclude);
  const devs = rows
    .filter((r) => r.eligible && !excluded.has(r.wrapper.cryptoId) && r.deviationBps != null)
    .map((r) => Math.abs(r.deviationBps as number));
  return median(devs);
}

/**
 * Decide whether one wrapper pair's spread is capturable.
 *
 * Pure. No network, no clock, no globals.
 */
export function judgeCrossing(
  assetSymbol: string,
  assetName: string,
  cheap: ParityRow,
  rich: ParityRow,
  depthCheap: DepthAssessment | null,
  depthRich: DepthAssessment | null,
  allRows: readonly ParityRow[],
  options: CrossingOptions,
): CrossingPair {
  const reasons: string[] = [];
  const spreadBps =
    cheap.normalizedPrice != null && rich.normalizedPrice != null && cheap.normalizedPrice !== 0
      ? (rich.normalizedPrice / cheap.normalizedPrice - 1) * 10_000
      : null;

  const cheapChain = depthCheap ? (depthCheap.pools[0]?.platform ?? null) : null;
  const richChain = depthRich ? (depthRich.pools[0]?.platform ?? null) : null;
  const chainMismatch =
    cheapChain != null && richChain != null && cheapChain.toLowerCase() !== richChain.toLowerCase();
  const issuerMismatch =
    cheap.wrapper.issuerId != null &&
    rich.wrapper.issuerId != null &&
    cheap.wrapper.issuerId !== rich.wrapper.issuerId;

  const noiseBps = noiseFloorBps(allRows, [cheap.wrapper.cryptoId, rich.wrapper.cryptoId]);

  const base = {
    assetSymbol,
    assetName,
    cheap,
    rich,
    spreadBps,
    costBps: null as number | null,
    netBps: null as number | null,
    noiseBps,
    depth: { cheap: depthCheap, rich: depthRich },
    chainMismatch,
    issuerMismatch,
  };

  // 1. A price we cannot compare is not a spread.
  if (spreadBps == null) {
    return {
      ...base,
      verdict: 'not-distinguishable',
      reasons: ['one side of the pair has no usable price, so there is nothing to compare'],
    };
  }

  // 2. A stale print is a price that may no longer exist.
  const staleSide = [depthCheap, depthRich].find((d) => d?.priceStale);
  if (staleSide) {
    reasons.push(
      `${staleSide.symbol}'s own quote was last struck ${formatAge(staleSide.quoteAgeMs)} — that price may no longer exist, so the gap is not a live spread`,
    );
    return { ...base, verdict: 'not-distinguishable', reasons };
  }

  // 3. A side with no volume cannot be bought. This is the trap.
  const deadCheap = depthCheap?.tradeability === 'not-tradeable';
  const deadRich = depthRich?.tradeability === 'not-tradeable';
  const noVolumeCheap = (depthCheap?.volume24h ?? 0) === 0;
  const noVolumeRich = (depthRich?.volume24h ?? 0) === 0;
  if (deadCheap || deadRich || noVolumeCheap || noVolumeRich) {
    const side = deadCheap || noVolumeCheap ? cheap : rich;
    const d = side === cheap ? depthCheap : depthRich;
    reasons.push(
      `${side.wrapper.symbol} cannot be traded at the quoted price: ${
        d?.unknownBecause ?? 'it reports no 24h volume, so there is nothing to buy or sell'
      }`,
    );
    reasons.push(
      `the ${spreadBps.toFixed(1)} bps gap is between a price you can get and a price you cannot — not an arbitrage`,
    );
    return { ...base, verdict: 'dead-side', reasons };
  }

  // 4. Below the noise floor the two prices are not distinguishable.
  const floor = Math.max(MIN_SPREAD_BPS, noiseBps ?? 0);
  if (spreadBps < floor) {
    reasons.push(
      `the ${spreadBps.toFixed(1)} bps gap is inside the asset's own dispersion (${(noiseBps ?? 0).toFixed(1)} bps), so the two prices are not distinguishable`,
    );
    return { ...base, verdict: 'not-distinguishable', reasons };
  }

  // 5. We need depth on both sides to price the execution.
  if (!depthCheap || !depthRich) {
    reasons.push('we have no depth for one of the two sides, so the execution cannot be priced');
    return { ...base, verdict: 'unpriceable', reasons };
  }
  if (depthCheap.poolLiquidityUsd == null || depthRich.poolLiquidityUsd == null) {
    reasons.push(
      'CoinMarketCap lists no DEX pool with priced liquidity for one of the two sides, so the execution cost is unknown — absence of a pool is not evidence of a free trade',
    );
    return { ...base, verdict: 'unpriceable', reasons };
  }

  // 6. Different chains means the trade leaves the tokenized market.
  if (chainMismatch) {
    reasons.push(
      `${cheap.wrapper.symbol} trades on ${cheapChain} and ${rich.wrapper.symbol} on ${richChain}; closing the trade needs a bridge that no CoinMarketCap endpoint prices`,
    );
    return { ...base, verdict: 'unpriceable', reasons };
  }

  // 7. Price it.
  const buyImpact = priceImpactBps(options.sizeUsd, depthCheap.poolLiquidityUsd) ?? 0;
  const sellImpact = priceImpactBps(options.sizeUsd, depthRich.poolLiquidityUsd) ?? 0;
  const costBps = buyImpact + sellImpact;
  const netBps = spreadBps - costBps;

  const crossing: CrossingPair = {
    ...base,
    costBps,
    netBps,
    verdict: 'not-capturable',
    reasons: [],
  };

  reasons.push(
    `a $${options.sizeUsd.toLocaleString('en-US')} round trip costs ${costBps.toFixed(1)} bps of price impact ` +
      `(buy ${buyImpact.toFixed(1)} bps into $${Math.round(depthCheap.poolLiquidityUsd).toLocaleString('en-US')} of ${cheap.wrapper.symbol} liquidity, ` +
      `sell ${sellImpact.toFixed(1)} bps out of $${Math.round(depthRich.poolLiquidityUsd).toLocaleString('en-US')} of ${rich.wrapper.symbol})`,
  );
  if (issuerMismatch) {
    reasons.push(
      `the two wrappers are issued by ${cheap.wrapper.issuerName ?? 'different issuers'} and ${rich.wrapper.issuerName ?? 'different issuers'}, so moving between them needs a redemption rather than a swap — settlement risk this product does not price`,
    );
  }
  if (netBps > 0) {
    reasons.push(
      `the ${spreadBps.toFixed(1)} bps gap clears the ${costBps.toFixed(1)} bps cost by ${netBps.toFixed(1)} bps`,
    );
    // The trade clears its friction, but does it survive being marked to
    // market? The asset's own history answers that, and only the history does.
    const history = options.history;
    if (history && !history.thin && history.medianAbsMoveBps != null) {
      const move = history.medianAbsMoveBps;
      if (spreadBps < move) {
        reasons.push(
          `the gap is smaller than the asset's own daily movement: ${assetSymbol}'s tokenized price moves a median of ${move.toFixed(1)} bps a day over the ${history.observations}-day history, so the position would be marked against you by more than the ${netBps.toFixed(1)} bps it makes before the spread closes`,
        );
      }
    }
    return { ...crossing, verdict: 'capturable', reasons };
  }
  reasons.push(
    `the ${spreadBps.toFixed(1)} bps gap does not clear the ${costBps.toFixed(1)} bps cost — it is short by ${(-netBps).toFixed(1)} bps`,
  );
  return { ...crossing, verdict: 'not-capturable', reasons };
}

/**
 * The cheapest wrapper you could actually buy, versus the cheapest wrapper on
 * the screen. When they differ, the screen is showing a trap.
 */
export function cheapestReachable(
  rows: readonly ParityRow[],
  depths: ReadonlyMap<number, DepthAssessment>,
): { cheapestOnScreen: ParityRow | null; cheapestReachable: ParityRow | null; trap: boolean } {
  const voters = rows.filter((r) => r.eligible && r.deviationBps != null);
  if (!voters.length) return { cheapestOnScreen: null, cheapestReachable: null, trap: false };
  const byPrice = [...voters].sort((a, b) => (a.deviationBps as number) - (b.deviationBps as number));
  const cheapestOnScreen = byPrice[0] as ParityRow;
  const reachable = byPrice.filter((r) => {
    const d = depths.get(r.wrapper.cryptoId);
    return d ? d.tradeability === 'tradeable' : false;
  });
  const cheapestReachable = reachable[0] ?? null;
  return {
    cheapestOnScreen,
    cheapestReachable,
    trap:
      cheapestReachable != null &&
      cheapestReachable.wrapper.cryptoId !== cheapestOnScreen.wrapper.cryptoId,
  };
}

/** Count of crossings by verdict, and the share that are capturable. */
export function summariseCrossings(crossings: readonly CrossingPair[]): {
  total: number;
  byVerdict: Record<CrossingVerdict, number>;
  capturableShare: number | null;
  medianSpreadBps: number | null;
  medianCostBps: number | null;
  medianNetBps: number | null;
} {
  const byVerdict = Object.fromEntries(
    VERDICT_ORDER.map((v) => [v, 0]),
  ) as Record<CrossingVerdict, number>;
  for (const c of crossings) byVerdict[c.verdict] += 1;
  const spreads = crossings.map((c) => c.spreadBps).filter((v): v is number => v != null);
  const costs = crossings.map((c) => c.costBps).filter((v): v is number => v != null);
  const nets = crossings.map((c) => c.netBps).filter((v): v is number => v != null);
  return {
    total: crossings.length,
    byVerdict,
    capturableShare: crossings.length ? (byVerdict.capturable / crossings.length) * 100 : null,
    medianSpreadBps: median(spreads),
    medianCostBps: median(costs),
    medianNetBps: median(nets),
  };
}

function formatAge(ms: number | null): string {
  if (ms == null) return 'at an unknown time';
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)} minutes ago`;
  if (hours < 48) return `${hours.toFixed(1)} hours ago`;
  return `${(hours / 24).toFixed(1)} days ago`;
}
