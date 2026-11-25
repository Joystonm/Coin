/**
 * Unit detection.
 *
 * The hardest thing this product does with CoinMarketCap's data is decide
 * when a price that looks ten times too high is really a gram of gold and
 * when it is a bad print. Getting that wrong in either direction is fatal:
 * rescale a bad print and you have invented a number; refuse to rescale a gram
 * and you have lost a real signal.
 */

import { describe, expect, it } from 'vitest';
import { detectUnit, looksLikeUnitRatio, SAME_UNIT_TOLERANCE } from '../src/lib/units.ts';

describe('detectUnit', () => {
  it('leaves a price that matches its reference alone', () => {
    const detection = detectUnit(3525.19, 3525.45);
    expect(detection.factor).toBe(1);
    expect(detection.unit).toBeNull();
    expect(detection.unexplained).toBe(false);
  });

  it('normalises gold quoted per gram up to per troy ounce', () => {
    // A troy ounce is 31.1035 grams, so the gram price is the ounce price
    // divided by 31.1035.
    const detection = detectUnit(3525.19 / 31.1035, 3525.19);
    expect(detection.factor).toBeCloseTo(31.1035, 3);
    expect(detection.unit?.kind).toBe('mass');
    expect(detection.unexplained).toBe(false);
  });

  it('normalises a share-split wrapper', () => {
    // A token for 10 shares trades at 10x the price of a 1-share token.
    const detection = detectUnit(1500, 150);
    expect(detection.factor).toBeCloseTo(0.1, 6);
    expect(detection.unexplained).toBe(false);
  });

  it('refuses to rescale a ratio that is not a known unit', () => {
    // 73 against a 100 reference is neither a gram nor a split. It is a
    // dislocation, and the product must report it rather than explain it away.
    const detection = detectUnit(73, 100);
    expect(detection.factor).toBe(1);
    expect(detection.unit).toBeNull();
    expect(detection.unexplained).toBe(true);
  });

  it('treats a difference within the tolerance as the same unit', () => {
    const detection = detectUnit(110, 100);
    expect(Math.abs(detection.ratio - 1)).toBeLessThanOrEqual(SAME_UNIT_TOLERANCE);
    expect(detection.factor).toBe(1);
    expect(detection.unexplained).toBe(false);
  });

  it('returns a safe answer for a price that is not a number', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const detection = detectUnit(bad, 100);
      expect(detection.factor).toBe(1);
      expect(detection.unit).toBeNull();
    }
  });
});

describe('looksLikeUnitRatio', () => {
  it('accepts the ratios a unit could explain', () => {
    expect(looksLikeUnitRatio(31.1035)).toBe(true);
    expect(looksLikeUnitRatio(0.1)).toBe(true);
    expect(looksLikeUnitRatio(2)).toBe(true);
  });

  it('rejects a ratio no unit explains', () => {
    expect(looksLikeUnitRatio(1.369)).toBe(false);
    expect(looksLikeUnitRatio(0)).toBe(false);
  });
});
