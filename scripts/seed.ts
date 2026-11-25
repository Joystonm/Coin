/**
 * The offline snapshot.
 *
 * `npm run snapshot` pulls the live universe from CoinMarketCap and writes
 * `public/data/snapshot.json`. This script writes a *fixture* instead: a
 * snapshot built from values observed in real CoinMarketCap responses, arranged
 * so that every branch of the analysis layer is exercised by the test suite and
 * by a first-run UI that has no API key.
 *
 * It is deliberately not a mock of the API — it is a snapshot with
 * `source: 'fixture'`, and the UI says so in plain language. Nothing computed
 * from it is ever presented as live.
 *
 * The real values below (gold at ~$3,524/oz, NVDA at ~$150.57, the issuer ids,
 * the crypto ids, the 1006 refusal on market-pairs/list) were read out of live
 * CoinMarketCap responses on 2026-11-25. Everything else is arranged to make a
 * specific code path reachable:
 *
 *   GOLD  mixed units (grams vs troy ounces), a dormant print, an off-peg
 *         wrapper, and a spread that is real but too expensive to capture
 *   NVDA  a genuinely capturable spread, an unreachable "cheapest" wrapper
 *         (the trap), and a pair we cannot price at all
 *   SPY   two liquid wrappers on different chains — the trade needs a bridge
 *   TLT   one side has a pool too shallow to trade
 *   AAPL  two wrappers that agree; there is nothing to do, and saying so is
 *         the point
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ApiCall, ApiIssue, Pool, RwaAsset, Snapshot, TokenDeployment, TokenQuote, Wrapper } from '../src/lib/types.ts';

const OUT_DIR = join(process.cwd(), 'public', 'data');

/** The timestamp of the live capture the fixture is derived from. */
export const FIXTURE_NOW = Date.parse('2026-11-25T08:37:12.279Z');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;

function at(offsetMs: number): string {
  return new Date(FIXTURE_NOW + offsetMs).toISOString();
}

function wrapper(
  cryptoId: number,
  symbol: string,
  name: string,
  issuerId: string,
  issuerName: string,
  price: number | null,
  volume24h: number | null,
  marketCap: number | null,
): Wrapper {
  return { cryptoId, symbol, name, issuerId, issuerName, price, volume24h, marketCap };
}

const ISSUER_BACKED = '6878977dcbbf471de3366e85';
const ISSUER_PAXOS = '68904c24abae9b5b9fb35815';
const ISSUER_TETHER = '68904e9cabae9b5b9fb358ac';
const ISSUER_DINARI = '68904f1babae9b5b9fb358b1';
const ISSUER_ONDO = '68904d5aabae9b5b9fb358a9';

function pool(
  cryptoId: number,
  platform: string,
  dexName: string,
  liquidityUsd: number | null,
  volume24h: number | null,
  source: Pool['source'] = 'dex/pairs/quotes/latest',
): Pool {
  return {
    poolAddress: `0x${cryptoId.toString(16).padStart(40, '0')}`,
    dexName,
    platform,
    liquidityUsd,
    baseTokenSymbol: null,
    quoteTokenSymbol: 'USDC',
    volume24h,
    createdAt: at(-120 * DAY),
    source,
  };
}

function quote(
  cryptoId: number,
  symbol: string,
  name: string,
  price: number | null,
  volume24h: number | null,
  marketCap: number | null,
  ageMs: number,
  isStale = false,
): TokenQuote {
  return {
    cryptoId,
    symbol,
    name,
    price,
    volume24h,
    marketCap,
    lastUpdated: at(-ageMs),
    percentChange24h: 0.42,
    isStale,
  };
}

// ── The universe ─────────────────────────────────────────────────────────────

