/**
 * The data pipeline.
 *
 * Pulls CoinMarketCap once, writes the raw result to `public/data/snapshot.json`,
 * and lets the pure analysis layer do the arithmetic. Nothing is computed twice
 * and nothing is computed here that the analysis layer will not recompute.
 *
 * Two tiers, on purpose:
 *   Tier A — the whole listed universe: assets, wrappers, per-token quotes.
 *            Cheap, ~15 credits, and it is what the universe-scale statistics
 *            are built on.
 *   Tier B — depth: DEX pools for the liquid wrappers of the top assets by
 *            tokenized market cap. This is where the money goes, and the
 *            selection rule is written down so the sample is not a mystery.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CmcClient, readApiKey } from './cmc.ts';
import type {
  ApiIssue,
  Issuer,
  Pool,
  Receipt,
  RwaAsset,
  Snapshot,
  TokenDeployment,
  TokenQuote,
  Wrapper,
} from '../src/lib/types.ts';

const OUT_DIR = join(process.cwd(), 'public', 'data');
const EVIDENCE_DIR = join(process.cwd(), 'evidence');

/** How many assets to pull from the RWA list endpoint. */
const DEFAULT_ASSET_LIMIT = Number(process.env.CTS_ASSET_LIMIT ?? 250);
/** How many assets get the deeper DEX-pool scan. */
const DEFAULT_DEPTH_ASSET_LIMIT = Number(process.env.CTS_DEPTH_ASSETS ?? 60);
/** How many wrappers per asset get a DEX-pool lookup. */
const DEFAULT_DEPTH_WRAPPERS = Number(process.env.CTS_DEPTH_WRAPPERS ?? 4);
/** How many ids to put in one id-parameter call. */
const ID_BATCH = 50;
/** The notional size every cost figure refers to. */
const DEFAULT_SIZE_USD = Number(process.env.CTS_SIZE_USD ?? 100_000);

/** Overrides for one pull. */
export interface SnapshotOptions {
  /** How many assets to pull from the RWA list endpoint. */
  assetLimit?: number;
  /** How many assets get the deeper DEX-pool scan. */
  depthAssetLimit?: number;
  /** How many wrappers per asset get a DEX-pool lookup. */
  depthWrappers?: number;
  /** The notional size every cost figure refers to. */
  sizeUsd?: number;
  /** Called after every API call, for live progress output. */
  onCall?: (receipt: Receipt) => void;
}

const ASSET_TYPES = [
  'stock',
  'etf',
  'commodity',
  'currency',
  'government_security',
  'real_estate',
] as const;

interface RawToken {
  symbol?: string;
  name?: string;
  crypto_id?: number;
  issuer_id?: string | null;
  issuer_name?: string | null;
  price?: number | null;
  market_cap?: number | null;
  volume_24h?: number | null;
}

interface RawQuoteAsset {
  name?: string;
  symbol?: string;
  slug?: string;
  rwa_id?: number | null;
  asset_type?: string;
  rwa_rank?: number;
  has_tokens?: boolean;
  average_tokenized_price?: number | null;
  tokenized_market_cap?: number | null;
  tokenized_volume_24h?: number | null;
  last_updated?: string | null;
  tradfi_markets?: {
    exchange?: { slug?: string; name?: string; exchange_id?: number } | string | null;
    ticker?: string;
    market_url?: string;
    url?: string;
  }[];
  tokens?: RawToken[];
}

interface RawListAsset extends RawQuoteAsset {
  quotes?: { symbol?: string; last_updated?: string | null }[];
}

interface RawInfoAsset {
  name?: string;
  symbol?: string;
  slug?: string;
  rwa_id?: number | null;
  asset_type?: string;
  website?: string | null;
  employees?: number | null;
  founded?: string | null;
  industry?: string | null;
  cik?: string | null;
  about?: { description?: string } | null;
  primary_exchange?: string | null;
}

