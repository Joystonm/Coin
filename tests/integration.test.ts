/**
 * The whole product, end to end, on the offline fixture.
 *
 * The fixture is not a toy. It is built so that every one of the five verdicts
 * occurs, so that the trap fires, and so that the unit and staleness findings
 * fire. If any of these stop happening, the product has lost the ability to
 * say the things it exists to say.
 *
 * These tests are also the guard against the fixture rotting: the CLI, the MCP
 * server and the web UI all read this same file, so if the fixture changes,
 * every surface changes with it.
 */

import { describe, expect, it } from 'vitest';
import { fixtureSnapshot } from '../scripts/seed.ts';
import { buildSession } from '../src/lib/session.ts';
import { analyse, detectFindings } from '../src/lib/analysis.ts';
import { VERDICT_ORDER } from '../src/lib/crossing.ts';

describe('the offline fixture', () => {
  it('is marked as a fixture so the UI can say so', () => {
    const snapshot = fixtureSnapshot();
    expect(snapshot.source).toBe('fixture');
    expect(snapshot.assets.length).toBeGreaterThan(0);
    expect(snapshot.calls.length).toBeGreaterThan(0);
  });

  it('carries a receipt for every call it claims to have made', () => {
    const snapshot = fixtureSnapshot();
    for (const call of snapshot.calls) {
      expect(call.endpoint).toMatch(/^\//);
      expect(typeof call.credits).toBe('number');
      expect(typeof call.errorCode).toBe('number');
      expect(call.at).toBeTruthy();
    }
  });

  it('exercises every one of the five verdicts', () => {
    const session = buildSession(fixtureSnapshot());
    const seen = new Set(session.analysis.crossings.map((c) => c.verdict));
    for (const verdict of VERDICT_ORDER) {
      expect(seen.has(verdict)).toBe(true);
    }
  });

  it('finds the one pair that survives its own friction', () => {
    const session = buildSession(fixtureSnapshot());
    const capturable = session.analysis.crossings.filter((c) => c.verdict === 'capturable');
    expect(capturable.length).toBeGreaterThan(0);
    for (const c of capturable) {
      expect(c.netBps).toBeGreaterThan(0);
      expect(c.costBps).not.toBeNull();
    }
  });

  it('spots the trap on at least one asset', () => {
    const session = buildSession(fixtureSnapshot());
    const traps = session.analysis.assets.filter((a) => a.trap);
    expect(traps.length).toBeGreaterThan(0);
    for (const asset of traps) {
      expect(asset.cheapestOnScreen).not.toBeNull();
      expect(asset.cheapestReachable).not.toBeNull();
      expect(asset.cheapestOnScreen?.wrapper.cryptoId).not.toBe(
        asset.cheapestReachable?.wrapper.cryptoId,
      );
    }
  });

  it('detects the data problems it is designed to detect', () => {
    const session = buildSession(fixtureSnapshot());
    const ids = session.findings.map((f) => f.id);
    expect(ids).toContain('mixed-units');
    expect(ids).toContain('stale-quotes');
    expect(ids).toContain('no-visible-venue');
    for (const finding of session.findings) {
      expect(finding.detail.length).toBeGreaterThan(40);
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.severity).toBeGreaterThanOrEqual(1);
      expect(finding.severity).toBeLessThanOrEqual(3);
    }
  });

  it('gives every finding a reproduction a reader can run', () => {
    const session = buildSession(fixtureSnapshot());
    for (const finding of session.findings) {
      expect(finding.repro).toBeTruthy();
      expect(finding.repro).toMatch(/curl/);
      // The reproduction must not carry a key.
      expect(finding.repro).not.toMatch(/X-CMC_PRO_API_KEY:\s*[A-Za-z0-9]{8}/);
    }
  });
});

describe('the analysis is a pure function of the snapshot', () => {
  it('gives the same answer every time', () => {
    const a = buildSession(fixtureSnapshot());
    const b = buildSession(fixtureSnapshot());
    expect(JSON.stringify(a.analysis.summary)).toBe(JSON.stringify(b.analysis.summary));
    expect(JSON.stringify(a.analysis.crossings)).toBe(JSON.stringify(b.analysis.crossings));
  });

  it('changes the verdict when the notional size changes', () => {
    // The same spread is capturable at $100k and not capturable at $50m: cost is
    // a function of size, so a fixed verdict would be a lie.
    const small = buildSession(fixtureSnapshot(), 100_000);
    const large = buildSession(fixtureSnapshot(), 50_000_000);
    const cheap = small.analysis.crossings.filter((c) => c.verdict === 'capturable').length;
    const rich = large.analysis.crossings.filter((c) => c.verdict === 'capturable').length;
    expect(cheap).toBeGreaterThan(0);
    expect(rich).toBeLessThan(cheap);
  });

  it('never reports a net number it cannot justify', () => {
    const session = buildSession(fixtureSnapshot());
    for (const c of session.analysis.crossings) {
      if (c.netBps == null) {
        expect(c.costBps == null || c.spreadBps == null).toBe(true);
      } else {
        expect(c.costBps).not.toBeNull();
        expect(c.spreadBps).not.toBeNull();
      }
    }
  });

  it('explains every verdict it reaches', () => {
    const session = buildSession(fixtureSnapshot());
    for (const c of session.analysis.crossings) {
      expect(c.reasons.length).toBeGreaterThan(0);
      for (const reason of c.reasons) {
        expect(reason.trim().length).toBeGreaterThan(10);
      }
    }
  });
});

describe('the analysis rejects what it cannot measure', () => {
  it('has no findings when the snapshot has nothing wrong with it', () => {
    const snapshot = fixtureSnapshot();
    // Strip every wrapper but one of one asset: nothing to compare, nothing to
    // find, and the findings list must be empty rather than padded.
    const clean = {
      ...snapshot,
      assets: [
        {
          ...(snapshot.assets[0] as NonNullable<(typeof snapshot.assets)[number]>),
          wrappers: [(snapshot.assets[0] as NonNullable<(typeof snapshot.assets)[number]>).wrappers[0]],
        },
      ],
    };
    const analysis = analyse(clean, {}, {}, { sizeUsd: 100_000, now: Date.parse(clean.generatedAt) });
    const findings = detectFindings(clean, analysis, {});
    expect(findings).toHaveLength(0);
    expect(analysis.crossings).toHaveLength(0);
  });
});