const ASSETS: RwaAsset[] = [
  {
    // Gold: seven wrappers. One quotes per gram rather than per troy ounce, one
    // stopped printing ten days ago but is still quoted at the old price, and
    // one sits 10% away with no unit that explains it.
    rwaId: 1,
    name: 'Gold',
    symbol: 'GOLD',
    slug: 'gold',
    assetType: 'commodity',
    rank: 1,
    avgTokenizedPrice: 3524.4462350344793,
    tokenizedMarketCap: 4_321_675_664.705656,
    tokenizedVolume24h: 284_318_768.9544338,
    lastUpdated: at(-70_000),
    description:
      'Gold is a physical commodity and monetary metal that has served as a store of value for thousands of years.',
    industry: 'Commodities',
    website: null,
    primaryExchange: null,
    tradfiMarkets: [],
    wrappers: [
      wrapper(4705, 'PAXG', 'PAX Gold', ISSUER_PAXOS, 'Paxos', 3525.19, 106_870_725.15, 1_576_932_702.65),
      wrapper(5176, 'XAUt', 'Tether Gold', ISSUER_TETHER, 'Tether Holdings', 3525.45, 175_429_025.76, 2_642_056_804.12),
      wrapper(21374, 'KAUG', 'Kinesis Gold', ISSUER_BACKED, 'Backed Assets', 3525.3, 41_200_000, 310_400_000),
      wrapper(26891, 'GOLDX', 'GoldX', ISSUER_ONDO, 'Ondo', 3578.0, 8_500_000, 61_400_000),
      // Quoted per gram rather than per troy ounce: the ratio is 31.1035.
      wrapper(33021, 'XAUTG', 'Tether Gold (grams)', ISSUER_TETHER, 'Tether Holdings', 113.29, 2_400_000, 19_100_000),
      // Stopped printing ten days ago, but still quoted at the old price.
      wrapper(27410, 'OLDX', 'Gold Classic', ISSUER_BACKED, 'Backed Assets', 3519.8, 940_000, 12_700_000),
      // Genuinely off-peg by ~10%, with no unit to explain it.
      wrapper(30155, 'SPOTX', 'Spot Gold', ISSUER_BACKED, 'Backed Assets', 3866.2, 3_100_000, 26_400_000),
    ],
  },
  {
    // Nvidia: the interesting case. A real gap between two wrappers that clears
    // its own execution cost, a cheaper wrapper nobody can actually buy, and a
    // pair whose execution cost we cannot price at all.
    rwaId: 2,
    name: 'Nvidia Corp',
    symbol: 'NVDA',
    slug: 'nvidia',
    assetType: 'stock',
    rank: 4,
    avgTokenizedPrice: 150.57314791465885,
    tokenizedMarketCap: 390_084_941.23946345,
    tokenizedVolume24h: 260_459_866.23055303,
    lastUpdated: at(-70_000),
    description: 'Nvidia Corporation designs graphics processing units and accelerated computing platforms.',
    industry: 'Semiconductors',
    website: 'https://www.nvidia.com',
    primaryExchange: 'Nasdaq',
    tradfiMarkets: [
      { exchange: 'Binance', exchangeSlug: 'binance', ticker: 'NVDA', url: 'https://www.binance.com/en/stocks/EQ_NVDA' },
    ],
    wrappers: [
      wrapper(36992, 'NVDAX', 'NVIDIA tokenized stock (xStock)', ISSUER_BACKED, 'Backed Assets', 150.72, 68_469_213.42, 133_123_454.47),
      wrapper(28616, 'NVDA.D', 'NVIDIA tokenized stock (Dinari)', ISSUER_DINARI, 'Dinari Assets', 150.21, 12_400_000, 41_200_000),
      wrapper(30012, 'NVDAY', 'NVIDIA tokenized stock (Yield)', ISSUER_ONDO, 'Ondo', 151.34, 8_800_000, 27_600_000),
      wrapper(31188, 'NVDAP', 'NVIDIA tokenized stock (Paxos)', ISSUER_PAXOS, 'Paxos', 150.55, 5_600_000, 18_900_000),
    ],
  },
  {
    // SPY: the two liquid wrappers sit on different chains, so the trade cannot
    // be closed without a bridge that no CoinMarketCap endpoint prices.
    rwaId: 9,
    name: 'SPDR S&P 500 ETF Trust',
    symbol: 'SPY',
    slug: 'spdr-sp-500-etf-trust',
    assetType: 'etf',
    rank: 3,
    avgTokenizedPrice: 604.18,
    tokenizedMarketCap: 41_200_000,
    tokenizedVolume24h: 1_940_000,
    lastUpdated: at(-140_000),
    description: 'The SPDR S&P 500 ETF Trust is an exchange traded fund tracking the S&P 500.',
    industry: 'ETFs',
    website: 'https://www.ssga.com',
    primaryExchange: 'NYSE Arca',
    tradfiMarkets: [
      { exchange: 'NYSE Arca', exchangeSlug: 'nyse-arca', ticker: 'SPY', url: 'https://www.nyse.com/quote/XNYS:SPY' },
    ],
    wrappers: [
      wrapper(29610, 'SPYon', 'SPY tokenized (Ondo)', ISSUER_ONDO, 'Ondo', 603.9, 1_200_000, 22_000_000),
      wrapper(30544, 'SPYX', 'SPY tokenized (xStocks)', ISSUER_BACKED, 'Backed Assets', 606.42, 740_000, 13_100_000),
    ],
  },
  {
    // TLT: one side's deepest visible pool is smaller than the position we are
    // pricing, so that side cannot be traded at the quoted price.
    rwaId: 10,
    name: 'iShares 20+ Year Treasury Bond ETF',
    symbol: 'TLT',
    slug: 'ishares-20-year-treasury-bond-etf',
    assetType: 'etf',
    rank: 11,
    avgTokenizedPrice: 88.41,
    tokenizedMarketCap: 6_800_000,
    tokenizedVolume24h: 310_000,
    lastUpdated: at(-160_000),
    description: 'The iShares 20+ Year Treasury Bond ETF seeks to track the ICE U.S. Treasury 20+ Year Bond Index.',
    industry: 'ETFs',
    website: 'https://www.ishares.com',
    primaryExchange: 'Nasdaq',
    tradfiMarkets: [
      { exchange: 'Nasdaq', exchangeSlug: 'nasdaq', ticker: 'TLT', url: 'https://www.nasdaq.com/market-activity/etf/tlt' },
    ],
    wrappers: [
      wrapper(31890, 'TLTOn', 'TLT tokenized (Ondo)', ISSUER_ONDO, 'Ondo', 88.41, 310_000, 6_800_000),
      wrapper(32001, 'TLTX', 'TLT tokenized (xStocks)', ISSUER_BACKED, 'Backed Assets', 88.37, 120_000, 2_600_000),
    ],
  },
  {
    // AAPL: two wrappers that agree. Nothing to do, and saying so is the point.
    rwaId: 12,
    name: 'Apple Inc',
    symbol: 'AAPL',
    slug: 'apple-inc',
    assetType: 'stock',
    rank: 5,
    avgTokenizedPrice: 231.44,
    tokenizedMarketCap: 88_100_000,
    tokenizedVolume24h: 4_100_000,
    lastUpdated: at(-120_000),
    description: 'Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories.',
    industry: 'Consumer Electronics',
    website: 'https://www.apple.com',
    primaryExchange: 'Nasdaq',
    tradfiMarkets: [
      { exchange: 'Nasdaq', exchangeSlug: 'nasdaq', ticker: 'AAPL', url: 'https://www.nasdaq.com/market-activity/stocks/aapl' },
    ],
    wrappers: [
      wrapper(31200, 'AAPLX', 'Apple tokenized (xStocks)', ISSUER_BACKED, 'Backed Assets', 231.44, 2_900_000, 51_200_000),
      wrapper(31310, 'AAPL.D', 'Apple tokenized (Dinari)', ISSUER_DINARI, 'Dinari Assets', 231.51, 1_200_000, 19_400_000),
    ],
  },
];

