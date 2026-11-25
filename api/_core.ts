/**
 * The hosted API's logic, with no request plumbing in it.
 *
 * Everything the API returns is computed by the same pure engine the CLI, the
 * MCP server and the browser run — `src/lib/*`. The API is a transport, not a
 * second implementation, so a number served over HTTP and a number printed in
 * a terminal cannot disagree.
 *
 * The snapshot is bundled at build time from `public/data/snapshot.json` — the
 * same file the static site serves. That is deliberate. The hackathon reverts
 * keys to the Basic plan when submissions close, so the demo has to keep
 * working afterwards; a committed snapshot is the only thing that guarantees
 * it, and a live pull is an enhancement layered on top, never a prerequisite.
 *
 * No key is read here. This module cannot make a request to CoinMarketCap.
 */

import { analyse, detectFindings, type Analysis } from '../src/lib/analysis.ts';
import { summariseHistory, type HistoryStats } from '../src/lib/history.ts';
import type { Pool, Snapshot, TokenQuote } from '../src/lib/types.ts';

import snapshotJson from '../public/data/snapshot.json';

/** The bundled snapshot. The same bytes the static site serves at /data/snapshot.json. */
export const SNAPSHOT = snapshotJson as unknown as Snapshot;

/** Structural request shape. Vercel's request satisfies it; so does a test double. */
export interface ApiRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** Structural response shape. Vercel's response satisfies it; so does a test double. */
export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

/** One receipt: the proof a number came from a specific call. */
export interface EndpointReceipt {
  endpoint: string;
  query: string;
  errorCode: number;
  errorMessage: string | null;
  credits: number;
  elapsedMs: number;
  at: string;
}

export interface Provenance {
  /** `live` for a real pull, `fixture` for the offline snapshot. Never blurs the two. */
  source: 'live' | 'fixture';
  generatedAt: string;
  universe: Snapshot['universe'];
  scope: Snapshot['scope'];
  /** Every endpoint this snapshot was built from, in order. */
  endpoints: EndpointReceipt[];
  /** Every distinct endpoint path touched. */
  endpointPaths: string[];
  calls: number;
  failedCalls: number;
  creditsSpent: number;
  /** Problems found in the API's own data, detected on every refresh. */
  apiIssues: Snapshot['apiIssues'];
  /** What this data is, in one sentence a judge can read. */
  disclaimer: string;
}

/**
 * The receipts for a snapshot.
 *
 * This is the endpoint the brief asks for: the API calls, named, with the
 * status and the error code that came back. Nothing here is reconstructed
 * after the fact — it is the array the puller appended to as it went.
 */
export function buildProvenance(snapshot: Snapshot = SNAPSHOT): Provenance {
  const failed = snapshot.calls.filter((c) => c.errorCode !== 0);
  return {
    source: snapshot.source,
    generatedAt: snapshot.generatedAt,
    universe: snapshot.universe,
    scope: snapshot.scope,
    endpoints: snapshot.calls.map((c) => ({
      endpoint: c.endpoint,
      query: c.query,
      errorCode: c.errorCode,
      errorMessage: c.errorMessage,
      credits: c.credits,
      elapsedMs: c.elapsedMs,
      at: c.at,
    })),
    endpointPaths: [...new Set(snapshot.calls.map((c) => c.endpoint))].sort(),
    calls: snapshot.calls.length,
    failedCalls: failed.length,
    creditsSpent: snapshot.calls.reduce((sum, c) => sum + (c.credits ?? 0), 0),
    apiIssues: snapshot.apiIssues,
    disclaimer:
      snapshot.source === 'live'
        ? `Live CoinMarketCap pull from ${snapshot.generatedAt}. Every figure below comes from the calls listed here.`
        : `OFFLINE FIXTURE, not a live CoinMarketCap pull. Built from values observed in real responses on 2026-11-25 and arranged so every branch of the analysis is reachable. Run \`npm run snapshot\` with a live key to replace it.`,
  };
}

/** The analysis for a snapshot at one notional size. */
export function analyseAt(
  snapshot: Snapshot,
  sizeUsd: number,
  histories: Record<string, HistoryStats> = {},
): Analysis {
  const quotes = Object.fromEntries(
    Object.entries(snapshot.quotes ?? {}).map(([k, v]) => [Number(k), v]),
  ) as Record<number, TokenQuote>;
  const pools = Object.fromEntries(
    Object.entries(snapshot.pools ?? {}).map(([k, v]) => [Number(k), v]),
  ) as Record<number, Pool[]>;

  return analyse(snapshot, quotes, pools, {
    sizeUsd,
    now: Date.parse(snapshot.generatedAt),
    histories,
  });
}

