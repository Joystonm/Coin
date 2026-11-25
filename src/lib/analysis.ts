/**
 * The analysis layer.
 *
 * Pure: no clock, no network, no globals. The same code produces the number in
 * the data file and the number on the screen, so they cannot disagree.
 *
 * It takes a raw snapshot (as CoinMarketCap returned it) and produces the three
 * axes the product is built on:
 *
 *   price      — what is a wrapper worth relative to its peers?   (parity.ts)
 *   freshness  — is that price still a price?                      (depth.ts)
 *   execution  — can you get it, and what does it cost?            (depth.ts)
 *
 * and then the verdict: is this spread capturable?                 (crossing.ts)
 */

import { computeParity, extremes, type ParityRow } from './parity.ts';
import { assessDepth, type DepthAssessment } from './depth.ts';
import type { HistoryStats } from './history.ts';
import {
  cheapestReachable as findCheapestReachable,
  judgeCrossing,
  summariseCrossings,
  type CrossingOptions,
  type CrossingPair,
  type CrossingVerdict,
} from './crossing.ts';
import { median } from './stats.ts';
import type {
  ApiCall,
  Pool,
  RwaAsset,
  Snapshot,
  TokenQuote,
} from './types.ts';

export interface AssetAnalysis {
  asset: RwaAsset;
  /** The consensus anchor and every wrapper's standing against it. */
  rows: ParityRow[];
  anchor: number | null;
  anchorMethod: 'volume-weighted mean' | 'median' | 'none';
  /** Depth assessment per wrapper we managed to look up. */
  depths: Record<number, DepthAssessment>;
  /** Every candidate pair, judged. */
  crossings: CrossingPair[];
  /** The cheapest wrapper on the screen versus the cheapest one you could buy. */
  cheapestOnScreen: ParityRow | null;
  cheapestReachable: ParityRow | null;
  /** True when the screen's cheapest wrapper is not the reachable one. */
  trap: boolean;
  /** Notes about this asset that a reader should not miss. */
  notes: string[];
}

export interface Finding {
  id: string;
  title: string;
  detail: string;
  endpoint: string;
  evidence: string;
  severity: 1 | 2 | 3;
  repro?: string;
  suggestedFix?: string;
}

export interface Analysis {
  generatedAt: string;
  universe: Snapshot['universe'];
  assets: AssetAnalysis[];
  crossings: CrossingPair[];
  summary: {
    assetsScanned: number;
    wrappersSeen: number;
    wrappersPriced: number;
    wrappersWithDepth: number;
    pairsJudged: number;
    byVerdict: Record<CrossingVerdict, number>;
    capturableShare: number | null;
    medianSpreadBps: number | null;
    medianCostBps: number | null;
    medianNetBps: number | null;
    /** Share of assets where the screen's cheapest wrapper is not the reachable one. */
    trapShare: number | null;
    /** Share of voting wrappers whose own quote is stale or dormant. */
    staleShare: number | null;
    /** Share of voting wrappers with no visible DEX pool at all. */
    noPoolShare: number | null;
    /** CMC's own aggregate price, compared with ours, across the scanned assets. */
    aggregateGapBps: number | null;
    aggregateGapAssets: number;
  };
  findings: Finding[];
  calls: ApiCall[];
}

/** Options for the analysis. */
export interface AnalysisOptions {
  /** Notional size of the hypothetical trade, in USD. */
  sizeUsd: number;
  /** Reference time. */
  now: number;
  /** How many wrapper pairs per asset to keep. */
  maxPairsPerAsset?: number;
  /** Per-asset history statistics, keyed by asset symbol. Optional. */
  histories?: Record<string, HistoryStats> | null;
}

const DEFAULT_SIZE_USD = 100_000;

/**
 * Judge every meaningful pair of wrappers for one asset.
 *
 * The pairs are the wrappers that voted on the anchor, taken two at a time,
 * richest against cheapest. We keep the widest few because the others are
 * arithmetic consequences of the widest one.
 */