const QUOTES: Record<string, TokenQuote> = Object.fromEntries(
  [
    // Gold
    quote(4705, 'PAXG', 'PAX Gold', 3525.19, 106_870_725.15, 1_576_932_702.65, 71_000),
    quote(5176, 'XAUt', 'Tether Gold', 3525.45, 175_429_025.76, 2_642_056_804.12, 71_000),
    quote(21374, 'KAUG', 'Kinesis Gold', 3525.3, 41_200_000, 310_400_000, 68_000),
    quote(26891, 'GOLDX', 'GoldX', 3578.0, 8_500_000, 61_400_000, 55_000),
    quote(33021, 'XAUTG', 'Tether Gold (grams)', 113.29, 2_400_000, 19_100_000, 2 * HOUR),
    quote(27410, 'OLDX', 'Gold Classic', 3519.8, 940_000, 12_700_000, 10 * DAY, true),
    quote(30155, 'SPOTX', 'Spot Gold', 3866.2, 3_100_000, 26_400_000, 12 * MINUTE),
    // Nvidia
    quote(36992, 'NVDAX', 'NVIDIA tokenized stock (xStock)', 150.72, 68_469_213.42, 133_123_454.47, 71_000),
    quote(28616, 'NVDA.D', 'NVIDIA tokenized stock (Dinari)', 150.21, 12_400_000, 41_200_000, 74_000),
    quote(30012, 'NVDAY', 'NVIDIA tokenized stock (Yield)', 151.34, 8_800_000, 27_600_000, 2 * HOUR),
    quote(31188, 'NVDAP', 'NVIDIA tokenized stock (Paxos)', 150.55, 5_600_000, 18_900_000, 5 * HOUR),
    // SPY
    quote(29610, 'SPYon', 'SPY tokenized (Ondo)', 603.9, 1_200_000, 22_000_000, 90_000),
    quote(30544, 'SPYX', 'SPY tokenized (xStocks)', 606.42, 740_000, 13_100_000, 95_000),
    // TLT
    quote(31890, 'TLTOn', 'TLT tokenized (Ondo)', 88.41, 310_000, 6_800_000, 2 * HOUR),
    quote(32001, 'TLTX', 'TLT tokenized (xStocks)', 88.37, 120_000, 2_600_000, 4 * HOUR),
    // AAPL
    quote(31200, 'AAPLX', 'Apple tokenized (xStocks)', 231.44, 2_900_000, 51_200_000, 80_000),
    quote(31310, 'AAPL.D', 'Apple tokenized (Dinari)', 231.51, 1_200_000, 19_400_000, 85_000),
  ].map((q) => [String(q.cryptoId), q]),
);

