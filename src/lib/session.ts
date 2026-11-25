/**
 * One place where a snapshot becomes an analysis.
 *
 * The CLI, the MCP server and the web UI all come through here, so the number
 * a judge sees in a terminal, the number an agent sees through MCP, and the
 * number on a web page are the same number computed once from the same file.
 *
 * Pure: it reads a snapshot from disk and returns an analysis. It never calls
 * the network, so it can be run by anyone who has cloned the repository.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyse, detectFindings, type Analysis, type Finding } from './analysis.ts';
import type { AssetAnalysis } from './analysis.ts';
import { summariseHistory, type HistoryStats } from './history.ts';
import type { Pool, Snapshot, TokenQuote } from './types.ts';

/** Where the committed snapshot lives. */
export const SNAPSHOT_PATH = join(process.cwd(), 'public', 'data', 'snapshot.json');
/** Where the optional history pull lives. */
export const HISTORY_PATH = join(process.cwd(), 'public', 'data', 'history.json');

export interface Session {
  snapshot: Snapshot;
  analysis: Analysis;
  findings: Finding[];
  quotes: Record<number, TokenQuote>;
  pools: Record<number, Pool[]>;
  /** True when the snapshot came from the offline fixture rather than the API. */
  isFixture: boolean;
  /** Per-asset history statistics, keyed by asset symbol. Empty when no history was pulled. */
  histories: Record<string, HistoryStats>;
}

/** Load a snapshot from disk. Throws a message a human can act on. */
export function loadSnapshot(path: string = SNAPSHOT_PATH): Snapshot {
  if (!existsSync(path)) {
    throw new Error(
      `No snapshot at ${path}.\n` +
        'Run `npm run seed` for an offline fixture, or `npm run snapshot` with a live API key.\n' +
        'Get a key at https://coinmarketcap.com/api',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `The snapshot at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parsed as Snapshot;
}

/** Build a session from a snapshot: the analysis, the findings, the indexes. */
export function buildSession(
  snapshot: Snapshot,
  sizeUsd?: number,
  histories: Record<string, HistoryStats> = {},
): Session {
  const quotes = Object.fromEntries(
    Object.entries(snapshot.quotes ?? {}).map(([k, v]) => [Number(k), v]),
  ) as Record<number, TokenQuote>;
  const pools = Object.fromEntries(
    Object.entries(snapshot.pools ?? {}).map(([k, v]) => [Number(k), v]),
  ) as Record<number, Pool[]>;

  const analysis = analyse(snapshot, quotes, pools, {
    sizeUsd: sizeUsd ?? snapshot.scope?.sizeUsd ?? 100_000,
    now: Date.parse(snapshot.generatedAt),
    histories,
  });
  const findings = detectFindings(snapshot, analysis, quotes);

  return {
    snapshot,
    analysis,
    findings,
    quotes,
    pools,
    isFixture: snapshot.source === 'fixture',
    histories,
  };
}

/**
 * Load the history file if there is one.
 *
 * History is optional by design: the snapshot is the product's source of truth
 * and must work on its own. When history is absent, the product says the
 * time-series arm is unavailable — it does not pretend the spread is safe.
 */
export function loadHistories(path: string = HISTORY_PATH): Record<string, HistoryStats> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  const file = parsed as {
    assets?: { symbol?: string; points?: { timestamp: string; price: number | null }[] }[];
  };
  const out: Record<string, HistoryStats> = {};
  for (const asset of file.assets ?? []) {
    if (!asset.symbol) continue;
    const points = (asset.points ?? []).map((p) => ({
      timestamp: p.timestamp,
      price: p.price ?? null,
      tokenizedMarketCap: null,
      tokenizedVolume24h: null,
    }));
    out[asset.symbol.toUpperCase()] = summariseHistory(points);
  }
  return out;
}

/** Load a snapshot from disk and analyse it in one step. */
export function openSession(path: string = SNAPSHOT_PATH, sizeUsd?: number): Session {
  return buildSession(loadSnapshot(path), sizeUsd, loadHistories());
}

/** Find an asset by symbol, slug or name. Case-insensitive, exact first. */
export function findAsset(session: Session, query: string): AssetAnalysis | null {
  const q = query.trim().toLowerCase();
  const assets = session.analysis.assets;
  return (
    assets.find((a) => a.asset.symbol.toLowerCase() === q) ??
    assets.find((a) => a.asset.slug.toLowerCase() === q) ??
    assets.find((a) => a.asset.name.toLowerCase() === q) ??
    assets.find((a) => a.asset.symbol.toLowerCase().startsWith(q)) ??
    null
  );
}

/** Find a wrapper of an asset by symbol, case-insensitive. */
export function findWrapper(asset: AssetAnalysis, symbol: string): AssetAnalysis['rows'][number] | null {
  const s = symbol.trim().toLowerCase();
  return (
    asset.rows.find((r) => r.wrapper.symbol.toLowerCase() === s) ??
    asset.rows.find((r) => r.wrapper.name.toLowerCase() === s) ??
    null
  );
}