function judgeAssetPairs(
  asset: RwaAsset,
  rows: readonly ParityRow[],
  depths: Record<number, DepthAssessment>,
  options: AnalysisOptions,
): CrossingPair[] {
  const voters = rows.filter((r) => r.eligible && r.deviationBps != null);
  if (voters.length < 2) return [];

  const crossingOptions: CrossingOptions = {
    sizeUsd: options.sizeUsd,
    now: options.now,
    history: options.histories?.[asset.symbol.toUpperCase()] ?? null,
  };

  const byDev = [...voters].sort((a, b) => (a.deviationBps as number) - (b.deviationBps as number));
  const pairs: CrossingPair[] = [];
  const seen = new Set<string>();

  // Pair each wrapper with the most expensive one it could be captured against.
  for (const row of byDev) {
    const rich = byDev[byDev.length - 1];
    if (!rich || rich.wrapper.cryptoId === row.wrapper.cryptoId) continue;
    const key = [row.wrapper.cryptoId, rich.wrapper.cryptoId].sort((a, b) => a - b).join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(
      judgeCrossing(
        asset.symbol,
        asset.name,
        row,
        rich,
        depths[row.wrapper.cryptoId] ?? null,
        depths[rich.wrapper.cryptoId] ?? null,
        rows,
        crossingOptions,
      ),
    );
  }

  // Also judge the widest pair outright.
  const { cheapest, richest } = extremes(rows);
  if (cheapest && richest) {
    const key = [cheapest.wrapper.cryptoId, richest.wrapper.cryptoId].sort((a, b) => a - b).join('-');
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push(
        judgeCrossing(
          asset.symbol,
          asset.name,
          cheapest,
          richest,
          depths[cheapest.wrapper.cryptoId] ?? null,
          depths[richest.wrapper.cryptoId] ?? null,
          rows,
          crossingOptions,
        ),
      );
    }
  }

  pairs.sort((a, b) => (b.spreadBps ?? 0) - (a.spreadBps ?? 0));
  const limit = options.maxPairsPerAsset ?? 4;
  return pairs.slice(0, limit);
}

/** Analyse one asset: price, freshness, execution, and the verdicts. */
export function analyseAsset(
  asset: RwaAsset,
  quotes: Record<number, TokenQuote>,
  pools: Record<number, Pool[]>,
  options: AnalysisOptions,
): AssetAnalysis {
  const { rows, anchor, anchorMethod } = computeParity(asset.wrappers);
  const notes: string[] = [];

  const depths: Record<number, DepthAssessment> = {};
  for (const row of rows) {
    const id = row.wrapper.cryptoId;
    const poolList = pools[id];
    if (!poolList) continue;
    depths[id] = assessDepth(id, row.wrapper.symbol, quotes[id], poolList, {
      sizeUsd: options.sizeUsd,
      now: options.now,
    });
  }

  const crossings = judgeAssetPairs(asset, rows, depths, options);

  const depthMap = new Map<number, DepthAssessment>(Object.entries(depths).map(([k, v]) => [Number(k), v]));
  const { cheapestOnScreen, cheapestReachable, trap } = findCheapestReachable(rows, depthMap);

  // Notes a reader must not miss.
  if (anchor == null) {
    notes.push('no consensus: not enough wrappers with a price and volume to compare');
  } else if (anchorMethod === 'median') {
    notes.push('the anchor fell back to a plain median because no wrapper cleared the volume floor');
  }
  const unitMismatches = rows.filter((r) => r.unit != null);
  if (unitMismatches.length) {
    notes.push(
      `${unitMismatches.length} wrapper${unitMismatches.length === 1 ? '' : 's'} quote in a different unit and were normalised before comparison: ${unitMismatches.map((r) => `${r.wrapper.symbol} (${r.unit?.label})`).join('; ')}`,
    );
  }
  const unexplained = rows.filter((r) => r.unexplainedRatio);
  if (unexplained.length) {
    notes.push(
      `${unexplained.length} wrapper${unexplained.length === 1 ? '' : 's'} sit at a price ratio no known unit explains and were left out of the anchor rather than rescaled`,
    );
  }
  const noPrice = rows.filter((r) => r.status === 'no-price');
  if (noPrice.length) {
    notes.push(`${noPrice.length} wrapper${noPrice.length === 1 ? '' : 's'} report no price at all`);
  }
  const stale = rows.filter((r) => depths[r.wrapper.cryptoId]?.priceStale);
  if (stale.length) {
    notes.push(
      `${stale.length} wrapper${stale.length === 1 ? '' : 's'} quote${stale.length === 1 ? 's' : ''} a price that is more than a day old`,
    );
  }
  const noPool = rows.filter(
    (r) => depths[r.wrapper.cryptoId] && depths[r.wrapper.cryptoId]!.tradeability === 'unknown',
  );
  if (noPool.length) {
    notes.push(
      `${noPool.length} wrapper${noPool.length === 1 ? '' : 's'} have no DEX pool we can price, so their execution cost is unknown rather than zero`,
    );
  }
  if (asset.avgTokenizedPrice != null && anchor != null) {
    const gap = (asset.avgTokenizedPrice / anchor - 1) * 10_000;
    if (Math.abs(gap) >= 100) {
      notes.push(
        `CoinMarketCap's own average for this asset (${asset.avgTokenizedPrice.toFixed(2)}) is ${gap > 0 ? 'above' : 'below'} our unit-normalised anchor (${anchor.toFixed(2)}) by ${Math.abs(gap).toFixed(0)} bps`,
      );
    }
  }

  return {
    asset,
    rows,
    anchor,
    anchorMethod,
    depths,
    crossings,
    cheapestOnScreen,
    cheapestReachable,
    trap,
    notes,
  };
}

