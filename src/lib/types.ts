/**
 * Core data model.
 *
 * Everything here is a plain, serialisable shape with explicit `null`s. A missing
 * number is never coerced to zero — the whole product is about telling the
 * difference between "zero" and "we could not measure it".
 */

export type AssetType =
  | 'stock'
  | 'etf'
  | 'commodity'
  | 'currency'
  | 'government_security'
  | 'real_estate'
  | 'fund'
  | 'other';

/** One tokenised wrapper of a real-world asset, e.g. NVDAX (Backed) or SPYon (Ondo) for SPY. */
export interface Wrapper {
  /** CoinMarketCap `crypto_id` of the token. The only safe join key in this API. */
  cryptoId: number;
  symbol: string;
  name: string;
  issuerId: string | null;
  issuerName: string | null;
  /** Price in USD as CMC reports it. May be in the wrapper's own unit — see `units.ts`. */
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
}

export interface RwaAsset {
  rwaId: number | null;
  name: string;
  symbol: string;
  slug: string;
  assetType: AssetType;
  rank: number | null;
  /** CMC's own aggregate price across wrappers. Known to mix units — never trust it. */
  avgTokenizedPrice: number | null;
  tokenizedMarketCap: number | null;
  tokenizedVolume24h: number | null;
  lastUpdated: string | null;
  description: string | null;
  industry: string | null;
  website: string | null;
  primaryExchange: string | null;
  /** The listed instrument this token tracks, when CMC names one. */
  tradfiMarkets: TradfiMarket[];
  wrappers: Wrapper[];
}

export interface TradfiMarket {
  /** Exchange name, e.g. "Binance". */
  exchange: string | null;
  /** Exchange slug, e.g. "binance". */
  exchangeSlug: string | null;
  ticker: string | null;
  url: string | null;
}

export interface Issuer {
  issuerId: string;
  name: string;
  website: string | null;
  logo: string | null;
  numTokens: number | null;
}

/**
 * A wrapper's own quote from `/v2/cryptocurrency/quotes/latest`.
 *
 * The RWA endpoint groups wrappers but does not timestamp them individually.
 * This endpoint does, so joining the two is what makes staleness measurable.
 */
export interface TokenQuote {
  cryptoId: number;
  symbol: string;
  name: string;
  price: number | null;
  volume24h: number | null;
  marketCap: number | null;
  lastUpdated: string | null;
  percentChange24h: number | null;
  /** Whether CMC flags the token's data quality. */
  isStale: boolean | null;
}

/** Deployment detail for a wrapper token, joined from `/v2/cryptocurrency/info`. */
export interface TokenDeployment {
  cryptoId: number;
  logo: string | null;
  /** Primary chain CMC lists the token on. */
  platform: string | null;
  /** CMC's own slug for that chain, e.g. "ethereum". */
  platformSlug: string | null;
  /** Every chain CMC lists a contract for. */
  chains: string[];
  /** Contract address per chain, when CMC exposes one. */
  contracts: Record<string, string>;
}

export interface ApiCall {
  endpoint: string;
  query: string;
  credits: number;
  errorCode: number;
  errorMessage: string | null;
  elapsedMs: number;
  at: string;
}

/**
 * A receipt: the proof that a number on the screen came from a specific API call.
 * Every figure in the product carries one.
 */
export interface Receipt {
  /** Endpoint path, e.g. `/v5/real-world-assets/quotes/latest`. */
  endpoint: string;
  /** Query string sent. */
  query: string;
  /** HTTP status. */
  httpStatus: number;
  /** CMC's own error code, 0 = ok. */
  errorCode: number;
  errorMessage: string | null;
  /** Credits charged, as CMC reported them. */
  credits: number;
  /** Server elapsed ms, as CMC reported them. */
  elapsedMs: number;
  /** CMC's response timestamp. */
  at: string;
  /** True when this call was served from our own snapshot rather than live. */
  fromCache: boolean;
  /** Age of the cached payload in seconds, when fromCache. */
  cacheAgeSeconds?: number;
}

/** A DEX pool holding a wrapper token. */
export interface Pool {
  poolAddress: string;
  dexName: string | null;
  platform: string | null;
  /** USD value in the pool, when CMC reports one. */
  liquidityUsd: number | null;
  baseTokenSymbol: string | null;
  quoteTokenSymbol: string | null;
  /** 24h volume in USD, when reported. */
  volume24h: number | null;
  /** Timestamp the pool was created, when reported. */
  createdAt: string | null;
  /** Which endpoint this pool came from. */
  source: 'dex/token/pools' | 'dex/pairs/quotes/latest';
  /** When the pool's own quote was last struck, when the endpoint reports one. */
  lastUpdated?: string | null;
}

export interface Universe {
  totalAssets: number;
  byType: Partial<Record<AssetType, number>>;
  issuers: number;
}

export interface Snapshot {
  generatedAt: string;
  /**
   * `live` for a real pull from CoinMarketCap; `fixture` for the offline
   * snapshot the test suite and the UI's first run use. The UI says so.
   */
  source: 'live' | 'fixture';
  universe: Universe;
  assets: RwaAsset[];
  issuers: Issuer[];
  deployments: Record<string, TokenDeployment>;
  /** Each wrapper's own quote, with its own timestamp. */
  quotes: Record<string, TokenQuote>;
  /** DEX pools we could look up, keyed by the wrapper's crypto_id. */
  pools: Record<string, Pool[]>;
  calls: ApiCall[];
  /** Problems found in the API's own data, auto-detected on every refresh. */
  apiIssues: ApiIssue[];
  /** What this snapshot covered, so a reader knows what was measured. */
  scope: SnapshotScope;
}

export interface SnapshotScope {
  /** How many assets the RWA list endpoint was asked for. */
  assetsRequested: number;
  /** How many wrappers we looked up DEX pools for. */
  depthScannedWrappers: number;
  /** The rule that chose which wrappers got a depth lookup. */
  depthSelectionRule: string;
  /** The notional size every cost figure in this snapshot refers to. */
  sizeUsd: number;
  /** Total credits spent on this snapshot. */
  credits: number;
  /** Total API calls made. */
  calls: number;
}

/** An API data problem, with the evidence that proves it. */
export interface ApiIssue {
  id: string;
  title: string;
  detail: string;
  endpoint: string;
  evidence: string;
  /** How much it matters, 1 (cosmetic) to 3 (blocks the product). */
  severity: 1 | 2 | 3;
  /** A runnable reproduction. */
  repro?: string;
  /** What we think should change in the API. */
  suggestedFix?: string;
}
