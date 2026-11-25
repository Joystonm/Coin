/**
 * The hosted API.
 *
 * The handlers are ordinary functions over an ordinary request and response
 * object, so they can be driven here without a server. The point of these
 * tests is not that the routes exist — it is that the API serves the *same*
 * numbers the CLI and the browser serve, and that it never leaks a key.
 *
 * The handler tests assert structure, not values: the committed snapshot may
 * be the offline fixture or a live pull, and both must satisfy the same
 * contract. The tests that need a specific data shape ask for the fixture
 * explicitly, so they keep their meaning whichever snapshot is committed.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import judgeHandler from '../api/judge.ts';
import findingsHandler from '../api/findings.ts';
import provenanceHandler from '../api/provenance.ts';
import snapshotHandler from '../api/snapshot.ts';
import { buildProvenance, judgeAtSize, parseSize, queryParam } from '../api/_core.ts';
import type { ApiRequest, ApiResponse } from '../api/_core.ts';
import { fixtureSnapshot } from '../scripts/seed.ts';

interface Captured {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** A response double that records what the handler did. */
function capture(): { res: ApiResponse; out: Captured } {
  const out: Captured = { status: 0, body: null, headers: {} };
  const res: ApiResponse = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
    },
    setHeader(name: string, value: string) {
      out.headers[name.toLowerCase()] = value;
    },
  };
  return { res, out };
}

function get(query: Record<string, string> = {}): ApiRequest {
  return { method: 'GET', query };
}

