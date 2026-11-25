/**
 * The history pull.
 *
 * Fetches CoinMarketCap's own historical tokenized prices for the assets in the
 * snapshot, so the product can put today's cross-wrapper spread against the
 * asset's own history: how far it normally moves, whether today's level is
 * new, and how long the aggregate has been holding steady.
 *
 * This is a second, independent join. The RWA quotes endpoint gives us the
 * wrappers as they are now; the historical endpoint gives us the same asset's
 * aggregate as it was. Neither can answer the other's question.
 *
 * It writes `public/data/history.json` alongside the snapshot. It never
 * overwrites the snapshot: history is additive, and the snapshot must stay
 * reproducible on its own.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CmcClient, readApiKey } from './cmc.ts';
import { loadSnapshot } from '../src/lib/session.ts';
import { summariseHistory, stabilityOfSeries, type AssetHistory, type HistoryPoint } from '../src/lib/history.ts';
import type { ApiCall, ApiIssue, Receipt } from '../src/lib/types.ts';

const OUT_DIR = join(process.cwd(), 'public', 'data');
const EVIDENCE_DIR = join(process.cwd(), 'evidence');

const DEFAULT_DAYS = Number(process.env.CTS_HISTORY_DAYS ?? 30);
const DEFAULT_ASSETS = Number(process.env.CTS_HISTORY_ASSETS ?? 20);

/** One quote entry as /v5/real-world-assets/quotes/historical returns it. */
interface RawHistoryQuote {
  timestamp?: string;
  convert_id?: number;
  convert_symbol?: string;
  average_tokenized_price?: number | null;
  tokenized_market_cap?: number | null;
  tokenized_volume_24h?: number | null;
}

/** One asset as the historical endpoint returns it. */
interface RawHistoricalAsset {
  rwa_id?: number;
  name?: string;
  symbol?: string;
  slug?: string;
  asset_type?: string;
  rwa_rank?: number | null;
  has_tokens?: boolean;
  quotes?: RawHistoryQuote[];
}

export interface HistoryFile {
  generatedAt: string;
  source: 'live' | 'fixture';
  /** The window requested. */
  window: { days: number; start: string; end: string; interval: string };
  assets: AssetHistory[];
  calls: ApiCall[];
  apiIssues: ApiIssue[];
}

/**
 * Fetch the history for the assets in the snapshot.
 *
 * The endpoint takes a comma-separated list of `rwa_id`s, one identifier type
 * per request, and returns one object per requested asset in request order.
 */