export interface JudgeQuery {
  /** An asset symbol, slug or name. Omit for every asset. */
  asset?: string | null;
  /** The notional size to price. Defaults to the snapshot's own scope. */
  sizeUsd?: number | null;
}

export interface JudgeResult {
  /** The size every cost figure refers to. */
  sizeUsd: number;
  /** The asset that was judged, or null when the query covered all of them. */
  asset: string | null;
  /** The verdict counts. */
  byVerdict: Analysis['summary']['byVerdict'];
  capturableShare: number | null;
  /** The pairs, widest first. */
  crossings: Analysis['crossings'];
  /** The assets, with the trap flag and the notes. */
  assets: {
    symbol: string;
    name: string;
    slug: string;
    anchor: number | null;
    anchorMethod: string;
    trap: boolean;
    cheapestOnScreen: string | null;
    cheapestReachable: string | null;
    notes: string[];
    crossings: number;
  }[];
  /** Every asset in the snapshot, so a caller that guessed wrong can correct itself. */
  availableAssets: string[];
  provenance: Provenance;
}

/**
 * Re-judge the snapshot at a different notional size.
 *
 * Cost is not linear in size, so the verdict at $50k is not the verdict at
 * $1m scaled down. The pairs have to be re-run through the same judge, which
 * is exactly what this does — the same function the CLI calls.
 */
export function judgeAtSize(
  query: JudgeQuery,
  snapshot: Snapshot = SNAPSHOT,
  histories: Record<string, HistoryStats> = {},
): JudgeResult {
  const sizeUsd =
    query.sizeUsd != null && Number.isFinite(query.sizeUsd) && query.sizeUsd > 0
      ? query.sizeUsd
      : (snapshot.scope?.sizeUsd ?? 100_000);

  const analysis = analyseAt(snapshot, sizeUsd, histories);
  const wanted = query.asset?.trim().toLowerCase() ?? null;

  const availableAssets = analysis.assets.map((a) => a.asset.symbol);

  const assets = analysis.assets
    .filter((a) => {
      if (!wanted) return true;
      return (
        a.asset.symbol.toLowerCase() === wanted ||
        a.asset.slug.toLowerCase() === wanted ||
        a.asset.name.toLowerCase() === wanted
      );
    })
    .map((a) => ({
      symbol: a.asset.symbol,
      name: a.asset.name,
      slug: a.asset.slug,
      anchor: a.anchor,
      anchorMethod: a.anchorMethod,
      trap: a.trap,
      cheapestOnScreen: a.cheapestOnScreen?.wrapper.symbol ?? null,
      cheapestReachable: a.cheapestReachable?.wrapper.symbol ?? null,
      notes: a.notes,
      crossings: a.crossings.length,
    }));

  const crossings = wanted
    ? analysis.crossings.filter(
        (c) =>
          assets.some(
            (a) => a.symbol.toLowerCase() === c.assetSymbol.toLowerCase(),
          ),
      )
    : analysis.crossings;

  const counted = wanted ? crossings : analysis.crossings;
  const byVerdict = analysis.summary.byVerdict;
  const capturableShare =
    counted.length === 0
      ? null
      : (counted.filter((c) => c.verdict === 'capturable').length / counted.length) * 100;

  return {
    sizeUsd,
    asset: wanted,
    byVerdict,
    capturableShare,
    crossings: counted,
    assets,
    availableAssets,
    provenance: buildProvenance(snapshot),
  };
}

/** The findings for a snapshot — the problems the API itself has. */
export function findingsFor(snapshot: Snapshot = SNAPSHOT): {
  findings: ReturnType<typeof detectFindings>;
  apiIssues: Snapshot['apiIssues'];
} {
  const analysis = analyseAt(snapshot, snapshot.scope?.sizeUsd ?? 100_000);
  const quotes = Object.fromEntries(
    Object.entries(snapshot.quotes ?? {}).map(([k, v]) => [Number(k), v]),
  ) as Record<number, TokenQuote>;
  return { findings: detectFindings(snapshot, analysis, quotes), apiIssues: snapshot.apiIssues };
}

/** Read a query parameter that may arrive as a string or an array of strings. */
export function queryParam(
  query: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | null {
  const raw = query?.[name];
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/** Parse a notional size from a query string, refusing anything that is not a number. */
export function parseSize(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Summarise a history series the way the API reports it. */
export function summariseSeries(points: { timestamp: string; price: number | null }[]): HistoryStats {
  return summariseHistory(
    points.map((p) => ({
      timestamp: p.timestamp,
      price: p.price,
      tokenizedMarketCap: null,
      tokenizedVolume24h: null,
    })),
  );
}
