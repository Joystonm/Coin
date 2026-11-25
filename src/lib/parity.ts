/**
 * The price side: what is a wrapper actually worth relative to its peers?
 *
 * This is the consensus anchor. It is deliberately auditable: every wrapper
 * either voted on the anchor or is excluded, and the reason is on the row.
 * A number you cannot explain is not a number you can trade.
 */

import { detectUnit, robustReference, type UnitFactor } from './units.ts';
import { median, volumeWeightedMean } from './stats.ts';
import type { Wrapper } from './types.ts';

/** A wrapper needs this much 24h volume to vote on the anchor. */
export const LIQUID_VOLUME_USD = 50_000;
/** A wrapper needs this much 24h volume to be presented as something you could trade. */
export const TRADEABLE_VOLUME_USD = 250_000;
/** Deviation from the anchor worth showing as a dislocation. */
export const DISLOCATION_BPS = 25;
/** Beyond this, an unexplained deviation means the wrapper is off-peg or its print is bad. */
export const OFF_PEG_BPS = 500;
/** CMC's own aggregate disagreeing with our anchor by this much is a data defect. */
export const AGGREGATE_GAP_BPS = 100;

export type WrapperStatus = 'ok' | 'illiquid' | 'no-volume' | 'no-price' | 'no-data';
export type AnchorMethod = 'volume-weighted mean' | 'median' | 'none';

export interface ParityRow {
  wrapper: Wrapper;
  status: WrapperStatus;
  /** Price expressed in the asset's reference unit, after unit normalisation. */
  normalizedPrice: number | null;
  /** The unit difference that was detected, if any. */
  unit: UnitFactor | null;
  /** Raw price ratio against the asset reference, before normalisation. */
  unitRatio: number | null;
  /** True when the ratio is far from any known unit factor. */
  unexplainedRatio: boolean;
  /** Far from the anchor for a reason no unit explains. */
  offPeg: boolean;
  /** True when this wrapper voted on the anchor. */
  eligible: boolean;
  /** Why this wrapper did not vote, in words. */
  excludedBecause: string | null;
  /** Deviation from the anchor, in basis points. */
  deviationBps: number | null;
  /** Deviation from the consensus of the *other* wrappers, in basis points. */
  peerDeviationBps: number | null;
  /** Share of the asset's total reported 24h wrapper volume. */
  volumeShare: number;
  /** True when this wrapper is the one the anchor is set by. */
  setsAnchor: boolean;
}

export interface ParityResult {
  /** The consensus price every wrapper is measured against. */
  anchor: number | null;
  anchorMethod: AnchorMethod;
  /** cryptoIds that voted on the anchor. */
  anchorMembers: number[];
  /** Robust reference price (median of raw prices) used for unit detection. */
  reference: number | null;
  rows: ParityRow[];
}

/** Classify a wrapper's data quality before any maths happens. */
export function statusOf(w: Pick<Wrapper, 'price' | 'volume24h'>): WrapperStatus {
  if (w.price == null) return 'no-price';
  if (!Number.isFinite(w.price) || w.price <= 0) return 'no-data';
  if (w.volume24h == null) return 'no-volume';
  if (w.volume24h < LIQUID_VOLUME_USD) return 'illiquid';
  return 'ok';
}

function bps(value: number | null, reference: number | null): number | null {
  if (value == null || reference == null || reference === 0) return null;
  return (value / reference - 1) * 10_000;
}

/**
 * Compute the consensus anchor and every wrapper's standing against it.
 *
 * Pure: no clock, no network, no globals. The same function produces the number
 * in the data file and the number on the screen.
 */