export async function runHistory(options: { days?: number; assets?: number } = {}): Promise<HistoryFile> {
  const days = options.days ?? DEFAULT_DAYS;
  const assetLimit = options.assets ?? DEFAULT_ASSETS;

  const snapshot = loadSnapshot();
  const client = new CmcClient({
    apiKey: readApiKey(),
    evidenceDir: EVIDENCE_DIR,
    onCall: (receipt: Receipt) => {
      process.stdout.write(
        `  ${receipt.errorCode === 0 ? 'ok ' : `err ${receipt.errorCode} `}${receipt.endpoint}\n`,
      );
    },
  });

  const end = new Date(snapshot.generatedAt);
  const start = new Date(end.getTime() - days * 86_400_000);

  const wanted = snapshot.assets
    .filter((a) => a.rwaId != null)
    .sort((a, b) => (b.tokenizedMarketCap ?? 0) - (a.tokenizedMarketCap ?? 0))
    .slice(0, assetLimit);
  const ids = wanted.map((a) => a.rwaId as number);

  const apiIssues: HistoryFile['apiIssues'] = [];
  const assets: AssetHistory[] = [];

  if (!ids.length) {
    apiIssues.push({
      id: 'history-no-ids',
      title: 'No asset in the snapshot has an rwa_id, so no history can be fetched',
      detail:
        'The historical endpoint is addressed by rwa_id, rwa_slug or symbol. The snapshot contains no ids, so the history arm cannot run.',
      endpoint: '/v5/real-world-assets/quotes/historical',
      evidence: `${snapshot.assets.length} assets, 0 with an rwa_id`,
      severity: 2,
    });
  } else {
    process.stdout.write(`history: ${ids.length} assets, ${days} days, daily\n`);
    const res = await client.get<{ rwa_assets?: RawHistoricalAsset[] }>(
      '/v5/real-world-assets/quotes/historical',
      {
        rwa_id: ids.join(','),
        interval: 'daily',
        time_start: start.toISOString(),
        time_end: end.toISOString(),
        convert: 'USD',
      },
      { evidence: 'rwa-quotes-historical' },
    );

    const returned = res.data?.rwa_assets ?? [];

    if (res.receipt.errorCode !== 0) {
      apiIssues.push({
        id: 'history-refused',
        title: 'The historical endpoint refused the request',
        detail:
          `\`/v5/real-world-assets/quotes/historical\` returned error_code ${res.receipt.errorCode}` +
          `${res.receipt.errorMessage ? `: ${res.receipt.errorMessage}` : ''}. ` +
          'The documented plan window is one year of daily data and one month of hourly data on the free tier; a request outside it is refused with 1014. ' +
          'The history arm of this product is disabled until it is served, and the UI says so rather than showing an empty chart.',
        endpoint: '/v5/real-world-assets/quotes/historical',
        evidence: `error_code ${res.receipt.errorCode}: ${res.receipt.errorMessage ?? 'no message'}`,
        severity: 2,
        repro:
          'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/historical?rwa_id=1&interval=daily&time_start=2026-10-26&time_end=2026-11-25&convert=USD"',
      });
    }

    // The endpoint returns one object per requested asset, in request order —
    // but a missing asset comes back as an object with no quotes, not as an
    // absent object. Match on id rather than on position.
    for (const id of ids) {
      const raw = returned.find((r) => r.rwa_id === id) ?? returned.find((r) => !r.rwa_id);
      const points: HistoryPoint[] = (raw?.quotes ?? [])
        .filter((q) => q.convert_symbol === 'USD' || q.convert_id === 2781)
        .map((q) => ({
          timestamp: q.timestamp ?? '',
          price: q.average_tokenized_price ?? null,
          tokenizedMarketCap: q.tokenized_market_cap ?? null,
          tokenizedVolume24h: q.tokenized_volume_24h ?? null,
        }))
        .filter((p) => Boolean(p.timestamp))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

      const meta = wanted.find((a) => a.rwaId === id);
      assets.push({
        rwaId: id,
        symbol: raw?.symbol ?? meta?.symbol ?? '',
        name: raw?.name ?? meta?.name ?? '',
        slug: raw?.slug ?? meta?.slug ?? null,
        assetType: raw?.asset_type ?? meta?.assetType ?? null,
        points,
      });
    }

    const empty = assets.filter((a) => a.points.length === 0);
    if (empty.length && assets.length) {
      apiIssues.push({
        id: 'history-empty-series',
        title: 'The historical endpoint returns assets with no points at all',
        detail:
          `${empty.length} of ${assets.length} requested assets came back with an empty \`quotes\` array. The endpoint documents \`quotes\` as empty when the asset has no tokens or no data in the window, but it does not say which of the two it is — there is no status field on the asset. A consumer cannot distinguish "this asset was never tokenized" from "this asset was not tokenized yet in this window" from "the data is missing".`,
        endpoint: '/v5/real-world-assets/quotes/historical',
        evidence: `empty series: ${empty.map((a) => `${a.symbol}(${a.rwaId})`).join(', ')}`,
        severity: 2,
        repro:
          'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/historical?rwa_id=1&interval=daily&time_start=2026-10-26&time_end=2026-11-25&convert=USD"',
        suggestedFix:
          'Return a per-asset status (no tokens / no data in window / not covered) so an empty series is explicable.',
      });
    }
  }

  const file: HistoryFile = {
    generatedAt: new Date().toISOString(),
    source: 'live',
    window: {
      days,
      start: start.toISOString(),
      end: end.toISOString(),
      interval: 'daily',
    },
    assets,
    calls: client.calls,
    apiIssues,
  };

  return file;
}

/** Summarise a history file for the console and for the UI. */
export function summarise(file: HistoryFile): Record<string, unknown>[] {
  return file.assets.map((a) => {
    const stats = summariseHistory(a.points);
    const stability = stabilityOfSeries(a.points);
    return {
      symbol: a.symbol,
      observations: stats.observations,
      thin: stats.thin,
      medianAbsMoveBps: stats.medianAbsMoveBps,
      p95AbsMoveBps: stats.p95AbsMoveBps,
      maxAbsMoveBps: stats.maxAbsMoveBps,
      totalMoveBps: stats.totalMoveBps,
      flatStreakDays: stability.flatStreakDays,
      brokeOut: stability.brokeOut,
      note: stability.note,
    };
  });
}

async function main(): Promise<void> {
  const file = await runHistory();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'history.json'), `${JSON.stringify(file, null, 2)}\n`);

  const rows = summarise(file);
  process.stdout.write(`\nhistory written: ${file.assets.length} assets, ${file.calls.length} calls\n\n`);
  for (const row of rows) {
    const median = row.medianAbsMoveBps == null ? '—' : `${(row.medianAbsMoveBps as number).toFixed(1)} bps`;
    process.stdout.write(
      `  ${String(row.symbol).padEnd(8)} ${String(row.observations).padStart(3)} obs   ` +
        `median daily move ${median.padStart(12)}   ${row.note}\n`,
    );
  }
  if (file.apiIssues.length) {
    process.stdout.write(`\n${file.apiIssues.length} API issue(s) recorded in the history file\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}

/** True when a history file exists to be read. */
export function historyExists(): boolean {
  return existsSync(join(OUT_DIR, 'history.json'));
}