/**
 * The whole analysis.
 *
 * `snapshot.assets` must already carry the raw wrappers, `snapshot.deployments`
 * the per-token deployments, and `pools` the DEX pools we managed to look up.
 */
export function analyse(
  snapshot: Snapshot,
  quotes: Record<number, TokenQuote>,
  pools: Record<number, Pool[]>,
  options: Partial<AnalysisOptions> = {},
): Analysis {
  const resolved: AnalysisOptions = {
    sizeUsd: options.sizeUsd ?? DEFAULT_SIZE_USD,
    now: options.now ?? Date.parse(snapshot.generatedAt),
    maxPairsPerAsset: options.maxPairsPerAsset ?? 4,
    histories: options.histories ?? null,
  };

  const assets = snapshot.assets.map((asset) =>
    analyseAsset(asset, quotes, pools, resolved),
  );

  const allCrossings = assets.flatMap((a) => a.crossings);
  const summaryOfCrossings = summariseCrossings(allCrossings);

  let wrappersSeen = 0;
  let wrappersPriced = 0;
  let wrappersWithDepth = 0;
  let voting = 0;
  let stale = 0;
  let noPool = 0;
  let aggregateGapBps: number[] = [];
  let aggregateGapAssets = 0;

  for (const a of assets) {
    wrappersSeen += a.rows.length;
    for (const row of a.rows) {
      if (row.status !== 'no-price' && row.status !== 'no-data') wrappersPriced += 1;
      if (!row.eligible) continue;
      voting += 1;
      const d = a.depths[row.wrapper.cryptoId];
      if (d) {
        wrappersWithDepth += 1;
        if (d.priceStale) stale += 1;
        if (d.tradeability === 'unknown') noPool += 1;
      }
      if (a.anchor != null) {
        const gap = (row.normalizedPrice as number) / a.anchor - 1;
        aggregateGapBps.push(gap * 10_000);
      }
    }
    if (a.anchor != null && a.asset.avgTokenizedPrice != null) {
      const gap = (a.asset.avgTokenizedPrice / a.anchor - 1) * 10_000;
      if (Math.abs(gap) >= 100) aggregateGapAssets += 1;
    }
  }

  const traps = assets.filter((a) => a.trap).length;

  return {
    generatedAt: snapshot.generatedAt,
    universe: snapshot.universe,
    assets,
    crossings: allCrossings,
    summary: {
      assetsScanned: assets.length,
      wrappersSeen,
      wrappersPriced,
      wrappersWithDepth,
      pairsJudged: allCrossings.length,
      byVerdict: summaryOfCrossings.byVerdict,
      capturableShare: summaryOfCrossings.capturableShare,
      medianSpreadBps: summaryOfCrossings.medianSpreadBps,
      medianCostBps: summaryOfCrossings.medianCostBps,
      medianNetBps: summaryOfCrossings.medianNetBps,
      trapShare: assets.length ? (traps / assets.length) * 100 : null,
      staleShare: voting ? (stale / voting) * 100 : null,
      noPoolShare: voting ? (noPool / voting) * 100 : null,
      aggregateGapBps: median(aggregateGapBps.map(Math.abs)),
      aggregateGapAssets,
    },
    findings: [],
    calls: snapshot.calls,
  };
}