export function computeParity(wrappers: readonly Wrapper[]): ParityResult {
  const priced = wrappers.filter((w) => w.price != null && w.price > 0);
  // The reference is the price level the majority of the wrappers agree on.
  // A plain median would land between two units when the split is even, and
  // then explain neither of them.
  const rawReference = robustReference(
    priced.map((w) => w.price as number),
    priced.map((w) => w.volume24h ?? 0),
  );

  const normalised = wrappers.map<ParityRow>((wrapper) => {
    const status = statusOf(wrapper);
    if (status === 'no-price' || status === 'no-data' || rawReference == null) {
      return {
        wrapper,
        status,
        normalizedPrice: null,
        unit: null,
        unitRatio: null,
        unexplainedRatio: false,
        offPeg: false,
        eligible: false,
        excludedBecause:
          status === 'no-price'
            ? 'no price reported'
            : status === 'no-data'
              ? 'price is not a positive number'
              : 'no peer to compare against',
        deviationBps: null,
        peerDeviationBps: null,
        volumeShare: 0,
        setsAnchor: false,
      };
    }
    const detection = detectUnit(wrapper.price as number, rawReference);
    const normalizedPrice = (wrapper.price as number) * detection.factor;
    return {
      wrapper,
      status,
      normalizedPrice,
      unit: detection.unit,
      unitRatio: detection.ratio,
      unexplainedRatio: detection.unexplained,
      offPeg: false,
      eligible: false,
      excludedBecause: null,
      deviationBps: null,
      peerDeviationBps: null,
      volumeShare: 0,
      setsAnchor: false,
    };
  });

  // A wrapper far from the reference median is only "off-peg" if some wrapper is
  // actually near it. If every price is dispersed, there is no peg to be off.
  const farFromReference = (r: ParityRow) =>
    r.normalizedPrice != null &&
    rawReference != null &&
    Math.abs((r.normalizedPrice / rawReference - 1) * 10_000) >= OFF_PEG_BPS;
  const anyInBand = normalised.some((r) => !farFromReference(r));

  const totalVolume = wrappers.reduce((s, w) => s + (w.volume24h ?? 0), 0);

  const flagged = normalised.map<ParityRow>((r) => {
    const offPeg = anyInBand && farFromReference(r) && r.unit == null && !r.unexplainedRatio;
    const excludedBecause =
      r.status !== 'ok'
        ? r.excludedBecause
        : offPeg
          ? `off-peg: ${(((r.normalizedPrice as number) / (rawReference as number) - 1) * 10_000).toFixed(0)} bps from the peer median with no unit to explain it`
          : r.unexplainedRatio
            ? `unexplained price ratio ${(r.unitRatio as number).toFixed(2)}x: not a known unit, not a known dislocation`
            : null;
    return {
      ...r,
      offPeg,
      eligible: r.status === 'ok' && !offPeg && !r.unexplainedRatio,
      excludedBecause,
      volumeShare: totalVolume > 0 ? (r.wrapper.volume24h ?? 0) / totalVolume : 0,
    };
  });

  const voters = flagged.filter((r) => r.eligible);
  let anchorMethod: AnchorMethod = 'volume-weighted mean';
  let anchor = volumeWeightedMean(
    voters.map((r) => ({ value: r.normalizedPrice as number, weight: r.wrapper.volume24h as number })),
  );
  if (anchor == null) {
    anchorMethod = 'median';
    anchor = median(voters.map((r) => r.normalizedPrice as number));
    if (anchor == null) {
      anchorMethod = 'none';
      anchor = null;
    }
  }

  const withDeviations = flagged.map<ParityRow>((r) => {
    const peers = flagged.filter((o) => o.eligible && o.wrapper.cryptoId !== r.wrapper.cryptoId);
    const peerAnchor = volumeWeightedMean(
      peers.map((p) => ({ value: p.normalizedPrice as number, weight: p.wrapper.volume24h as number })),
    );
    const setsAnchor =
      anchor != null &&
      r.eligible &&
      r.normalizedPrice != null &&
      Math.abs(r.normalizedPrice - anchor) < 1e-9 &&
      r.wrapper.volume24h === Math.max(...voters.map((v) => v.wrapper.volume24h ?? 0));
    return {
      ...r,
      deviationBps: bps(r.normalizedPrice, anchor),
      peerDeviationBps: bps(r.normalizedPrice, peerAnchor),
      setsAnchor,
    };
  });

  return {
    anchor,
    anchorMethod,
    anchorMembers: voters.map((r) => r.wrapper.cryptoId),
    reference: rawReference,
    rows: withDeviations,
  };
}

/** Wrappers with enough volume to be presented as something you could trade. */
export function tradeableRows(rows: readonly ParityRow[]): ParityRow[] {
  return rows.filter((r) => r.eligible && (r.wrapper.volume24h ?? 0) >= TRADEABLE_VOLUME_USD);
}

/** The cheapest and richest wrappers that voted on the anchor. */
export function extremes(rows: readonly ParityRow[]): {
  cheapest: ParityRow | null;
  richest: ParityRow | null;
} {
  const voters = rows.filter((r) => r.eligible && r.deviationBps != null);
  if (voters.length < 2) return { cheapest: null, richest: null };
  const sorted = [...voters].sort((a, b) => (a.deviationBps as number) - (b.deviationBps as number));
  return { cheapest: sorted[0] as ParityRow, richest: sorted[sorted.length - 1] as ParityRow };
}

/** Spread between the cheapest and richest voting wrapper, in basis points. */
export function spreadBps(cheapest: ParityRow | null, richest: ParityRow | null): number | null {
  if (!cheapest || !richest) return null;
  const a = cheapest.normalizedPrice;
  const b = richest.normalizedPrice;
  if (a == null || b == null || a === 0) return null;
  return (b / a - 1) * 10_000;
}

/**
 * Leave-one-out issuer tracking error.
 *
 * A wrapper is scored against the consensus of the *other* wrappers of its
 * asset, so the largest wrapper cannot grade itself.
 */
export function issuerTrackingError(
  rows: readonly ParityRow[],
  issuerId: string | null,
): { medianAbsPeerDeviationBps: number | null; medianPeerDeviationBps: number | null; sample: number } {
  if (!issuerId) return { medianAbsPeerDeviationBps: null, medianPeerDeviationBps: null, sample: 0 };
  const own = rows.filter(
    (r) => r.eligible && r.wrapper.issuerId === issuerId && r.unit == null && r.peerDeviationBps != null,
  );
  const devs = own.map((r) => r.peerDeviationBps as number);
  const abs = devs.map((d) => Math.abs(d));
  return {
    medianAbsPeerDeviationBps: median(abs),
    medianPeerDeviationBps: median(devs),
    sample: own.length,
  };
}