const CHAIN_NAMES: Record<string, string> = {
  ethereum: 'Ethereum',
  base: 'Base',
  solana: 'Solana',
  bsc: 'Binance Smart Chain (BEP20)',
};

const DEPLOYMENTS: Record<string, TokenDeployment> = Object.fromEntries(
  (
    [
      [4705, 'ethereum'],
      [5176, 'ethereum'],
      [21374, 'ethereum'],
      [26891, 'ethereum'],
      [33021, 'ethereum'],
      [27410, 'ethereum'],
      [30155, 'ethereum'],
      [36992, 'ethereum'],
      [28616, 'ethereum'],
      [30012, 'ethereum'],
      [31188, 'ethereum'],
      [29610, 'ethereum'],
      [30544, 'solana'],
      [31890, 'ethereum'],
      [32001, 'ethereum'],
      [31200, 'ethereum'],
      [31310, 'ethereum'],
    ] as [number, string][]
  ).map(([id, chain]) => [
    String(id),
    {
      cryptoId: id,
      logo: null,
      platform: CHAIN_NAMES[chain] ?? chain,
      platformSlug: chain,
      chains: [chain],
      contracts: { [chain]: `0x${id.toString(16).padStart(40, '0')}` },
    },
  ]),
);

const POOLS: Record<string, Pool[]> = {
  // Gold. GOLDX is deep enough to trade but not deep enough to make the 150 bps
  // gap cheap to capture; OLDX's pool is smaller than the position we price.
  '4705': [pool(4705, 'ethereum', 'Uniswap V3', 48_000_000, 9_100_000)],
  '5176': [pool(5176, 'ethereum', 'Uniswap V3', 32_000_000, 7_400_000)],
  '21374': [pool(21374, 'ethereum', 'Uniswap V2', 20_000_000, 4_800_000)],
  '26891': [pool(26891, 'ethereum', 'Curve', 6_000_000, 1_900_000)],
  '33021': [pool(33021, 'ethereum', 'Uniswap V3', 15_000_000, 1_100_000)],
  '27410': [pool(27410, 'ethereum', 'Uniswap V2', 95_000, 22_000, 'dex/token/pools')],
  '30155': [pool(30155, 'ethereum', 'Uniswap V2', 410_000, 180_000)],
  // Nvidia. NVDA.D has no pool we can see at all: it is the cheapest wrapper
  // on the screen and it is not the cheapest one you could buy.
  '36992': [pool(36992, 'ethereum', 'Uniswap V3', 20_000_000, 6_100_000)],
  '28616': [],
  '30012': [pool(30012, 'ethereum', 'Aerodrome', 60_000_000, 2_400_000)],
  '31188': [pool(31188, 'ethereum', 'Uniswap V3', 90_000_000, 1_700_000)],
  // SPY: same asset, two chains.
  '29610': [pool(29610, 'ethereum', 'Uniswap V3', 1_900_000, 1_100_000)],
  '30544': [pool(30544, 'solana', 'Raydium', 1_200_000, 700_000)],
  // TLT: TLTX's deepest pool is smaller than the position we price.
  '31890': [],
  '32001': [pool(32001, 'ethereum', 'Uniswap V2', 40_000, 9_000)],
  // AAPL
  '31200': [pool(31200, 'ethereum', 'Uniswap V3', 41_000_000, 2_800_000)],
  '31310': [pool(31310, 'ethereum', 'Uniswap V2', 11_000_000, 700_000)],
};

