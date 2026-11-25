/**
 * Shared atoms.
 *
 * Small, dense, and consistent: the same table cell, the same verdict chip and
 * the same "not measured" marker everywhere, so the reader learns the shape of
 * the data once.
 */

import { useState, type ReactNode } from 'react';
import { NOT_MEASURED, isKnown } from './format.ts';
import { VERDICT_META } from './theme.ts';
import type { CrossingVerdict } from '../lib/crossing.ts';

/* ------------------------------------------------------------------ panel */

export function Panel({
  title,
  note,
  right,
  children,
  flush,
  bodyClass,
}: {
  title?: string;
  note?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  /** Extra class on the body, for panels whose content must fill the panel. */
  bodyClass?: string;
}) {
  const body = ['panel-body', flush ? 'flush' : '', bodyClass ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <section className="panel">
      {(title || right || note) && (
        <header className="panel-head">
          {title ? <h2>{title}</h2> : null}
          {note ? <span className="panel-note">{note}</span> : null}
          {right ? (
            <>
              <span className="spacer" />
              {right}
            </>
          ) : null}
        </header>
      )}
      <div className={body}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------- stat */

export function Stat({
  label,
  value,
  unit,
  sub,
  tone,
  small,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  tone?: 'green' | 'amber' | 'violet' | 'accent';
  small?: boolean;
}) {
  return (
    <div className={tone ? `stat tone-${tone}` : 'stat'}>
      <div className="stat-label">{label}</div>
      <div className={small ? 'stat-value sm' : 'stat-value'}>
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- values */

/**
 * A figure. When the figure was not measured, this says so in words and marks
 * itself as unknown — it never renders a zero or a dash.
 */
export function Val({
  value,
  fmt,
  tone,
  title,
}: {
  value: number | null | undefined;
  fmt: (n: number) => string;
  tone?: 'pos' | 'neg';
  title?: string;
}) {
  if (!isKnown(value)) {
    return (
      <span className="val val-unknown" title="not measured — the data does not carry this figure">
        {NOT_MEASURED}
      </span>
    );
  }
  return (
    <span className={tone ? `val ${tone}` : 'val'} title={title}>
      {fmt(value)}
    </span>
  );
}

/** Tone for a signed figure: green when positive, red when negative. */
export function signTone(value: number | null | undefined): 'pos' | 'neg' | undefined {
  if (!isKnown(value) || value === 0) return undefined;
  return value > 0 ? 'pos' : 'neg';
}

/* ---------------------------------------------------------------- verdict */

export function VerdictTag({ verdict }: { verdict: CrossingVerdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <span className="verdict" style={{ color: meta.color }} title={meta.meaning}>
      <span className="sq" />
      {meta.label}
    </span>
  );
}

export function VerdictChip({ verdict }: { verdict: CrossingVerdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <span className="chip solid" style={{ background: meta.color }}>
      {meta.label}
    </span>
  );
}

/* --------------------------------------------------------------- endpoint */

export function Endpoint({ endpoint }: { endpoint: string }) {
  return <span className="endpoint">{endpoint}</span>;
}

/* ----------------------------------------------------------------- copy */

export function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <button
      type="button"
      className={state === 'done' ? 'copy done' : 'copy'}
      onClick={() => {
        const clipboard = navigator.clipboard;
        if (clipboard?.writeText) {
          clipboard.writeText(text).then(
            () => {
              setState('done');
              window.setTimeout(() => setState('idle'), 1600);
            },
            () => setState('failed'),
          );
        } else {
          setState('failed');
        }
      }}
    >
      {state === 'done' ? 'copied' : state === 'failed' ? 'copy failed' : label}
    </button>
  );
}

/* ------------------------------------------------------------------- misc */

export function Crumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <div className="crumbs">
      {items.map((item, i) => (
        <span key={item.label}>
          {i > 0 ? <span>/</span> : null}
          {item.href ? <a href={item.href}>{item.label}</a> : item.label}
        </span>
      ))}
    </div>
  );
}

export function Flag({ children, tone }: { children: ReactNode; tone?: 'on' | 'bad' }) {
  return <span className={tone ? `flag ${tone}` : 'flag'}>{children}</span>;
}
