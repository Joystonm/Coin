/**
 * Formatting.
 *
 * One rule everywhere: a number that was not measured says so. There is no
 * dash, no em-dash, no zero standing in for a missing measurement. `null` and
 * `undefined` become words.
 */

/** Rendered wherever a figure could not be measured. */
export const NOT_MEASURED = 'not measured';

/** Rendered where the data says "unknown" explicitly (e.g. freshness). */
export const UNKNOWN = 'unknown';

export function isKnown(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** Format a number that may be absent. Absent becomes `not measured`. */
export function num(
  value: number | null | undefined,
  fmt: (n: number) => string,
  fallback: string = NOT_MEASURED,
): string {
  if (!isKnown(value)) return fallback;
  return fmt(value);
}

/** Signed basis points, e.g. `-32.6 bps`. */
export function bps(value: number | null | undefined, dp = 1): string {
  return num(value, (n) => `${n >= 0 ? '+' : ''}${n.toFixed(dp)} bps`);
}

/** Unsigned basis points, e.g. `41.7 bps`. */
export function bpsAbs(value: number | null | undefined, dp = 1): string {
  return num(value, (n) => `${n.toFixed(dp)} bps`);
}

export function pct(value: number | null | undefined, dp = 1): string {
  return num(value, (n) => `${n.toFixed(dp)}%`);
}

export function int(value: number | null | undefined): string {
  return num(value, (n) => n.toLocaleString('en-US'));
}

/** Compact USD: `$48.0M`, `$1.2k`, `$0`. */
export function usd(value: number | null | undefined, dp = 1): string {
  return num(value, (n) => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(dp)}B`;
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(dp)}M`;
    if (abs >= 1_000) return `$${(n / 1_000).toFixed(dp)}k`;
    return `$${n.toFixed(2)}`;
  });
}

/** Full USD with thousands separators: `$48,000,000`. */
export function usdFull(value: number | null | undefined): string {
  return num(value, (n) => `$${Math.round(n).toLocaleString('en-US')}`);
}

/** A token price. Uses enough decimals to distinguish 88.37 from 88.371. */
export function price(value: number | null | undefined): string {
  return num(value, (n) => {
    if (n === 0) return '0.00';
    if (Math.abs(n) >= 1000) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(4);
    return n.toFixed(6);
  });
}

/** Days, with sub-day precision kept and never rounded down to zero. */
export function days(value: number | null | undefined): string {
  return num(value, (n) => {
    const hours = n * 24;
    if (hours < 1) return `${(hours * 60).toFixed(1)} minutes`;
    if (n < 1) return `${hours.toFixed(1)} hours`;
    return `${n.toFixed(2)} days`;
  });
}

/** An ISO timestamp, rendered as itself plus a relative age. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return NOT_MEASURED;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

/**
 * An elapsed duration, rendered as a relative age.
 *
 * `ms` is a duration, not a timestamp — `DepthAssessment.quoteAgeMs` is the
 * age of the quote, not the moment it was struck.
 */
export function ago(ms: number | null | undefined): string {
  if (!isKnown(ms)) return 'at an unknown time';
  const minutes = ms / 60_000;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)} minutes ago`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} hours ago`;
  return `${(hours / 24).toFixed(1)} days ago`;
}