/**
 * Auto-detected API findings.
 *
 * Nothing here is hand-picked: every issue is derived from the data we just
 * fetched, so the findings page cannot drift from the snapshot.
 */
export function detectFindings(
  snapshot: Snapshot,
  analysis: Analysis,
  quotes: Record<number, TokenQuote>,
): Finding[] {
  const findings: Finding[] = [];

  // 1. Assets listed but not reachable by id.
  const nullIds = snapshot.assets.filter((a) => a.rwaId == null);
  if (nullIds.length) {
    findings.push({
      id: 'null-rwa-id',
      title: 'Listed assets with no rwa_id cannot be fetched back',
      detail: `${nullIds.length} asset${nullIds.length === 1 ? '' : 's'} appear in the RWA list with a tokenized market cap but a null rwa_id, so they cannot be passed into the id-based endpoints the documentation recommends.`,
      endpoint: '/v5/real-world-assets/assets/list',
      evidence: nullIds
        .slice(0, 5)
        .map((a) => `${a.symbol}: rwa_id=null, cap=$${Math.round(a.tokenizedMarketCap ?? 0).toLocaleString('en-US')}`)
        .join('; '),
      severity: 2,
      repro: 'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/assets/list?limit=250&sort=tokenized_market_cap&sort_dir=desc"',
      suggestedFix:
        'Give every listed asset an id, or exclude id-less rows from the list endpoint so a consumer can round-trip the ids it was given.',
    });
  }

  // 2. Wrappers with no price.
  let noPrice = 0;
  const noPriceByIssuer = new Map<string, number>();
  for (const a of analysis.assets) {
    for (const row of a.rows) {
      if (row.status !== 'no-price') continue;
      noPrice += 1;
      const issuer = row.wrapper.issuerName ?? 'unknown';
      noPriceByIssuer.set(issuer, (noPriceByIssuer.get(issuer) ?? 0) + 1);
    }
  }
  if (noPrice) {
    const worst = [...noPriceByIssuer.entries()].sort((a, b) => b[1] - a[1])[0];
    findings.push({
      id: 'null-price-wrappers',
      title: 'Wrappers are listed with a null price',
      detail: `${noPrice} wrappers report price: null. They are neither tradable nor a discount — they are absent, and a consumer that reads them as zero will rank them as the cheapest thing in the asset.`,
      endpoint: '/v5/real-world-assets/quotes/latest',
      evidence: `null prices: ${noPrice}; most affected issuer: ${worst?.[0]} (${worst?.[1]})`,
      severity: 2,
      repro: 'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/latest?rwa_id=1"',
      suggestedFix:
        'Return a status field per wrapper (active / delisted / not-yet-traded) so a null price is distinguishable from an unquoted one.',
    });
  }

  // 3. Mixed units under one rwa_id.
  const unitMismatches = analysis.assets.flatMap((a) =>
    a.rows.filter((r) => r.unit != null).map((r) => ({ asset: a.asset, row: r })),
  );
  if (unitMismatches.length) {
    findings.push({
      id: 'mixed-units',
      title: 'Wrappers under one rwa_id quote in different units, and nothing says so',
      detail: `${unitMismatches.length} wrappers across ${new Set(unitMismatches.map((m) => m.asset.symbol)).size} assets trade at a multiple of their peers. The payload has no unit field, so the multiples read as enormous dislocations — or, if averaged, as the asset's own price.`,
      endpoint: '/v5/real-world-assets/quotes/latest',
      evidence: unitMismatches
        .slice(0, 6)
        .map((m) => `${m.asset.symbol}/${m.row.wrapper.symbol}: ${m.row.unit?.label}`)
        .join('; '),
      severity: 3,
      repro: 'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/latest?rwa_id=1"',
      suggestedFix:
        'Add a per-token units_per_share field and a price expressed per underlying unit, so two wrappers of one asset can be compared without guessing.',
    });
  }

  // 4. CMC's aggregate price disagreeing with the wrappers.
  const aggregateGaps = analysis.assets
    .filter((a) => a.anchor != null && a.asset.avgTokenizedPrice != null)
    .map((a) => ({
      asset: a.asset,
      gap: ((a.asset.avgTokenizedPrice as number) / (a.anchor as number) - 1) * 10_000,
    }))
    .filter((g) => Math.abs(g.gap) >= 100)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  if (aggregateGaps.length) {
    findings.push({
      id: 'aggregate-unit-blend',
      title: 'average_tokenized_price blends units',
      detail: `${aggregateGaps.length} of ${analysis.assets.length} scanned assets report an average_tokenized_price that is more than 100 bps away from the median of their own wrappers, because the average is taken across wrappers quoted in different units. A consumer who trusts this field gets a price no wrapper trades at.`,
      endpoint: '/v5/real-world-assets/quotes/latest',
      evidence: aggregateGaps
        .slice(0, 6)
        .map((g) => `${g.asset.symbol}: avg ${g.asset.avgTokenizedPrice?.toFixed(2)} vs wrappers ${g.gap > 0 ? '+' : ''}${g.gap.toFixed(0)} bps`)
        .join('; '),
      severity: 3,
      repro: 'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/latest?rwa_id=1"',
      suggestedFix:
        'Compute average_tokenized_price over unit-normalised, liquidity-weighted wrappers only, and publish the method alongside the number.',
    });
  }

  // 5. Stale quotes.
  const staleRows = analysis.assets.flatMap((a) =>
    a.rows.filter((r) => a.depths[r.wrapper.cryptoId]?.priceStale).map((r) => ({ asset: a.asset, row: r })),
  );
  if (staleRows.length) {
    findings.push({
      id: 'stale-quotes',
      title: 'A wrapper can keep quoting a price it stopped trading at',
      detail: `${staleRows.length} wrappers quote a price whose own timestamp is more than a day old. The RWA endpoint does not timestamp wrappers individually, so this is only visible by joining to the token's own quote.`,
      endpoint: '/v2/cryptocurrency/quotes/latest',
      evidence: staleRows
        .slice(0, 6)
        .map((s) => `${s.asset.symbol}/${s.row.wrapper.symbol}: last updated ${quotes[s.row.wrapper.cryptoId]?.lastUpdated ?? 'unknown'}`)
        .join('; '),
      severity: 2,
      repro:
        'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=1&convert=USD"',
      suggestedFix:
        'Return last_updated per wrapper token in the RWA payload, and mark a wrapper whose quote is older than its peers.',
    });
  }

  // 6. Wrappers with no DEX pool we can price.
  const noPool = analysis.assets.flatMap((a) =>
    a.rows
      .filter((r) => a.depths[r.wrapper.cryptoId]?.tradeability === 'unknown')
      .map((r) => ({ asset: a.asset, row: r })),
  );
  if (noPool.length) {
    findings.push({
      id: 'no-visible-venue',
      title: 'A wrapper can have no DEX pool CoinMarketCap prices',
      detail: `${noPool.length} wrappers of the ones we looked up have no DEX pool with a priced liquidity figure. Their liquidity may sit on a broker or an ATS, which the RWA market-pairs endpoint would show but which our plan does not expose. We record their execution cost as unknown rather than zero.`,
      endpoint: '/v1/dex/token/pools',
      evidence: `${noPool.length} wrappers with no priced pool`,
      severity: 2,
      repro:
        'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/market-pairs/list?symbol=SPY&limit=5"',
      suggestedFix:
        'Expose /v5/real-world-assets/market-pairs/list on the plan the documentation says it is on, so a consumer can see where tokenized assets actually quote.',
    });
  }

  return findings;
}