const CALLS: ApiCall[] = [
  { endpoint: '/v5/real-world-assets/map', query: 'asset_type=stock&limit=1', credits: 0, errorCode: 0, errorMessage: null, elapsedMs: 2, at: at(-80_000) },
  { endpoint: '/v5/real-world-assets/assets/list', query: 'limit=250&sort=tokenized_market_cap&sort_dir=desc', credits: 1, errorCode: 0, errorMessage: null, elapsedMs: 16, at: at(-75_000) },
  { endpoint: '/v5/real-world-assets/quotes/latest', query: 'rwa_id=1,2,9,10,12', credits: 1, errorCode: 0, errorMessage: null, elapsedMs: 14, at: at(-72_000) },
  { endpoint: '/v5/real-world-assets/info', query: 'rwa_id=1,2,9,10,12&skip_invalid=true', credits: 1, errorCode: 0, errorMessage: null, elapsedMs: 21, at: at(-70_000) },
  { endpoint: '/v5/real-world-assets/issuers/list', query: 'limit=250', credits: 1, errorCode: 0, errorMessage: null, elapsedMs: 9, at: at(-68_000) },
  { endpoint: '/v2/cryptocurrency/info', query: 'id=4705,5176,21374&skip_invalid=true&aux=logo,platform,contract_address', credits: 1, errorCode: 0, errorMessage: null, elapsedMs: 18, at: at(-66_000) },
  { endpoint: '/v2/cryptocurrency/quotes/latest', query: 'id=4705,5176,21374&convert=USD', credits: 1, errorCode: 0, errorMessage: null, elapsedMs: 12, at: at(-64_000) },
  { endpoint: '/v1/dex/platform/list', query: '', credits: 1, errorCode: 0, errorMessage: null, elapsedMs: 7, at: at(-63_000) },
  { endpoint: '/v4/dex/pairs/quotes/latest', query: 'contract_address=0x1265&network_slug=ethereum&skip_invalid=true', credits: 1, errorCode: 0, errorMessage: null, elapsedMs: 11, at: at(-62_000) },
  {
    endpoint: '/v5/real-world-assets/market-pairs/list',
    query: 'symbol=NVDA&limit=5',
    credits: 0,
    errorCode: 1006,
    errorMessage: "Your API Key subscription plan doesn't support this endpoint.",
    elapsedMs: 0,
    at: at(-60_000),
  },
];

const API_ISSUES: ApiIssue[] = [
  {
    id: 'market-pairs-plan',
    title: 'The endpoint that would show where tokenized assets actually quote is plan-gated',
    detail:
      '/v5/real-world-assets/market-pairs/list is listed for every plan in the reference, but it is refused on the key this project was given. Without it there is no venue-level view of tokenized-asset liquidity, so execution cost can only be estimated from DEX pools.',
    endpoint: '/v5/real-world-assets/market-pairs/list',
    evidence: 'error_code 1006: Your API Key subscription plan doesn\'t support this endpoint.',
    severity: 3,
    repro:
      'curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" "https://pro-api.coinmarketcap.com/v5/real-world-assets/market-pairs/list?symbol=NVDA&limit=5"',
    suggestedFix:
      'Align the plan table in the reference with the actual gating, and name the minimum plan in the error message so a consumer can tell whether to upgrade or work around it.',
  },
];

