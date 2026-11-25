/**
 * The CoinMarketCap client.
 *
 * Every call produces a receipt: endpoint, query, HTTP status, CoinMarketCap's
 * own error code, the credits it charged, and the SHA-256 of the exact bytes we
 * received. The raw bytes are kept alongside the parsed body so the hash stays
 * re-derivable from the committed artifact — a receipt you cannot re-check is
 * a receipt you have to trust.
 *
 * Errors are never thrown. A 1006 ("your plan does not support this endpoint")
 * is data: it is the evidence for an API finding, and it must be recorded
 * rather than crash the run.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiCall, Receipt } from '../src/lib/types.ts';

export const BASE_URL = 'https://pro-api.coinmarketcap.com';
export const KEY_HEADER = 'X-CMC_PRO_API_KEY';

export interface CmcEnvelope<T> {
  data?: T;
  status?: {
    timestamp?: string;
    error_code?: number | string;
    error_message?: string | null;
    elapsed?: number;
    credit_count?: number;
    category?: string;
    error_detail?: string;
    notice?: string | null;
  };
}

export interface CmcResult<T> {
  data: T | null;
  receipt: Receipt;
  /** The exact bytes received. */
  raw: Buffer;
  body: CmcEnvelope<T> | null;
  /** True when CoinMarketCap reported an error. */
  failed: boolean;
}

export interface CmcClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Where to write evidence files. */
  evidenceDir?: string;
  /** Minimum milliseconds between calls. */
  minIntervalMs?: number;
  /** Called after every call, for live progress output. */
  onCall?: (receipt: Receipt) => void;
  /** Keep raw bytes in memory (needed for evidence). */
  keepRaw?: boolean;
}

export class CmcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly receipt: Receipt,
  ) {
    super(message);
    this.name = 'CmcError';
  }
}

const DEFAULT_INTERVAL_MS = 2100;
const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Trim a payload for an evidence file: keep the head of every array. */
export function trim(value: unknown, keep = 2): unknown {
  if (Array.isArray(value)) {
    if (value.length <= keep) return value.map((v) => trim(v, keep));
    return [...value.slice(0, keep).map((v) => trim(v, keep)), `… ${value.length - keep} more`];
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = trim(v, keep);
    return out;
  }
  return value;
}

export class CmcClient {
  readonly calls: ApiCall[] = [];
  readonly receipts: Receipt[] = [];
  /** Raw response bytes, keyed by the SHA-256 of those bytes. */
  readonly bodies = new Map<string, Buffer>();

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly evidenceDir: string | undefined;
  private readonly minIntervalMs: number;
  private readonly onCall: ((receipt: Receipt) => void) | undefined;
  private readonly keepRaw: boolean;
  private lastCallAt = 0;

  constructor(options: CmcClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        'CMC_API_KEY is required. Copy .env.example to .env and paste your key from https://coinmarketcap.com/api',
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.evidenceDir = options.evidenceDir;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.onCall = options.onCall;
    this.keepRaw = options.keepRaw ?? true;
    if (this.evidenceDir) mkdirSync(this.evidenceDir, { recursive: true });
  }

  get creditsUsed(): number {
    return this.calls.reduce((sum, c) => sum + c.credits, 0);
  }

  /**
   * Make one GET request. Never throws for an API-level error: the error is
   * returned as data so the caller can record it as a finding.
   */
  async get<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {},
    options: { evidence?: string } = {},
  ): Promise<CmcResult<T>> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      query.set(key, String(value));
    }
    const qs = query.toString();
    const url = `${this.baseUrl}${endpoint}${qs ? `?${qs}` : ''}`;

    let lastError: string | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const wait = this.lastCallAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();

      const started = Date.now();
      try {
        const res = await fetch(url, {
          headers: { [KEY_HEADER]: this.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });
        const raw = Buffer.from(await res.arrayBuffer());
        const elapsedMs = Date.now() - started;

        let body: CmcEnvelope<T> | null = null;
        try {
          body = JSON.parse(raw.toString('utf8')) as CmcEnvelope<T>;
        } catch {
          body = null;
        }

        const status = body?.status ?? {};
        const errorCode = Number(status.error_code ?? (res.ok ? 0 : res.status));
        const receipt: Receipt = {
          endpoint,
          query: qs,
          httpStatus: res.status,
          errorCode,
          errorMessage: status.error_message ?? (body ? null : 'response was not JSON'),
          credits: Number(status.credit_count ?? 0),
          elapsedMs: Number(status.elapsed ?? elapsedMs),
          at: status.timestamp ?? new Date().toISOString(),
          fromCache: false,
        };

        if (res.status === 429 || res.status >= 500) {
          lastError = `HTTP ${res.status}`;
          if (attempt < MAX_ATTEMPTS - 1) {
            await sleep(15_000 * 2 ** attempt);
            continue;
          }
        }

        this.record(receipt, endpoint, qs, raw);
        if (options.evidence && this.evidenceDir) {
          this.writeEvidence(options.evidence, url, raw, body);
        }

        const failed = errorCode !== 0 || body?.data === undefined;
        return {
          data: failed ? null : (body?.data as T),
          receipt,
          raw,
          body,
          failed,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(5_000 * 2 ** attempt);
          continue;
        }
      }
    }

    const receipt: Receipt = {
      endpoint,
      query: qs,
      httpStatus: 0,
      errorCode: -1,
      errorMessage: lastError ?? 'request failed',
      credits: 0,
      elapsedMs: 0,
      at: new Date().toISOString(),
      fromCache: false,
    };
    this.record(receipt, endpoint, qs, Buffer.alloc(0));
    return { data: null, receipt, raw: Buffer.alloc(0), body: null, failed: true };
  }

  private record(receipt: Receipt, endpoint: string, query: string, raw: Buffer): void {
    this.receipts.push(receipt);
    this.calls.push({
      endpoint,
      query,
      credits: receipt.credits,
      errorCode: receipt.errorCode,
      errorMessage: receipt.errorMessage,
      elapsedMs: receipt.elapsedMs,
      at: receipt.at,
    });
    if (this.keepRaw && raw.length) {
      this.bodies.set(createHash('sha256').update(raw).digest('hex'), raw);
    }
    this.onCall?.(receipt);
  }

  private writeEvidence(name: string, url: string, raw: Buffer, body: unknown): void {
    if (!this.evidenceDir) return;
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const evidence = {
      request: `GET ${url}`,
      headers: { [KEY_HEADER]: '<redacted>' },
      /** The SHA-256 of the exact bytes the API returned. */
      sha256,
      /**
       * The exact response body, byte for byte.
       *
       * It is stored so the hash above stays re-derivable: anyone can take
       * these bytes, hash them, and check them against `sha256`. A receipt you
       * cannot re-check is a receipt you have to trust. The key is not here —
       * it is a request header, never a response field.
       */
      raw: raw.toString('utf8'),
      /** The same body, trimmed for reading. */
      response: trim(body, 2),
    };
    writeFileSync(join(this.evidenceDir, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}

/** Read the API key from the environment, or explain how to get one. */
export function readApiKey(): string {
  const key = (process.env.CMC_API_KEY ?? process.env.COINMARKETCAP_API_KEY ?? '').trim();
  if (!key) {
    throw new Error(
      'No API key found. Copy .env.example to .env, put your key in CMC_API_KEY, then run `npm run snapshot`.\n' +
        'Get a free key (Startup tier) at https://coinmarketcap.com/api',
    );
  }
  return key;
}
