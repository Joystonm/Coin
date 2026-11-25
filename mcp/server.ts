/**
 * The MCP server.
 *
 * Design, and the reason it exists:
 *
 *   A model is good at choosing what to look at and at explaining what it found.
 *   A model is bad at remembering that a 40 bps spread against a $6M pool is
 *   not a trade, and worse at reporting "unknown" honestly.
 *
 * So the division of labour is deliberate: the model picks the asset and the
 * notional size — the parts that need judgement — and deterministic code in
 * `src/lib` decides the truth. There is no path in this server that lets a
 * model assert a spread is capturable. It can only ask, and be told.
 *
 * Every tool is read-only. Nothing here mutates the snapshot, spends credits, or
 * writes to disk. The server answers from the committed snapshot, so it works
 * for anyone who clones the repository, with or without an API key.
 *
 * The refusals are the product. "We could not measure it" is returned as
 * `null` with a stated reason — never rounded to zero, never silently
 * upgraded to a verdict.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { openSession, findAsset, type Session } from '../src/lib/session.ts';
import { priceImpactBps, roundTripImpactBps, daysToExit } from '../src/lib/depth.ts';
import { judgeCrossing, type CrossingPair } from '../src/lib/crossing.ts';
import type { AssetAnalysis } from '../src/lib/analysis.ts';
import type { ParityRow } from '../src/lib/parity.ts';

const DEFAULT_SIZE_USD = 100_000;

/** The snapshot is read once and cached: it cannot change under us mid-session. */
let session: Session | null = null;

function getSession(): Session {
  if (!session) session = openSession();
  return session;
}