/** The snapshot written by this script. */
export function fixtureSnapshot(): Snapshot {  return {
    generatedAt: at(-60_000),
    source: 'fixture',
    universe: {
      totalAssets: 7942,
      byType: { stock: 4686, etf: 3121, commodity: 4, currency: 61, government_security: 24, real_estate: 46 },
      issuers: 25,
    },
    assets: ASSETS,
    issuers: [
      { issuerId: ISSUER_BACKED, name: 'Backed Assets', website: 'https://assets.backed.fi/', logo: null, numTokens: 1218 },
      { issuerId: ISSUER_PAXOS, name: 'Paxos', website: 'https://paxos.com/', logo: null, numTokens: 96 },
      { issuerId: ISSUER_TETHER, name: 'Tether Holdings', website: 'https://tether.to/', logo: null, numTokens: 54 },
      { issuerId: ISSUER_DINARI, name: 'Dinari Assets', website: 'https://dinari.com/', logo: null, numTokens: 38 },
      { issuerId: ISSUER_ONDO, name: 'Ondo', website: 'https://ondo.finance/', logo: null, numTokens: 212 },
    ],
    deployments: DEPLOYMENTS,
    quotes: QUOTES,
    pools: POOLS,
    calls: CALLS,
    apiIssues: API_ISSUES,
    scope: {
      assetsRequested: 250,
      depthScannedWrappers: 12,
      depthSelectionRule:
        'the 60 assets with the largest tokenized market cap, and within each the 4 wrappers with the largest reported 24h volume',
      sizeUsd: 100_000,
      credits: 9,
      calls: CALLS.length,
    },
  };
}

// ── The offline history ──────────────────────────────────────────────────────

/**
 * One point in a fixture series.
 *
 * The shape matches what `/v5/real-world-assets/quotes/historical` returns:
 * an aggregate tokenized price per day, with no per-wrapper detail.
 */
export interface FixtureHistoryPoint {
  timestamp: string;
  price: number | null;
  tokenizedMarketCap: number | null;
  tokenizedVolume24h: number | null;
}

export interface FixtureHistoryAsset {
  rwaId: number | null;
  symbol: string;
  name: string;
  slug: string | null;
  assetType: string | null;
  points: FixtureHistoryPoint[];
}

export interface FixtureHistoryFile {
  generatedAt: string;
  source: 'live' | 'fixture';
  window: { days: number; start: string; end: string; interval: string };
  assets: FixtureHistoryAsset[];
  calls: ApiCall[];
  apiIssues: ApiIssue[];
}

/**
 * A tiny linear congruential generator.
 *
 * The fixture has to be byte-identical every time it is written, so it cannot
 * use `Math.random`. This is the whole of the randomness: reproducible, and
 * obvious from the code.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A daily price walk with a target volatility.
 *
 * The whole series is then shifted so that its last point lands exactly on
 * the aggregate price the snapshot reports for that asset. Shifting the level
 * leaves the daily moves — the thing the product actually measures — alone.
 */
function walk(
  base: number,
  days: number,
  dailyBps: number,
  seed: number,
  endPrice: number,
): number[] {
  const rand = lcg(seed);
  const prices: number[] = [base];
  for (let i = 1; i < days; i++) {
    // Mostly ordinary days, with the occasional larger one.
    const shock = (rand() * 2 - 1) * dailyBps * (rand() < 0.18 ? 2.4 : 1);
    prices.push((prices[prices.length - 1] as number) * (1 + shock / 10_000));
  }
  const shift = endPrice / (prices[prices.length - 1] as number);
  return prices.map((p) => p * shift);
}

/** Turn a price list into dated points, oldest first. */
function toPoints(prices: readonly number[], endMs: number, days: number): FixtureHistoryPoint[] {
  return prices.map((price, i) => ({
    timestamp: new Date(endMs - (days - 1 - i) * DAY).toISOString(),
    price,
    tokenizedMarketCap: null,
    tokenizedVolume24h: null,
  }));
}