interface RawCryptoInfo {
  id: number;
  name?: string;
  symbol?: string;
  logo?: string | null;
  platform?: {
    id?: number;
    name?: string;
    slug?: string;
    token_address?: string | null;
    contract_address?: string | null;
  } | null;
  contract_address?: {
    platform?: { name?: string; slug?: string } | string | null;
    platform_name?: string | null;
    contract_address?: string | null;
    address?: string | null;
    token_address?: string | null;
  }[];
  'tag-names'?: string[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toWrapper(token: RawToken): Wrapper | null {
  if (!token.crypto_id) return null;
  return {
    cryptoId: token.crypto_id,
    symbol: token.symbol ?? '',
    name: token.name ?? '',
    issuerId: token.issuer_id ?? null,
    issuerName: token.issuer_name ?? null,
    price: token.price ?? null,
    marketCap: token.market_cap ?? null,
    volume24h: token.volume_24h ?? null,
  };
}

/**
 * Pull the universe from CoinMarketCap and write the snapshot.
 *
 * Returns the snapshot it wrote, so a caller (the CLI, a test) can use it
 * without re-reading the file.
 */
export async function runSnapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
  const ASSET_LIMIT = options.assetLimit ?? DEFAULT_ASSET_LIMIT;
  const DEPTH_ASSET_LIMIT = options.depthAssetLimit ?? DEFAULT_DEPTH_ASSET_LIMIT;
  const DEPTH_WRAPPERS_PER_ASSET = options.depthWrappers ?? DEFAULT_DEPTH_WRAPPERS;
  const SIZE_USD = options.sizeUsd ?? DEFAULT_SIZE_USD;

  const apiKey = readApiKey();
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const client = new CmcClient({
    apiKey,
    evidenceDir: EVIDENCE_DIR,
    onCall:
      options.onCall ??
      ((receipt) => {
        const mark = receipt.errorCode === 0 ? '·' : '!';
        process.stdout.write(
          `  ${mark} ${receipt.endpoint} ${receipt.httpStatus} ${receipt.credits}cr ${receipt.elapsedMs}ms\n`,
        );
      }),
  });

  const apiIssues: ApiIssue[] = [];
  const generatedAt = new Date().toISOString();

  // ── Tier A0: universe size per asset type. Free, and it frames everything. ──
  process.stdout.write('\nuniverse\n');
  const byType: Record<string, number> = {};
  for (const type of ASSET_TYPES) {
    const res = await client.get<{ rwa_assets?: unknown[]; total_size?: number }>(
      '/v5/real-world-assets/map',
      { asset_type: type, limit: 1 },
      { evidence: `rwa-map-${type}` },
    );
    byType[type] = res.data?.total_size ?? 0;
  }
  const universeTotal = Object.values(byType).reduce((s, v) => s + v, 0);

  // ── Tier A1: the listed universe, ranked by tokenized market cap. ──
  process.stdout.write('\nassets/list\n');
  const listRes = await client.get<{ rwa_assets?: RawListAsset[]; total_size?: number }>(
    '/v5/real-world-assets/assets/list',
    { limit: ASSET_LIMIT, sort: 'tokenized_market_cap', sort_dir: 'desc' },
    { evidence: 'rwa-assets-list' },
  );
  const listed = listRes.data?.rwa_assets ?? [];

  // ── Tier A2: every wrapper of every listed asset, in batches. ──
  process.stdout.write('\nquotes/latest\n');
  const ids = listed
    .map((a) => a.rwa_id)
    .filter((id): id is number => typeof id === 'number');
  const skipped = listed.filter((a) => typeof a.rwa_id !== 'number');
  if (skipped.length) {
    apiIssues.push({
      id: 'null-rwa-id',
      title: 'Listed assets with no rwa_id cannot be fetched back',
      detail: `${skipped.length} assets in the list have rwa_id: null, so they cannot be passed into quotes/latest.`,
      endpoint: '/v5/real-world-assets/assets/list',
      evidence: skipped
        .slice(0, 5)
        .map((a) => `${a.symbol}: rwa_id=null, cap=$${Math.round(a.tokenized_market_cap ?? 0).toLocaleString('en-US')}`)
        .join('; '),
      severity: 2,
    });
  }

  const quoted = new Map<number, RawQuoteAsset>();
  for (const batch of chunk(ids, 100)) {
    const res = await client.get<{ rwa_assets?: RawQuoteAsset[] }>(
      '/v5/real-world-assets/quotes/latest',
      { rwa_id: batch.join(',') },
      { evidence: 'rwa-quotes-latest' },
    );
    for (const asset of res.data?.rwa_assets ?? []) {
      if (typeof asset.rwa_id === 'number') quoted.set(asset.rwa_id, asset);
    }
  }

  // ── Tier A3: profiles, so an asset can show what it is. ──
  process.stdout.write('\nrwa/info\n');
  const infoById = new Map<number, RawInfoAsset>();
  for (const batch of chunk(ids, 100)) {
    const res = await client.get<{ rwa_assets?: RawInfoAsset[] }>(
      '/v5/real-world-assets/info',
      { rwa_id: batch.join(','), skip_invalid: true },
      { evidence: 'rwa-info' },
    );
    for (const asset of res.data?.rwa_assets ?? []) {
      if (typeof asset.rwa_id === 'number') infoById.set(asset.rwa_id, asset);
    }
  }

  // ── Tier A4: the issuers behind the wrappers. ──
  process.stdout.write('\nissuers/list\n');
  const issuerRes = await client.get<{ issuers?: Issuer[] }>(
    '/v5/real-world-assets/issuers/list',
    { limit: 250 },
    { evidence: 'rwa-issuers-list' },
  );
  const issuers = issuerRes.data?.issuers ?? [];

  // ── Tier A5: build the asset list. ──
  const assets: RwaAsset[] = [];
  for (const listAsset of listed) {
    const quote = typeof listAsset.rwa_id === 'number' ? quoted.get(listAsset.rwa_id) : undefined;
    const info = typeof listAsset.rwa_id === 'number' ? infoById.get(listAsset.rwa_id) : undefined;
    const source = quote ?? listAsset;
    const wrappers = (source.tokens ?? [])
      .map(toWrapper)
      .filter((w): w is Wrapper => w !== null);
    assets.push({
      rwaId: typeof listAsset.rwa_id === 'number' ? listAsset.rwa_id : null,
      name: source.name ?? listAsset.name ?? '',
      symbol: source.symbol ?? listAsset.symbol ?? '',
      slug: source.slug ?? listAsset.slug ?? '',
      assetType: (source.asset_type ?? 'other') as RwaAsset['assetType'],
      rank: source.rwa_rank ?? null,
      avgTokenizedPrice: source.average_tokenized_price ?? null,
      tokenizedMarketCap: source.tokenized_market_cap ?? null,
      tokenizedVolume24h: source.tokenized_volume_24h ?? null,
      lastUpdated: source.last_updated ?? null,
      description: info?.about?.description ?? null,
      industry: info?.industry ?? null,
      website: info?.website ?? null,
      primaryExchange: info?.primary_exchange ?? null,
      tradfiMarkets: (source.tradfi_markets ?? []).map((m) => {
        // `exchange` is an object in the live payload, but a bare string in some
        // responses. Accept either rather than rendering "[object Object]".
        const ex = m.exchange;
        return {
          exchange: typeof ex === 'string' ? ex : (ex?.name ?? null),
          exchangeSlug: typeof ex === 'string' ? null : (ex?.slug ?? null),
          ticker: m.ticker ?? null,
          url: m.market_url ?? m.url ?? null,
        };
      }),
      wrappers,
    });
  }

  // ── Tier A6: every wrapper token's own deployment and its own quote. ──
  const cryptoIds = [
    ...new Set(assets.flatMap((a) => a.wrappers.map((w) => w.cryptoId))),
  ];
  process.stdout.write(`\ncryptocurrency/info (${cryptoIds.length} tokens)\n`);

  const deployments: Record<string, TokenDeployment> = {};
  for (const batch of chunk(cryptoIds, ID_BATCH)) {
    const res = await client.get<Record<string, RawCryptoInfo>>(
      '/v2/cryptocurrency/info',
      { id: batch.join(','), skip_invalid: true, aux: 'logo,platform,contract_address' },
      { evidence: 'crypto-info' },
    );
    for (const [key, info] of Object.entries(res.data ?? {})) {
      const contracts: Record<string, string> = {};
      for (const c of info.contract_address ?? []) {
        const chain =
          typeof c.platform === 'string'
            ? c.platform
            : (c.platform?.name ?? c.platform_name ?? null);
        // The address field has been spelled three ways across API versions.
        const address = c.contract_address ?? c.address ?? c.token_address ?? null;
        if (chain && address) contracts[chain] = address;
      }
      if (info.platform?.contract_address && info.platform?.name) {
        contracts[info.platform.name] = info.platform.contract_address;
      }
      const chains = Object.keys(contracts);
      deployments[key] = {
        cryptoId: Number(info.id ?? key),
        logo: info.logo ?? null,
        platform: info.platform?.name ?? chains[0] ?? null,
        platformSlug: info.platform?.slug ?? null,
        chains,
        contracts,
      };
    }
  }

  process.stdout.write(`\ncryptocurrency/quotes/latest (${cryptoIds.length} tokens)\n`);
  const quotes: Record<string, TokenQuote> = {};
  for (const batch of chunk(cryptoIds, ID_BATCH)) {
    const res = await client.get<Record<string, unknown>>(
      '/v2/cryptocurrency/quotes/latest',
      { id: batch.join(','), convert: 'USD' },
      { evidence: 'crypto-quotes-latest' },
    );
    for (const [key, raw] of Object.entries(res.data ?? {})) {
      const q = raw as {
        id?: number;
        name?: string;
        symbol?: string;
        price?: number;
        volume_24h?: number;
        market_cap?: number;
        last_updated?: string;
        percent_change_24h?: number;
        is_stale?: number;
      };
      quotes[key] = {
        cryptoId: Number(q.id ?? key),
        symbol: q.symbol ?? '',
        name: q.name ?? '',
        price: q.price ?? null,
        volume24h: q.volume_24h ?? null,
        marketCap: q.market_cap ?? null,
        lastUpdated: q.last_updated ?? null,
        percentChange24h: q.percent_change_24h ?? null,
        isStale: q.is_stale === 1,
      };
    }
  }

  // ── Tier B0: the DEX platform list, so chain names become slugs the DEX
  // endpoints actually accept. CoinMarketCap does not publish the enum, so it
  // is fetched rather than guessed.
  //
  // The response uses single-letter keys (`n` for the name, `pltA` for the
  // acronym) and — verified against the live response on 2026-11-25 — it
  // carries no `network_slug` at all. The endpoint that does document
  // `network_slug`, /v4/dex/networks/list, is deprecated and refuses anonymous
  // access with error 1005. So the slug convention has to be discovered, not
  // read. We build a list of candidates per chain and try them in order.
  process.stdout.write('\ndex/platform/list\n');
  const platformRes = await client.get<RawPlatform[]>('/v1/dex/platform/list', {}, {
    evidence: 'dex-platform-list',
  });
  const platformList = platformRes.data ?? [];
  const platformsByName = new Map<string, RawPlatform>();
  for (const p of platformList) {
    if (p.n) platformsByName.set(p.n.toLowerCase(), p);
  }
  /** Slugs that proved to work, so the next refresh tries them first. */
  const workingSlugs = new Map<string, string>();
  if (!platformList.length) {
    apiIssues.push({
      id: 'dex-platform-list',
      title: 'The DEX endpoints take a platform slug that is not published anywhere',
      detail:
        '/v1/dex/token/pools asks for a "platform name" but the API reference lists no allowed values, and the naming does not match the platform names CoinMarketCap uses elsewhere in its own payloads. We fetch /v1/dex/platform/list to map between them; if that call is refused we fall back to a hand-written map.',
      endpoint: '/v1/dex/platform/list',
      evidence: `error_code ${platformRes.receipt.errorCode}: ${platformRes.receipt.errorMessage ?? 'no platform list returned'}`,
      severity: 2,
      repro:
        'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v1/dex/platform/list"',
      suggestedFix:
        'Publish the allowed `platform` values for the DEX endpoints, or accept the same platform slug the rest of the API uses.',
    });
  } else {
    // The finding is not that the call failed — it is that it succeeded and
    // still did not tell us the answer.
    const hasSlug = platformList.some((p) =>
      Object.prototype.hasOwnProperty.call(p, 'network_slug'),
    );
    if (!hasSlug) {
      apiIssues.push({
        id: 'dex-platform-list-no-slug',
        title: 'The endpoint that lists the DEX platforms does not carry the slug the DEX endpoints require',
        detail:
          `/v1/dex/platform/list returns ${platformList.length} platforms under single-letter keys (\`n\` for the name, \`pltA\` for the acronym) and no \`network_slug\` field. But /v4/dex/pairs/quotes/latest requires a \`network_slug\` and /v1/dex/token/pools requires a \`platform\`, and the reference documents no allowed values for either. The only endpoint that does carry \`network_slug\`, /v4/dex/networks/list, is marked deprecated and refuses anonymous calls with error_code 1005. A consumer therefore has to guess which of \`n\`, \`pltA\` or a hand-written slug the DEX endpoints accept — we try each in turn and record which one worked.`,
        endpoint: '/v1/dex/platform/list',
        evidence: `${platformList.length} platforms; keys seen: ${[...new Set(platformList.flatMap((p) => Object.keys(p)))].sort().join(', ')}`,
        severity: 2,
        repro:
          'curl "https://pro-api.coinmarketcap.com/public-api/v1/dex/platform/list" && curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v4/dex/networks/list"',
        suggestedFix:
          'Include `network_slug` on /v1/dex/platform/list, or list the accepted values for `platform` and `network_slug` in the reference.',
      });
    }
  }

  // ── Tier B: DEX depth for the liquid wrappers of the top assets. ──
  process.stdout.write('\ndex depth\n');
  const pools: Record<string, Pool[]> = {};
  let depthScanned = 0;
  const depthAssets = assets
    .filter((a) => a.tokenizedMarketCap != null)
    .sort((a, b) => (b.tokenizedMarketCap as number) - (a.tokenizedMarketCap as number))
    .slice(0, DEPTH_ASSET_LIMIT);

  for (const asset of depthAssets) {
    const candidates = asset.wrappers
      .filter((w) => w.volume24h != null && w.volume24h > 0)
      .sort((a, b) => (b.volume24h as number) - (a.volume24h as number))
      .slice(0, DEPTH_WRAPPERS_PER_ASSET);

    for (const wrapper of candidates) {
      const deployment = deployments[String(wrapper.cryptoId)];
      if (!deployment) continue;
      const chains = Object.entries(deployment.contracts);
      if (!chains.length) {
        pools[String(wrapper.cryptoId)] = [];
        continue;
      }
      // Look up the chain with the most tokens, which is the chain CMC considers primary.
      const chain = chains[0];
      if (!chain) {
        pools[String(wrapper.cryptoId)] = [];
        continue;
      }
      const address = chain[1];
      const candidates = dexPlatformCandidates(
        deployment.platform ?? chain[0],
        platformsByName,
        workingSlugs,
      );

      // Try each candidate slug until one returns pools. The slug convention is
      // not published, so this is discovery, not lookup — and the slug that
      // worked is recorded so the next refresh starts from it.
      let pairs: RawDexPair[] = [];
      let dexPlatform = candidates[0] ?? chain[0];
      for (const candidate of candidates) {
        const pairsRes = await client.get<RawDexPair[]>(
          '/v4/dex/pairs/quotes/latest',
          { contract_address: address, network_slug: candidate, skip_invalid: true },
          { evidence: 'dex-pairs-quotes' },
        );
        pairs = pairsRes.data ?? [];
        if (pairs.length) {
          dexPlatform = candidate;
          break;
        }
      }

      // Fallback: the token pools endpoint, which lists every pool for a token.
      if (!pairs.length) {
        const list: RawPool[] = [];
        for (const candidate of candidates.slice(0, 2)) {
          const poolsRes = await client.get<RawPool[]>(
            '/v1/dex/token/pools',
            { platform: candidate, address, size: 20 },
            { evidence: 'dex-token-pools' },
          );
          const found = poolsRes.data ?? [];
          if (found.length) {
            dexPlatform = candidate;
            list.push(...found);
            break;
          }
        }
        pools[String(wrapper.cryptoId)] = list.map((p) => ({
          poolAddress: p.addr ?? '',
          dexName: p.exn ?? null,
          platform: chain[0],
          liquidityUsd: num(p.liqUsd),
          baseTokenSymbol: p.t0?.sym ?? null,
          quoteTokenSymbol: p.t1?.sym ?? null,
          volume24h: num(p.v24),
          createdAt: epochToIso(p.pubAt),
          source: 'dex/token/pools' as const,
        }));
      } else {
        pools[String(wrapper.cryptoId)] = pairs.map((pair) => {
          const q = pair.quote?.[0];
          return {
            poolAddress: pair.contract_address ?? '',
            dexName: pair.dex_slug ?? null,
            platform: chain[0],
            liquidityUsd: num(q?.liquidity),
            baseTokenSymbol: pair.base_asset?.symbol ?? null,
            quoteTokenSymbol: pair.quote_asset?.symbol ?? null,
            volume24h: num(q?.volume_24h),
            createdAt: pair.date_launched ?? null,
            source: 'dex/pairs/quotes/latest' as const,
            lastUpdated: q?.last_updated ?? null,
          };
        });
      }
      // Remember which slug worked, so the next refresh tries it first.
      if (platformsByName.has(chain[0].toLowerCase())) {
        workingSlugs.set(chain[0].toLowerCase(), dexPlatform);
      }
      depthScanned += 1;
    }
  }

  // ── The probe: a documented endpoint our plan refuses. This is a finding. ──
  process.stdout.write('\nprobing market-pairs/list\n');
  const probeSymbol = assets.find((a) => a.tradfiMarkets.length)?.symbol ?? assets[0]?.symbol;
  if (probeSymbol) {
    const res = await client.get(
      '/v5/real-world-assets/market-pairs/list',
      { symbol: probeSymbol, limit: 5 },
      { evidence: 'rwa-market-pairs' },
    );
    if (res.failed) {
      apiIssues.push({
        id: 'market-pairs-plan',
        title: 'The endpoint that would show where tokenized assets actually quote is plan-gated',
        detail:
          '/v5/real-world-assets/market-pairs/list is listed for every plan in the reference, but it is refused on the key this project was given. Without it there is no venue-level view of tokenized-asset liquidity, so execution cost can only be estimated from DEX pools.',
        endpoint: '/v5/real-world-assets/market-pairs/list',
        evidence: `error_code ${res.receipt.errorCode}: ${res.receipt.errorMessage ?? 'unknown error'}`,
        severity: 3,
        repro: `curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/market-pairs/list?symbol=${probeSymbol}&limit=5"`,
        suggestedFix:
          'Align the plan table in the reference with the actual gating, and name the minimum plan in the error message so a consumer can tell whether to upgrade or work around it.',
      });
    }
  }

  const snapshot: Snapshot = {
    generatedAt,
    source: 'live',
    universe: {
      totalAssets: universeTotal,
      byType: byType as Snapshot['universe']['byType'],
      issuers: issuers.length,
    },
    assets,
    issuers,
    deployments,
    quotes,
    pools,
    calls: client.calls,
    apiIssues,
    scope: {
      assetsRequested: ASSET_LIMIT,
      depthScannedWrappers: depthScanned,
      depthSelectionRule:
        `the ${DEPTH_ASSET_LIMIT} assets with the largest tokenized market cap, and within each the ${DEPTH_WRAPPERS_PER_ASSET} wrappers with the largest reported 24h volume`,
      sizeUsd: SIZE_USD,
      credits: client.creditsUsed,
      calls: client.calls.length,
    },
  };

  writeFileSync(join(OUT_DIR, 'snapshot.json'), `${JSON.stringify(snapshot)}\n`);
  const pretty = join(OUT_DIR, 'snapshot.pretty.json');
  writeFileSync(pretty, `${JSON.stringify(snapshot, null, 2)}\n`);

  process.stdout.write(
    `\nsnapshot written: ${assets.length} assets, ${cryptoIds.length} wrappers, ${depthScanned} depth lookups, ` +
      `${client.calls.length} calls, ${client.creditsUsed} credits\n`,
  );

  return snapshot;
}

async function main(): Promise<void> {
  await runSnapshot();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}

/**
 * CMC names chains in prose ("Binance Smart Chain (BEP20)") and by slug
 * ("binance-smart-chain-bsc"); the DEX endpoints want neither — they want
 * "bsc". Both spellings are mapped here, and the mapping is written down so a
 * reader can check it.
 */
function slugFor(platform: string): string {
  const map: Record<string, string> = {
    ethereum: 'ethereum',
    'bnb smart chain (bep20)': 'bsc',
    'binance smart chain (bep20)': 'bsc',
    'binance smart chain': 'bsc',
    'binance-smart-chain-bsc': 'bsc',
    bsc: 'bsc',
    solana: 'solana',
    base: 'base',
    arbitrum: 'arbitrum',
    'arbitrum-one': 'arbitrum',
    polygon: 'polygon',
    'polygon-pos': 'polygon',
    avalanche: 'avalanche',
    'avalanche-2': 'avalanche',
    optimism: 'optimism',
    'sui network': 'sui',
    'sui-network': 'sui',
    sui: 'sui',
    stellar: 'stellar',
    tron: 'tron',
    'xdc network': 'xdc',
    'xdc-network': 'xdc',
    ink: 'ink',
    'ton coin': 'ton',
    'the-open-network': 'ton',
    'ton': 'ton',
    'x layer': 'xlayer',
    'x-layer': 'xlayer',
    xdai: 'xlayer',
    'unichain': 'unichain',
    plume: 'plume',
    arc: 'arc',
    'hyper evm': 'hyperevm',
    hyperevm: 'hyperevm',
    'q blockchain': 'qblockchain',
    qblockchain: 'qblockchain',
    tezos: 'tezos',
    etherlink: 'etherlink',
    'zksync era': 'zksync',
    'zksync-era': 'zksync',
    zksync: 'zksync',
  };
  const key = platform.toLowerCase().trim();
  return map[key] ?? key.replace(/\s+/g, '-');
}

interface RawPool {
  addr?: string;
  exn?: string;
  fa?: string;
  /** USD liquidity. The DEX DTO sends numbers as strings. */
  liqUsd?: string | number | null;
  /** 24h trading volume. Also a string in the DTO. */
  v24?: string | number | null;
  pubAt?: number;
  t0?: { addr?: string; sym?: string };
  t1?: { addr?: string; sym?: string };
}

/**
 * One network as /v1/dex/platform/list describes it.
 *
 * The fields are single letters. There is no `network_slug` here — the slug
 * convention the DEX endpoints accept is not published on this endpoint at all.
 * Verified against the live keyless response on 2026-11-25.
 */
interface RawPlatform {
  id?: number;
  /** Display name, e.g. "BNB Smart Chain (BEP20)", "Ethereum". */
  n?: string;
  /** Acronym, e.g. "BSC", "ETH", "SOL". Sometimes blank. */
  pltA?: string;
  /** How many DEXs support it. */
  dn?: number;
  /** Visible. */
  v?: boolean;
  /** Pinned. */
  p?: boolean;
  /** Internal chain id, e.g. 56 for BSC, -1 for Solana. */
  chId?: number;
  /** Wrapped-native token id. */
  wcId?: number;
  /** Native coin address. */
  na?: string;
  /** CoinMarketCap's own id for the chain's cryptocurrency. */
  cid?: number;
  /** Icon URL. */
  i?: string;
}

/** One pair as /v4/dex/pairs/quotes/latest describes it. */
interface RawDexPair {
  contract_address?: string;
  name?: string;
  dex_id?: number;
  dex_slug?: string;
  network_slug?: string;
  last_updated?: string;
  date_launched?: string | null;
  base_asset?: { symbol?: string; contract_address?: string };
  quote_asset?: { symbol?: string; contract_address?: string };
  quote?: {
    price?: string | number | null;
    liquidity?: string | number | null;
    volume_24h?: string | number | null;
    last_updated?: string;
  }[];
}

/**
 * The DEX endpoints send numbers as strings. Coerce, and treat an empty or
 * unparseable value as missing rather than as zero.
 */
function num(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The candidate slugs the DEX endpoints might accept for a chain, best first.
 *
 * The convention is not published: /v1/dex/platform/list carries display names
 * under `n` and acronyms under `pltA` but no slug, and the endpoint that does
 * document slugs (/v4/dex/networks/list) is deprecated and key-gated. So we
 * offer the plausible spellings and let the response decide which is right.
 *
 * Order matters — the first candidate is the one the documentation's own curl
 * example uses (`platform=ethereum`), so the slugified display name leads.
 */
function dexPlatformCandidates(
  name: string,
  platformsByName: Map<string, RawPlatform>,
  working?: Map<string, string>,
): string[] {
  const key = name.toLowerCase().trim();
  const out: string[] = [];
  const add = (value: string | null | undefined): void => {
    if (!value) return;
    const v = value.trim();
    if (v && !out.includes(v)) out.push(v);
  };

  // A slug that worked on a previous refresh goes first.
  add(working?.get(key));

  const platform = platformsByName.get(key);
  if (platform) {
    // "BNB Smart Chain (BEP20)" -> "bnb-smart-chain-bep20"
    add(
      platform.n
        ?.toLowerCase()
        .replace(/[()]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    );
    // The acronym: "BSC" -> "bsc".
    add(platform.pltA?.toLowerCase());
    // The display name lowercased, which is what the docs example uses.
    add(platform.n?.toLowerCase());
  }

  // The hand-written map, for chains the platform list does not carry.
  const fromMap = slugFor(key);
  add(fromMap);

  // Finally the raw name, lowercased.
  add(key);

  return out.length ? out : [key];
}

/**
 * CoinMarketCap sends some timestamps as epoch seconds and some as
 * milliseconds. Normalise to ISO, and refuse to invent a date from a value
 * that is neither.
 */
function epochToIso(value: number | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Below ~1e11 is seconds, not milliseconds.
  const ms = n < 1e11 ? n * 1000 : n;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