/** A tool result. The MCP SDK wants content blocks; we always send JSON text. */
function result(payload: unknown): {
  content: { type: 'text'; text: string }[];
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * The provenance block that rides along with every answer.
 *
 * A judge should never have to ask "where did this number come from?". The
 * snapshot knows which endpoints it pulled and which calls failed.
 */
function provenance(s: Session): Record<string, unknown> {
  const endpoints = [...new Set(s.snapshot.calls.map((c) => c.endpoint))].sort();
  const failed = s.snapshot.calls.filter((c) => c.errorCode !== 0);
  return {
    source: s.isFixture ? 'fixture' : 'live',
    generatedAt: s.snapshot.generatedAt,
    endpointsUsed: endpoints,
    apiCalls: s.snapshot.calls.length,
    failedCalls: failed.map((c) => ({
      endpoint: c.endpoint,
      query: c.query,
      errorCode: c.errorCode,
      errorMessage: c.errorMessage,
    })),
    disclaimer: s.isFixture
      ? 'This is the OFFLINE FIXTURE, not a live CoinMarketCap pull. Every number here is synthetic. Run `npm run snapshot` with an API key for live data.'
      : 'Live CoinMarketCap data. Re-run `npm run snapshot` to refresh.',
  };
}

/** A number that may not exist. Absent stays absent. */
function num(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value;
}

/** One wrapper's row, in the shape an agent can act on. */
function rowBrief(row: ParityRow): Record<string, unknown> {
  return {
    symbol: row.wrapper.symbol,
    name: row.wrapper.name,
    cryptoId: row.wrapper.cryptoId,
    issuer: row.wrapper.issuerName,
    status: row.status,
    rawPrice: num(row.wrapper.price),
    normalizedPrice: num(row.normalizedPrice),
    unit: row.unit ? { label: row.unit.label, factor: row.unit.factor } : null,
    deviationBps: num(row.deviationBps),
    peerDeviationBps: num(row.peerDeviationBps),
    volume24h: num(row.wrapper.volume24h),
    volumeShare: row.volumeShare,
    eligible: row.eligible,
    excludedBecause: row.excludedBecause,
    offPeg: row.offPeg,
    unexplainedRatio: row.unexplainedRatio,
  };
}

/** A judged pair, in the shape an agent can act on. */
function pairBrief(pair: CrossingPair): Record<string, unknown> {
  return {
    asset: pair.assetSymbol,
    buy: pair.cheap.wrapper.symbol,
    sell: pair.rich.wrapper.symbol,
    spreadBps: num(pair.spreadBps),
    roundTripCostBps: num(pair.costBps),
    netBps: num(pair.netBps),
    verdict: pair.verdict,
    noiseFloorBps: num(pair.noiseBps),
    chainMismatch: pair.chainMismatch,
    issuerMismatch: pair.issuerMismatch,
    reasons: pair.reasons,
    buySide: pair.depth.cheap
      ? {
          liquidityUsd: num(pair.depth.cheap.poolLiquidityUsd),
          volume24h: num(pair.depth.cheap.volume24h),
          daysToExit: num(pair.depth.cheap.daysToExit),
          freshness: pair.depth.cheap.freshness,
          tradeability: pair.depth.cheap.tradeability,
          unknownBecause: pair.depth.cheap.unknownBecause,
        }
      : null,
    sellSide: pair.depth.rich
      ? {
          liquidityUsd: num(pair.depth.rich.poolLiquidityUsd),
          volume24h: num(pair.depth.rich.volume24h),
          daysToExit: num(pair.depth.rich.daysToExit),
          freshness: pair.depth.rich.freshness,
          tradeability: pair.depth.rich.tradeability,
          unknownBecause: pair.depth.rich.unknownBecause,
        }
      : null,
  };
}

/** Everything about one asset, minus the pair verdicts. */
function assetBrief(asset: AssetAnalysis): Record<string, unknown> {
  return {
    symbol: asset.asset.symbol,
    name: asset.asset.name,
    slug: asset.asset.slug,
    assetType: asset.asset.assetType,
    rank: asset.asset.rank,
    anchor: num(asset.anchor),
    anchorMethod: asset.anchorMethod,
    cmcAverageTokenizedPrice: num(asset.asset.avgTokenizedPrice),
    wrappers: asset.rows.map(rowBrief),
    notes: asset.notes,
    trap: asset.trap,
    cheapestOnScreen: asset.cheapestOnScreen?.wrapper.symbol ?? null,
    cheapestReachable: asset.cheapestReachable?.wrapper.symbol ?? null,
    crossings: asset.crossings.map(pairBrief),
  };
}

const server = new McpServer(
  { name: 'cross-the-spread', version: '0.1.0' },
  {
    instructions:
      'Cross the Spread prices the round trip on tokenized real-world assets. ' +
      'A wrapper spread is a price comparison, not a trade: to capture it you must buy the cheap side ' +
      'and sell the rich side, paying price impact on both legs. ' +
      'Use judge_spread to get a verdict; the verdict is computed, never asserted. ' +
      'Five verdicts exist: capturable, not-capturable, not-distinguishable, dead-side, unpriceable. ' +
      '"unpriceable" and "not-distinguishable" are answers, not failures — report them as such. ' +
      'Never round an absent number to zero.',
  },
);

/* ------------------------------------------------------------------ *
 * 1. What is in here.
 * ------------------------------------------------------------------ */

server.registerTool(
  'list_assets',
  {
    title: 'List the tokenized assets covered by the snapshot',
    description:
      'Every tokenized real-world asset in the snapshot, with its wrapper count, its consensus anchor, ' +
      'and whether the cheapest wrapper on screen is actually the one you could buy (a trap). ' +
      'Start here to choose an asset to judge.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const s = getSession();
    return result({
      provenance: provenance(s),
      summary: s.analysis.summary,
      assets: s.analysis.assets.map((a) => ({
        symbol: a.asset.symbol,
        name: a.asset.name,
        assetType: a.asset.assetType,
        wrappers: a.rows.length,
        anchor: num(a.anchor),
        anchorMethod: a.anchorMethod,
        pairsJudged: a.crossings.length,
        verdicts: a.crossings.reduce<Record<string, number>>((acc, c) => {
          acc[c.verdict] = (acc[c.verdict] ?? 0) + 1;
          return acc;
        }, {}),
        trap: a.trap,
        cheapestOnScreen: a.cheapestOnScreen?.wrapper.symbol ?? null,
        cheapestReachable: a.cheapestReachable?.wrapper.symbol ?? null,
      })),
    });
  },
);

/* ------------------------------------------------------------------ *
 * 2. The core question.
 * ------------------------------------------------------------------ */

server.registerTool(
  'judge_spread',
  {
    title: 'Judge whether a wrapper spread is capturable at a given size',
    description:
      'The core tool. For one asset and one notional size, it returns the spread, the round-trip cost ' +
      '(price impact buying the cheap side plus selling the rich side), the net, and one of five verdicts: ' +
      'capturable, not-capturable, not-distinguishable, dead-side, unpriceable. ' +
      'It also returns the reasons in plain words, and the trap: the cheapest wrapper on screen versus the ' +
      'cheapest one you could actually buy. ' +
      'A verdict of "unpriceable" means the execution cost is unknown — no pool with priced liquidity, ' +
      'or the two wrappers sit on different chains. It is not a negative verdict; report it as unknown.',
    inputSchema: {
      asset: z.string().describe('Asset symbol, slug or name, e.g. "GOLD", "NVDA", "SPY".'),
      sizeUsd: z
        .number()
        .positive()
        .optional()
        .describe('Notional size of the trade in USD. Defaults to 100000.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ asset, sizeUsd }) => {
    const s = getSession();
    const found = findAsset(s, asset);
    if (!found) {
      const available = s.analysis.assets.map((a) => a.asset.symbol).join(', ');
      return result({
        error: `No asset matching "${asset}" in the snapshot.`,
        availableAssets: available,
        provenance: provenance(s),
      });
    }
    const size = sizeUsd ?? s.snapshot.scope?.sizeUsd ?? DEFAULT_SIZE_USD;

    // Re-judge at the requested size. The snapshot's own analysis used one size;
    // cost is a function of size, so the verdict has to be recomputed, not scaled.
    const crossings = found.rows.length ? rebuildAtSize(found, size, s) : [];

    return result({
      provenance: provenance(s),
      asset: {
        symbol: found.asset.symbol,
        name: found.asset.name,
        anchor: num(found.anchor),
        anchorMethod: found.anchorMethod,
        notes: found.notes,
      },
      sizeUsd: size,
      trap: {
        isTrap: found.trap,
        cheapestOnScreen: found.cheapestOnScreen
          ? {
              symbol: found.cheapestOnScreen.wrapper.symbol,
              price: num(found.cheapestOnScreen.normalizedPrice),
              deviationBps: num(found.cheapestOnScreen.deviationBps),
            }
          : null,
        cheapestReachable: found.cheapestReachable
          ? {
              symbol: found.cheapestReachable.wrapper.symbol,
              price: num(found.cheapestReachable.normalizedPrice),
              deviationBps: num(found.cheapestReachable.deviationBps),
            }
          : null,
        explanation: found.trap
          ? `The screen ranks ${found.cheapestOnScreen?.wrapper.symbol} cheapest, but it is not reachable at that price — ${found.cheapestReachable?.wrapper.symbol} is the cheapest wrapper you could actually buy.`
          : 'The cheapest wrapper on screen is also the cheapest one you could buy.',
      },
      wrappers: found.rows.map(rowBrief),
      pairs: crossings,
    });
  },
);

/* ------------------------------------------------------------------ *
 * 3. The trap, across the whole universe.
 * ------------------------------------------------------------------ */

server.registerTool(
  'find_traps',
  {
    title: 'Find assets where the cheapest wrapper on screen is a trap',
    description:
      'A screener shows the cheapest wrapper of an asset and calls it a buy. But the cheapest wrapper is ' +
      'often not the cheapest one you can buy — it may have no visible pool, no volume, or a stale print. ' +
      'This tool lists every asset in the snapshot where those two disagree, with the reason. ' +
      'This is usually the most interesting thing in the data.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const s = getSession();
    const traps = s.analysis.assets.filter((a) => a.trap);
    return result({
      provenance: provenance(s),
      trapSharePct: s.analysis.summary.trapShare,
      assetsWithTraps: traps.length,
      assetsScanned: s.analysis.assets.length,
      traps: traps.map((a) => ({
        symbol: a.asset.symbol,
        name: a.asset.name,
        cheapestOnScreen: a.cheapestOnScreen
          ? {
              symbol: a.cheapestOnScreen.wrapper.symbol,
              price: num(a.cheapestOnScreen.normalizedPrice),
              deviationBps: num(a.cheapestOnScreen.deviationBps),
              status: a.cheapestOnScreen.status,
              volume24h: num(a.cheapestOnScreen.wrapper.volume24h),
              whyNotReachable:
                a.depths[a.cheapestOnScreen.wrapper.cryptoId]?.unknownBecause ?? 'unknown',
              tradeability: a.depths[a.cheapestOnScreen.wrapper.cryptoId]?.tradeability ?? 'unknown',
            }
          : null,
        cheapestReachable: a.cheapestReachable
          ? {
              symbol: a.cheapestReachable.wrapper.symbol,
              price: num(a.cheapestReachable.normalizedPrice),
              deviationBps: num(a.cheapestReachable.deviationBps),
              volume24h: num(a.cheapestReachable.wrapper.volume24h),
              tradeability: a.depths[a.cheapestReachable.wrapper.cryptoId]?.tradeability ?? 'unknown',
            }
          : null,
        costOfTheGapBps:
          a.cheapestOnScreen && a.cheapestReachable
            ? num(
                ((a.cheapestReachable.normalizedPrice as number) /
                  (a.cheapestOnScreen.normalizedPrice as number) -
                  1) *
                  10_000,
              )
            : null,
      })),
    });
  },
);

/* ------------------------------------------------------------------ *
 * 4. One asset in full.
 * ------------------------------------------------------------------ */

server.registerTool(
  'get_asset',
  {
    title: 'Get one asset: every wrapper, its parity, and its judged pairs',
    description:
      'The full picture for one asset: the consensus anchor and how it was set, every wrapper with its ' +
      'status, unit normalisation, deviation from the anchor, deviation from its peers, and volume share, ' +
      'plus every judged pair with its verdict and reasons. ' +
      'Wrappers that did not vote on the anchor carry the reason they were excluded.',
    inputSchema: {
      asset: z.string().describe('Asset symbol, slug or name, e.g. "GOLD", "NVDA".'),
      sizeUsd: z
        .number()
        .positive()
        .optional()
        .describe('Notional size in USD for the pair verdicts. Defaults to 100000.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ asset, sizeUsd }) => {
    const s = getSession();
    const found = findAsset(s, asset);
    if (!found) {
      return result({
        error: `No asset matching "${asset}" in the snapshot.`,
        availableAssets: s.analysis.assets.map((a) => a.asset.symbol).join(', '),
        provenance: provenance(s),
      });
    }
    const size = sizeUsd ?? s.snapshot.scope?.sizeUsd ?? DEFAULT_SIZE_USD;
    return result({
      provenance: provenance(s),
      sizeUsd: size,
      ...assetBrief(found),
      pairs: rebuildAtSize(found, size, s),
    });
  },
);

/* ------------------------------------------------------------------ *
 * 5. The cost of one trade.
 * ------------------------------------------------------------------ */

server.registerTool(
  'price_impact',
  {
    title: 'Price what a given size costs to trade in one wrapper',
    description:
      'Constant-product price impact for one notional size in one wrapper, from the DEX liquidity ' +
      'CoinMarketCap reports. Returns one-way impact, round-trip impact, days to exit at the reported ' +
      '24h volume, the quote freshness, and whether the wrapper is tradeable at that size. ' +
      'When CMC reports no pool with priced liquidity, every cost field is null and ' +
      'unknownBecause says why. Null means unmeasured; it never means free.',
    inputSchema: {
      asset: z.string().describe('Asset symbol, slug or name.'),
      wrapper: z.string().describe('Wrapper symbol, e.g. "PAXG", "NVDAX".'),
      sizeUsd: z.number().positive().describe('Notional size in USD.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ asset, wrapper, sizeUsd }) => {
    const s = getSession();
    const found = findAsset(s, asset);
    if (!found) {
      return result({
        error: `No asset matching "${asset}".`,
        availableAssets: s.analysis.assets.map((a) => a.asset.symbol).join(', '),
        provenance: provenance(s),
      });
    }
    const row = found.rows.find(
      (r) => r.wrapper.symbol.toLowerCase() === wrapper.trim().toLowerCase(),
    );
    if (!row) {
      return result({
        error: `No wrapper "${wrapper}" on ${found.asset.symbol}.`,
        availableWrappers: found.rows.map((r) => r.wrapper.symbol),
        provenance: provenance(s),
      });
    }
    const depth = found.depths[row.wrapper.cryptoId] ?? null;
    const liquidity = depth?.poolLiquidityUsd ?? null;

    return result({
      provenance: provenance(s),
      asset: found.asset.symbol,
      wrapper: row.wrapper.symbol,
      issuer: row.wrapper.issuerName,
      sizeUsd,
      price: num(row.normalizedPrice),
      unit: row.unit?.label ?? null,
      liquidityUsd: num(liquidity),
      oneWayImpactBps: num(liquidity == null ? null : priceImpactBps(sizeUsd, liquidity)),
      roundTripImpactBps: num(roundTripImpactBps(sizeUsd, liquidity)),
      daysToExit: num(daysToExit(sizeUsd, depth?.volume24h ?? null)),
      volume24h: num(depth?.volume24h ?? null),
      freshness: depth?.freshness ?? 'unknown',
      quoteUpdatedAt: depth?.quoteUpdatedAt ?? null,
      tradeability: depth?.tradeability ?? 'unknown',
      unknownBecause: depth?.unknownBecause ?? 'no DEX pool was looked up for this wrapper',
      pools: (depth?.pools ?? []).map((p) => ({
        dex: p.dexName,
        platform: p.platform,
        liquidityUsd: num(p.liquidityUsd),
        volume24h: num(p.volume24h),
        source: p.source,
      })),
      assumption:
        'Constant-product approximation on a balanced pool: impact = size / (liquidity + size). ' +
        'No concentrated-liquidity range effects and no gas are modelled.',
    });
  },
);

/* ------------------------------------------------------------------ *
 * 6. The API findings.
 * ------------------------------------------------------------------ */

server.registerTool(
  'list_findings',
  {
    title: 'List the data problems found in CoinMarketCap\'s own responses',
    description:
      'Auto-detected from the snapshot, never hand-picked. Each finding names the endpoint, the evidence ' +
      'from the actual response, a runnable curl reproduction, and what we think should change. ' +
      'Severity 3 blocks the product; 2 is a real defect; 1 is cosmetic.',
    inputSchema: {
      severity: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe('Only findings at or above this severity.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ severity }) => {
    const s = getSession();
    const findings = severity
      ? s.findings.filter((f) => f.severity >= severity)
      : s.findings;
    return result({
      provenance: provenance(s),
      count: findings.length,
      findings: findings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        endpoint: f.endpoint,
        detail: f.detail,
        evidence: f.evidence,
        repro: f.repro ?? null,
        suggestedFix: f.suggestedFix ?? null,
      })),
    });
  },
);

/* ------------------------------------------------------------------ *
 * 7. Provenance of a single call.
 * ------------------------------------------------------------------ */

server.registerTool(
  'list_calls',
  {
    title: 'List the CoinMarketCap calls behind the numbers, with what failed',
    description:
      'Every API call the snapshot made: endpoint, query string, HTTP status, CoinMarketCap error code, ' +
      'credits charged and elapsed milliseconds — including the calls that failed. ' +
      'A failed call is not noise; it is usually the reason a number is missing.',
    inputSchema: {
      failedOnly: z.boolean().optional().describe('Only calls CoinMarketCap reported an error for.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ failedOnly }) => {
    const s = getSession();
    const calls = failedOnly
      ? s.snapshot.calls.filter((c) => c.errorCode !== 0)
      : s.snapshot.calls;
    return result({
      provenance: provenance(s),
      totalCalls: s.snapshot.calls.length,
      failedCalls: s.snapshot.calls.filter((c) => c.errorCode !== 0).length,
      creditsSpent: s.snapshot.calls.reduce((sum, c) => sum + c.credits, 0),
      calls: calls.map((c) => ({
        endpoint: c.endpoint,
        query: c.query,
        errorCode: c.errorCode,
        errorMessage: c.errorMessage,
        credits: c.credits,
        elapsedMs: c.elapsedMs,
        at: c.at,
      })),
    });
  },
);

/* ------------------------------------------------------------------ *
 * Re-judging at a different size.
 * ------------------------------------------------------------------ */

/**
 * Re-judge an asset's pairs at a different notional size.
 *
 * Cost is not linear in size, so the verdict at $50k is not the verdict at
 * $1m scaled down. The pairs have to be re-run through the same judge.
 */
function rebuildAtSize(asset: AssetAnalysis, sizeUsd: number, s: Session): Record<string, unknown>[] {
  const now = Date.parse(s.snapshot.generatedAt);
  const depths = asset.depths;
  const pairs: CrossingPair[] = [];

  const voters = asset.rows.filter((r) => r.eligible && r.deviationBps != null);
  if (voters.length < 2) return [];

  const byDev = [...voters].sort((a, b) => (a.deviationBps as number) - (b.deviationBps as number));
  const seen = new Set<string>();
  const rich = byDev[byDev.length - 1] as ParityRow;

  const push = (cheap: ParityRow, richRow: ParityRow) => {
    const key = [cheap.wrapper.cryptoId, richRow.wrapper.cryptoId].sort((a, b) => a - b).join('-');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push(
      judgeCrossing(
        asset.asset.symbol,
        asset.asset.name,
        cheap,
        richRow,
        depths[cheap.wrapper.cryptoId] ?? null,
        depths[richRow.wrapper.cryptoId] ?? null,
        asset.rows,
        { sizeUsd, now },
      ),
    );
  };

  for (const row of byDev) {
    if (rich.wrapper.cryptoId === row.wrapper.cryptoId) continue;
    push(row, rich);
  }

  pairs.sort((a, b) => (b.spreadBps ?? 0) - (a.spreadBps ?? 0));
  return pairs.slice(0, 4).map(pairBrief);
}

/* ------------------------------------------------------------------ *
 * Boot.
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the transport. Anything else printed here corrupts the protocol.
  process.stderr.write(
    `cross-the-spread MCP server ready — ${getSession().analysis.assets.length} assets, ` +
      `${getSession().analysis.crossings.length} judged pairs ` +
      `(${getSession().isFixture ? 'OFFLINE FIXTURE' : 'live'})\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `cross-the-spread MCP server failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