const HISTORY_DAYS = 30;

/**
 * The offline history.
 *
 * `npm run history` pulls CoinMarketCap's own aggregate tokenized price series.
 * This is the fixture version, arranged so the time-series arm has something
 * to say in a demo with no API key:
 *
 *   NVDA  a volatile equity: its tokenized price moves hundreds of bps a day,
 *         so a 50 bps gap between two wrappers is noise, not an opportunity
 *   GOLD  a commodity that drifts tens of bps a day
 *   SPY   an aggregate pinned to one level for 29 days and moved today — the
 *         "when did this open?" signal
 *   TLT   a bond ETF, quieter than an equity but not flat
 *   AAPL  an equity with an ordinary equity's volatility
 *
 * Each series ends exactly on the aggregate price its snapshot reports, so the
 * two files cannot contradict each other.
 */
export function fixtureHistory(): FixtureHistoryFile {
  const endMs = FIXTURE_NOW;
  const startMs = endMs - (HISTORY_DAYS - 1) * DAY;

  const series = (
    rwaId: number,
    symbol: string,
    name: string,
    slug: string,
    assetType: string,
    base: number,
    endPrice: number,
    dailyBps: number,
    seed: number,
    prices?: number[],
  ): FixtureHistoryAsset => ({
    rwaId,
    symbol,
    name,
    slug,
    assetType,
    points: toPoints(prices ?? walk(base, HISTORY_DAYS, dailyBps, seed, endPrice), endMs, HISTORY_DAYS),
  });

  // SPY: 29 days at one level, and a move on the last day.
  const spyFlat = Array.from({ length: HISTORY_DAYS - 1 }, () => 605.0).concat([604.18]);

  const assets: FixtureHistoryAsset[] = [
    series(2, 'NVDA', 'Nvidia Corp', 'nvidia', 'stock', 150.5, 150.57314791465885, 240, 20_261_125),
    series(1, 'GOLD', 'Gold', 'gold', 'commodity', 3524.45, 3524.4462350344793, 35, 20_261_101),
    series(9, 'SPY', 'SPDR S&P 500 ETF Trust', 'spdr-sp-500-etf-trust', 'etf', 605.0, 604.18, 60, 20_261_109, spyFlat),
    series(10, 'TLT', 'iShares 20+ Year Treasury Bond ETF', 'ishares-20-year-treasury-bond-etf', 'etf', 88.41, 88.41, 40, 20_261_110),
    series(12, 'AAPL', 'Apple Inc', 'apple-inc', 'stock', 231.44, 231.44, 150, 20_261_112),
  ];

  return {
    generatedAt: at(-60_000),
    source: 'fixture',
    window: {
      days: HISTORY_DAYS,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      interval: 'daily',
    },
    assets,
    calls: [
      {
        endpoint: '/v5/real-world-assets/quotes/historical',
        query: `rwa_id=${assets.map((a) => a.rwaId).join(',')}&interval=daily&time_start=${new Date(startMs).toISOString()}&time_end=${new Date(endMs).toISOString()}&convert=USD`,
        credits: 1,
        errorCode: 0,
        errorMessage: null,
        elapsedMs: 26,
        at: at(-59_000),
      },
    ],
    apiIssues: [],
  };
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const snapshot = fixtureSnapshot();
  writeFileSync(join(OUT_DIR, 'snapshot.json'), `${JSON.stringify(snapshot)}\n`);
  writeFileSync(join(OUT_DIR, 'snapshot.pretty.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

  const history = fixtureHistory();
  writeFileSync(join(OUT_DIR, 'history.json'), `${JSON.stringify(history, null, 2)}\n`);

  process.stdout.write(
    `fixture snapshot written: ${snapshot.assets.length} assets, ` +
      `${Object.keys(snapshot.quotes).length} wrapper quotes, ` +
      `${Object.keys(snapshot.pools).length} depth lookups\n` +
      `fixture history written: ${history.assets.length} assets, ` +
      `${history.assets.reduce((n, a) => n + a.points.length, 0)} points\n` +
      'source: fixture — run `npm run snapshot` with a live key for a real pull.\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
