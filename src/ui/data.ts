/**
 * The data layer of the front-end.
 *
 * The screen and the data file run the same code: `analyse` and
 * `detectFindings` from `src/lib/analysis.ts`, over the snapshot the API
 * returned. Nothing here computes a number of its own.
 *
 * The history file is optional and is treated as optional everywhere: when it
 * is missing the product says the time-series arm is unavailable, rather than
 * showing an empty chart or, worse, implying the asset is calm.
 */

import { analyse, detectFindings, type Analysis, type Finding } from '../lib/analysis.ts';
import { summariseHistory, type HistoryStats } from '../lib/history.ts';
import type { Pool, Snapshot, TokenQuote } from '../lib/types.ts';

export interface AppData {
  snapshot: Snapshot;
  analysis: Analysis;
  findings: Finding[];
  quotes: Record<number, TokenQuote>;
  pools: Record<number, Pool[]>;
  /** True when the snapshot is the offline fixture rather than a live pull. */
  isFixture: boolean;
  /** The reference time every freshness figure is measured against. */
  now: number;
  /** Per-asset history statistics, keyed by asset symbol. Empty when there is no history. */
  histories: Record<string, HistoryStats>;
  /** The raw history series, keyed by asset symbol, for the chart. */
  series: Record<string, { timestamp: string; price: number | null }[]>;
  /** True when a history file was found and read. */
  hasHistory: boolean;
}

/**
 * Build the analysis from a raw snapshot.
 *
 * `quotes` and `pools` are keyed by string in the file; the analysis layer
 * wants them keyed by the wrapper's numeric `crypto_id`.
 */
export function buildData(
  snapshot: Snapshot,
  history?: { assets?: { symbol?: string; points?: { timestamp: string; price: number | null }[] }[] } | null,
): AppData {
  const quotes = Object.fromEntries(
    Object.entries(snapshot.quotes ?? {}).map(([k, v]) => [Number(k), v]),
  ) as Record<number, TokenQuote>;
  const pools = Object.fromEntries(
    Object.entries(snapshot.pools ?? {}).map(([k, v]) => [Number(k), v]),
  ) as Record<number, Pool[]>;

  // History, when it was pulled. Keyed by symbol, upper-cased, because that is
  // how the analysis layer looks it up.
  const histories: Record<string, HistoryStats> = {};
  const series: Record<string, { timestamp: string; price: number | null }[]> = {};
  for (const asset of history?.assets ?? []) {
    if (!asset.symbol) continue;
    const points = (asset.points ?? []).map((p) => ({
      timestamp: p.timestamp,
      price: p.price ?? null,
      tokenizedMarketCap: null,
      tokenizedVolume24h: null,
    }));
    const key = asset.symbol.toUpperCase();
    histories[key] = summariseHistory(points);
    series[key] = points;
  }

  const now = Date.parse(snapshot.generatedAt);
  const analysis = analyse(snapshot, quotes, pools, {
    sizeUsd: snapshot.scope.sizeUsd,
    now,
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
    now,
    histories,
    series,
    hasHistory: Object.keys(histories).length > 0,
  };
}

/**
 * Where the built site is served from.
 *
 * '/' for a root domain, '/Coin/' for GitHub Pages, where a project lives
 * under a subpath. Vite writes the same value into the bundle, so the data
 * files are found wherever the site is hosted.
 */
const BASE = import.meta.env.BASE_URL;

/**
 * Fetch the snapshot the build ships with, from the static server.
 *
 * The history file is fetched alongside it, and a missing history file is not
 * an error: the snapshot alone is a complete product. The time-series arm is
 * an addition, and the UI says which arms it has.
 */
export async function loadData(
  url = `${BASE}data/snapshot.json`,
  historyUrl = `${BASE}data/history.json`,
): Promise<AppData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not load ${url}: HTTP ${response.status} ${response.statusText}. ` +
        'The snapshot is expected in public/data/snapshot.json.',
    );
  }
  const snapshot = (await response.json()) as Snapshot;

  let history: { assets?: { symbol?: string; points?: { timestamp: string; price: number | null }[] }[] } | null =
    null;
  try {
    const historyResponse = await fetch(historyUrl);
    if (historyResponse.ok) {
      history = (await historyResponse.json()) as typeof history;
    }
  } catch {
    // A history file that cannot be fetched is simply not there.
    history = null;
  }

  return buildData(snapshot, history);
}