describe('the API handlers', () => {
  it('serves the provenance of every call it claims to have made', () => {
    const { res, out } = capture();
    provenanceHandler(get(), res);
    expect(out.status).toBe(200);
    const body = out.body as ReturnType<typeof buildProvenance>;
    expect(body.endpoints.length).toBeGreaterThan(0);
    expect(body.calls).toBe(body.endpoints.length);
    // The committed snapshot may be the offline fixture or a live pull; the API
    // must say which, and say it the same way in both cases.
    expect(['live', 'fixture']).toContain(body.source);
    expect(body.disclaimer.length).toBeGreaterThan(40);
    if (body.source === 'fixture') {
      expect(body.disclaimer).toMatch(/FIXTURE/);
    } else {
      expect(body.disclaimer).toMatch(/Live CoinMarketCap pull/);
    }
  });

  it('names the endpoint for every receipt, with its error code', () => {
    const { res, out } = capture();
    provenanceHandler(get(), res);
    const body = out.body as ReturnType<typeof buildProvenance>;
    for (const receipt of body.endpoints) {
      expect(receipt.endpoint).toMatch(/^\//);
      expect(typeof receipt.errorCode).toBe('number');
      expect(typeof receipt.credits).toBe('number');
    }
    expect(body.endpointPaths.length).toBeGreaterThan(1);
  });

  it('judges at a requested size and says what size it judged at', () => {
    const { res, out } = capture();
    judgeHandler(get({ asset: 'NVDA', sizeUsd: '250000' }), res);
    expect(out.status).toBe(200);
    const body = out.body as ReturnType<typeof judgeAtSize>;
    expect(body.sizeUsd).toBe(250_000);
    expect(body.assets.length).toBe(1);
    expect(body.assets[0]?.symbol).toBe('NVDA');
    expect(out.headers['x-size-usd']).toBe('250000');
  });

  it('refuses an asset it does not have, and says what it has', () => {
    const { res, out } = capture();
    judgeHandler(get({ asset: 'NOPE' }), res);
    expect(out.status).toBe(404);
    const body = out.body as { error: string; detail: { availableAssets: string[] } };
    expect(body.error).toMatch(/No asset matching/);
    expect(body.detail.availableAssets.length).toBeGreaterThan(0);
  });

  it('serves the findings with a reproduction each', () => {
    const { res, out } = capture();
    findingsHandler(get(), res);
    expect(out.status).toBe(200);
    const body = out.body as {
      findings: { id: string; repro?: string; severity: number }[];
      apiIssues: unknown[];
      counts: { findings: number };
    };
    expect(body.findings.length).toBeGreaterThan(0);
    expect(body.counts.findings).toBe(body.findings.length);
    for (const finding of body.findings) {
      expect(finding.repro).toMatch(/curl/);
      expect(finding.repro).not.toMatch(/X-CMC_PRO_API_KEY:\s*[A-Za-z0-9]{8}/);
    }
  });

  it('serves the snapshot with provenance headers', () => {
    const { res, out } = capture();
    snapshotHandler(get(), res);
    expect(out.status).toBe(200);
    expect(['live', 'fixture']).toContain(out.headers['x-snapshot-source']);
    expect(out.headers['content-type']).toMatch(/application\/json/);
    expect((out.body as { assets: unknown[] }).assets.length).toBeGreaterThan(0);
  });

  it('answers a preflight without doing any work', () => {
    const { res, out } = capture();
    judgeHandler({ method: 'OPTIONS', query: {} }, res);
    expect(out.status).toBe(204);
    expect(out.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('the judge logic, on the fixture', () => {
  it('changes the verdict when the size changes', () => {
    const snapshot = fixtureSnapshot();
    const small = judgeAtSize({ asset: 'NVDA', sizeUsd: 100_000 }, snapshot);
    const large = judgeAtSize({ asset: 'NVDA', sizeUsd: 50_000_000 }, snapshot);
    const capturable = (r: ReturnType<typeof judgeAtSize>): number =>
      r.crossings.filter((c) => c.verdict === 'capturable').length;
    expect(capturable(small)).toBeGreaterThan(0);
    expect(capturable(large)).toBeLessThan(capturable(small));
  });

  it('reports the trap it is built to find', () => {
    const snapshot = fixtureSnapshot();
    const result = judgeAtSize({}, snapshot);
    const trapped = result.assets.filter((a) => a.trap);
    expect(trapped.length).toBeGreaterThan(0);
    for (const asset of trapped) {
      expect(asset.cheapestOnScreen).not.toBe(asset.cheapestReachable);
    }
  });

  it('refuses a size that is not a number', () => {
    expect(parseSize('abc')).toBeNull();
    expect(parseSize('-5')).toBeNull();
    expect(parseSize('0')).toBeNull();
    expect(parseSize('250000')).toBe(250_000);
    expect(parseSize(null)).toBeNull();
    // A junk size falls back to the snapshot's own size rather than becoming NaN.
    const result = judgeAtSize({ sizeUsd: parseSize('abc') }, fixtureSnapshot());
    expect(Number.isFinite(result.sizeUsd)).toBe(true);
  });
});

describe('the API never carries a key', () => {
  it('has no key anywhere in what it serves', () => {
    const { res, out } = capture();
    provenanceHandler(get(), res);
    const text = JSON.stringify(out.body);
    expect(text).not.toMatch(/X-CMC_PRO_API_KEY['"]?\s*:\s*['"][A-Za-z0-9]{8}/);
    expect(text).not.toMatch(/CMC_API_KEY\s*=\s*[A-Za-z0-9]{8}/);
  });

  it('reads no environment variable to serve a response', () => {
    // The module has no access to process.env at all: it cannot leak a key
    // because it never looks at one.
    const source = readFileSync(new URL('../api/_core.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/process\.env/);
  });
});

describe('queryParam', () => {
  it('reads a string', () => {
    expect(queryParam({ a: 'x' }, 'a')).toBe('x');
  });

  it('takes the first of an array', () => {
    expect(queryParam({ a: ['x', 'y'] }, 'a')).toBe('x');
  });

  it('is null when absent', () => {
    expect(queryParam({}, 'a')).toBeNull();
    expect(queryParam(undefined, 'a')).toBeNull();
  });
});
