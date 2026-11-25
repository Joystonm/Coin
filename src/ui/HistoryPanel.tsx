/**
 * The time-series arm, on the asset page.
 *
 * The other two arms — parity and execution — look across wrappers right now.
 * This one looks at the same asset through time, from CoinMarketCap's own
 * historical endpoint, and it answers a different question: how much does
 * this thing move on its own?
 *
 * A gap of 50 bps between two wrappers of NVDA is a real number. Whether it
 * is an opportunity depends on whether NVDA's tokenized price moves 50 bps in
 * a day anyway. This panel is where that comparison is made visible.
 *
 * When there is no history the panel says so. It never draws an empty chart
 * and never implies the asset is calm.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Panel } from './components.tsx';
import { num } from './format.ts';
import { gapVsOwnVolatility, positionInHistory, stabilityOfSeries } from '../lib/history.ts';

export function HistoryPanel({
  symbol,
  points,
  hasHistory,
  anchor,
  spreadBps,
}: {
  symbol: string;
  points: { timestamp: string; price: number | null }[];
  hasHistory: boolean;
  anchor: number | null;
  spreadBps: number | null;
}) {
  if (!hasHistory || points.length === 0) {
    return (
      <Panel
        title="time series"
        note="/v5/real-world-assets/quotes/historical"
        right={<span className="panel-note">not loaded</span>}
      >
        <p className="tiny" style={{ margin: 0 }}>
          No history for <span className="mono">{symbol}</span> in this build. The time-series arm
          is the one that answers &ldquo;how much does this asset move on its own?&rdquo;, and
          without it the product says nothing about volatility — it does not assume the asset is
          calm. Pull it with <span className="mono">npm run history</span> and a CoinMarketCap key.
        </p>
      </Panel>
    );
  }

  const series = points
    .filter((p) => p.price != null)
    .map((p) => ({
      day: p.timestamp.slice(5, 10),
      price: p.price as number,
    }));

  const stability = stabilityOfSeries(
    points.map((p) => ({
      timestamp: p.timestamp,
      price: p.price,
      tokenizedMarketCap: null,
      tokenizedVolume24h: null,
    })),
  );

  const moves = series
    .slice(1)
    .map((p, i) => (p.price / (series[i]?.price as number) - 1) * 10_000)
    .map(Math.abs)
    .sort((a, b) => a - b);
  const medianMove = moves.length ? (moves[Math.floor(moves.length / 2)] ?? null) : null;
  const p95Move = moves.length
    ? (moves[Math.min(moves.length - 1, Math.floor(moves.length * 0.95))] ?? null)
    : null;
  const maxMove = moves.length ? (moves[moves.length - 1] ?? null) : null;

  const last = series[series.length - 1]?.price ?? null;
  const position = positionInHistory(
    last,
    points.map((p) => ({
      timestamp: p.timestamp,
      price: p.price,
      tokenizedMarketCap: null,
      tokenizedVolume24h: null,
    })),
  );

  const volatility = gapVsOwnVolatility(spreadBps, {
    observations: points.length,
    from: points[0]?.timestamp ?? null,
    to: points[points.length - 1]?.timestamp ?? null,
    medianPrice: null,
    medianAbsMoveBps: medianMove,
    p95AbsMoveBps: p95Move,
    maxAbsMoveBps: maxMove,
    dailyStdevBps: null,
    totalMoveBps: null,
    thin: points.length < 8,
  });

  const prices = series.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * 0.18, hi * 0.0005);

  return (
    <Panel
      title="time series"
      note="/v5/real-world-assets/quotes/historical"
      bodyClass="chart-panel-body"
      right={<span className="panel-note">{points.length} days</span>}
    >
      <div className="chart-wrap" style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 10, right: 16, bottom: 20, left: 0 }} data={series}>
            <CartesianGrid strokeDasharray="2 5" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: '#69727f' }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              type="number"
              domain={[lo - pad, hi + pad]}
              tick={{ fontSize: 10, fill: '#69727f' }}
              width={56}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            />
            {anchor != null ? (
              <ReferenceLine
                y={anchor}
                stroke="#b18cff"
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                label={{
                  value: 'our anchor',
                  position: 'insideTopLeft',
                  fill: '#8b93a1',
                  fontSize: 9,
                }}
              />
            ) : null}
            <Tooltip
              cursor={{ stroke: '#2a313b' }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload[0]?.payload as { day: string; price: number } | undefined;
                if (!point) return null;
                return (
                  <div className="recharts-default-tooltip">
                    <div className="recharts-tooltip-label">{point.day}</div>
                    <div className="tip-row">
                      <span>aggregate</span>
                      <span>${point.price.toFixed(4)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#35d6a4"
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>Median daily move</dt>
        <dd>
          <b>{num(medianMove, (n) => `${n.toFixed(1)} bps`)}</b>
          {medianMove != null ? (
            <span className="tiny"> · the floor a gap has to beat</span>
          ) : null}
        </dd>
        <dt>95th percentile move</dt>
        <dd>{num(p95Move, (n) => `${n.toFixed(1)} bps`)}</dd>
        <dt>Largest move</dt>
        <dd>{num(maxMove, (n) => `${n.toFixed(1)} bps`)}</dd>
        <dt>Where today's price sits</dt>
        <dd>
          {position.percentile == null ? (
            'unknown'
          ) : (
            <>
              <b>{position.percentile.toFixed(0)}th percentile</b>{' '}
              <span className="tiny">of {position.n} observed days</span>
            </>
          )}
        </dd>
        <dt>Level</dt>
        <dd className="tiny">{stability.note}</dd>
      </dl>

      {spreadBps != null && volatility.ordinary != null ? (
        <p className="tiny" style={{ marginTop: 8, marginBottom: 0 }}>
          {volatility.ordinary
            ? `The widest gap on this asset is smaller than a normal day's move — ${volatility.basis}.`
            : `The widest gap on this asset stands clear of the asset's own noise — ${volatility.basis}.`}
        </p>
      ) : null}
    </Panel>
  );
}
