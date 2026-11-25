/**
 * Radar — the home page.
 *
 * The headline is the trap: the cheapest wrapper on the screen is often not the
 * cheapest one you can buy. Everything below that headline is the evidence.
 */

import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

import { Panel, Stat, Val, VerdictTag, signTone } from './components.tsx';
import { int, isKnown, num, pct } from './format.ts';
import { VERDICT_META, VERDICT_ORDER } from './theme.ts';
import { assetHref } from './router.ts';
import type { AppData } from './data.ts';
import type { CrossingPair, CrossingVerdict } from '../lib/crossing.ts';

interface Point {
  x: number;
  y: number;
  asset: string;
  cheap: string;
  rich: string;
  verdict: CrossingVerdict;
  net: number;
}

function niceCeil(value: number): number {
  if (value <= 0) return 10;
  const step = value >= 400 ? 100 : value >= 100 ? 50 : 20;
  return Math.ceil(value / step) * step;
}

export function Radar({ data }: { data: AppData }) {
  const { snapshot, analysis } = data;
  const s = analysis.summary;

  /* ---- counts that the summary does not carry, derived from the same rows */
  let voting = 0;
  let stale = 0;
  let noPool = 0;
  for (const asset of analysis.assets) {
    for (const row of asset.rows) {
      if (!row.eligible) continue;
      voting += 1;
      const d = asset.depths[row.wrapper.cryptoId];
      if (!d) continue;
      if (d.priceStale) stale += 1;
      if (d.tradeability === 'unknown') noPool += 1;
    }
  }
  const traps = analysis.assets.filter((a) => a.trap);
  const assetsWithPairs = analysis.assets.filter((a) => a.crossings.length > 0).length;

  /* ---- split the judged pairs into priced and unpriced */
  const plotted: Point[] = [];
  const unpriced: CrossingPair[] = [];
  for (const c of analysis.crossings) {
    if (!isKnown(c.spreadBps)) {
      unpriced.push(c);
      continue;
    }
    if (!isKnown(c.costBps)) {
      unpriced.push(c);
      continue;
    }
    plotted.push({
      x: c.spreadBps,
      y: c.costBps,
      asset: c.assetSymbol,
      cheap: c.cheap.wrapper.symbol,
      rich: c.rich.wrapper.symbol,
      verdict: c.verdict,
      net: c.netBps ?? 0,
    });
  }
  const byVerdict = new Map<CrossingVerdict, Point[]>();
  for (const v of VERDICT_ORDER) byVerdict.set(v, []);
  for (const p of plotted) byVerdict.get(p.verdict)?.push(p);

  const axisMax = niceCeil(
    Math.max(...plotted.map((p) => Math.max(p.x, p.y)), 20),
  );

  const verdictCounts = VERDICT_ORDER.map((v) => ({
    verdict: v,
    label: VERDICT_META[v].short,
    full: VERDICT_META[v].label,
    count: s.byVerdict[v] ?? 0,
    color: VERDICT_META[v].color,
  }));

  const belowLine = plotted.filter((p) => p.y < p.x).length;
  const aboveLine = plotted.filter((p) => p.y >= p.x).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Radar<span className="accent">.</span>
          </h1>
          <p className="page-sub">
            Every tokenized wrapper of every scanned asset, judged on whether its spread can
            actually be captured after both legs of the round trip are paid for. Prices from{' '}
            <span className="mono">/v5/real-world-assets/quotes/latest</span>; execution from{' '}
            <span className="mono">/v1/dex/token/pools</span>.
          </p>
        </div>
        <div className="page-actions">
          <span className="tiny">
            notional ${snapshot.scope.sizeUsd.toLocaleString('en-US')} · snapshot{' '}
            {snapshot.generatedAt}
          </span>
        </div>
      </div>

      <div className="stats">
        <Stat
          label="assets scanned"
          value={int(s.assetsScanned)}
          sub={
            <>
              of <b>{int(snapshot.scope.assetsRequested)}</b> requested, from{' '}
              <b>{int(snapshot.universe.totalAssets)}</b> in the RWA universe
            </>
          }
        />
        <Stat
          label="wrappers seen"
          value={int(s.wrappersSeen)}
          sub={
            <>
              <b>{int(s.wrappersPriced)}</b> with a price · <b>{int(s.wrappersWithDepth)}</b> with a
              priced DEX pool
            </>
          }
        />
        <Stat
          label="pairs judged"
          value={int(s.pairsJudged)}
          sub={
            <>
              across <b>{int(assetsWithPairs)}</b> asset{assetsWithPairs === 1 ? '' : 's'} with two
              or more voting wrappers
            </>
          }
        />
        <Stat
          label="capturable share"
          tone="green"
          value={isKnown(s.capturableShare) ? pct(s.capturableShare) : 'not measured'}
          small={!isKnown(s.capturableShare)}
          sub={
            <>
              <b>
                {int(s.byVerdict.capturable ?? 0)} of {int(s.pairsJudged)}
              </b>{' '}
              spreads survive their own round-trip cost
            </>
          }
        />
        <Stat
          label="trap share"
          tone="violet"
          value={isKnown(s.trapShare) ? pct(s.trapShare) : 'not measured'}
          small={!isKnown(s.trapShare)}
          sub={
            <>
              <b>
                {int(traps.length)} of {int(s.assetsScanned)}
              </b>{' '}
              assets: the screen's cheapest wrapper is not the one you can buy
            </>
          }
        />
        <Stat
          label="stale share"
          tone="amber"
          value={isKnown(s.staleShare) ? pct(s.staleShare) : 'not measured'}
          small={!isKnown(s.staleShare)}
          sub={
            <>
              <b>
                {int(stale)} of {int(voting)}
              </b>{' '}
              voting wrappers quote a price more than a day old
            </>
          }
        />
      </div>

      <div style={{ height: 14 }} />

      <div className="thesis">
        <h3>
          The cheapest wrapper on the screen is often not the cheapest one you can buy.
        </h3>
        <p>
          A screener compares two prices and calls the cheaper one a buy. Capturing the gap means
          buying the cheap side and selling the rich side — paying price impact on both legs, and
          crossing chains and issuers if the two wrappers live apart. This page prices that round
          trip and reports the share of spreads that survive it.
        </p>
        <div className="proof">
          <span>
            median spread <b>{num(s.medianSpreadBps, (n) => `${n.toFixed(1)} bps`)}</b>
          </span>
          <span>
            median round-trip cost <b>{num(s.medianCostBps, (n) => `${n.toFixed(1)} bps`)}</b>
          </span>
          <span>
            median net <b>{num(s.medianNetBps, (n) => `${n.toFixed(1)} bps`)}</b>
          </span>
          <span>
            wrappers with no priced pool <b>{isKnown(s.noPoolShare) ? pct(s.noPoolShare) : 'not measured'}</b>
          </span>
          <span>
            CMC aggregate vs our anchor, median gap{' '}
            <b>{num(s.aggregateGapBps, (n) => `${n.toFixed(1)} bps`)}</b> over{' '}
            <b>{int(s.aggregateGapAssets)}</b> asset{s.aggregateGapAssets === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div style={{ height: 14 }} />

      <div className="grid cols-60-40">
        <Panel
          title="spread vs cost of the round trip"
          note="each point is one judged pair"
          bodyClass="chart-panel-body"
          right={
            <span className="panel-note">
              {int(plotted.length)} priced · {int(unpriced.length)} not priceable
            </span>
          }
        >
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 14, right: 22, bottom: 26, left: 0 }}>
                <CartesianGrid strokeDasharray="2 5" />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[0, axisMax]}
                  allowDecimals={false}
                  tickFormatter={(v: number) => String(v)}
                  label={{
                    value: 'spread between the two wrappers (bps)',
                    position: 'insideBottom',
                    offset: -16,
                    fill: '#69727f',
                    fontSize: 10,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[0, axisMax]}
                  allowDecimals={false}
                  tickFormatter={(v: number) => String(v)}
                  width={46}
                  label={{
                    value: 'round-trip cost (bps)',
                    angle: -90,
                    position: 'insideLeft',
                    offset: 14,
                    fill: '#69727f',
                    fontSize: 10,
                  }}
                />
                <ReferenceLine
                  ifOverflow="extendDomain"
                  segment={[
                    { x: 0, y: 0 },
                    { x: axisMax, y: axisMax },
                  ]}
                  stroke="#ff6b6b"
                  strokeOpacity={0.55}
                  strokeDasharray="5 5"
                  label={{
                    value: 'break-even: cost = spread',
                    position: 'insideTopRight',
                    fill: '#8b93a1',
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  cursor={{ stroke: '#2a313b' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const point = payload[0]?.payload as Point | undefined;
                    if (!point) return null;
                    return (
                      <div className="recharts-default-tooltip">
                        <div className="recharts-tooltip-label">
                          {point.asset} · {point.cheap} → {point.rich}
                        </div>
                        <div className="tip-row">
                          <span>spread</span>
                          <span>{point.x.toFixed(1)} bps</span>
                        </div>
                        <div className="tip-row">
                          <span>round-trip cost</span>
                          <span>{point.y.toFixed(1)} bps</span>
                        </div>
                        <div className="tip-row">
                          <span>net</span>
                          <span style={{ color: VERDICT_META[point.verdict].color }}>
                            {point.net >= 0 ? '+' : ''}
                            {point.net.toFixed(1)} bps
                          </span>
                        </div>
                        <div className="tip-row">
                          <span>verdict</span>
                          <span style={{ color: VERDICT_META[point.verdict].color }}>
                            {VERDICT_META[point.verdict].label}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                {VERDICT_ORDER.map((verdict) => {
                  const points = byVerdict.get(verdict) ?? [];
                  if (points.length === 0) return null;
                  return (
                    <Scatter
                      key={verdict}
                      data={points}
                      fill={VERDICT_META[verdict].color}
                      fillOpacity={0.9}
                      shape="circle"
                      isAnimationActive={false}
                    />
                  );
                })}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            {VERDICT_ORDER.map((verdict) => (
              <span key={verdict}>
                <i style={{ background: VERDICT_META[verdict].color }} />
                {VERDICT_META[verdict].label} · {int(s.byVerdict[verdict] ?? 0)}
              </span>
            ))}
          </div>
          <p className="tiny chart-note">
            A point below the dashed line has a spread larger than the cost of executing it.{' '}
            {belowLine === 0 && aboveLine === plotted.length
              ? 'No priced point falls below it: every spread in this snapshot is eaten by its own friction.'
              : `${belowLine} of ${int(plotted.length)} priced points fall below it and ${aboveLine} sit above it.`}{' '}
            Pairs whose execution cost could not be priced are not plotted — their cost is unknown,
            not zero.
          </p>
        </Panel>

        <div>
          <Panel title="verdicts" note={`${int(s.pairsJudged)} pairs judged`}>
            <div className="chart-wrap sm">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={verdictCounts}
                  layout="vertical"
                  margin={{ top: 4, right: 26, bottom: 4, left: 4 }}
                  barCategoryGap={6}
                >
                  <XAxis type="number" allowDecimals={false} hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={92}
                    tick={{ fontSize: 10, fill: '#97a0af' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[0]?.payload as
                        | { label: string; full: string; count: number; verdict: CrossingVerdict }
                        | undefined;
                      if (!row) return null;
                      return (
                        <div className="recharts-default-tooltip">
                          <div className="recharts-tooltip-label">{row.full}</div>
                          <div className="tip-row">
                            <span>pairs</span>
                            <span>{row.count}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 0, 2, 2]} isAnimationActive={false}>
                    {verdictCounts.map((entry) => (
                      <Cell key={entry.verdict} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-legend" style={{ paddingBottom: 6 }}>
              {verdictCounts
                .filter((v) => v.count > 0)
                .map((v) => (
                  <span key={v.verdict}>
                    <i style={{ background: v.color }} />
                    {v.full} · {v.count}
                  </span>
                ))}
            </div>
          </Panel>

          <Panel
            title="not priceable"
            note={`${int(unpriced.length)} of ${int(s.pairsJudged)}`}
            flush
          >
            {unpriced.length === 0 ? (
              <div className="empty">Every judged pair had a measurable execution cost.</div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Pair</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {unpriced.map((c) => (
                    <tr key={`${c.assetSymbol}-${c.cheap.wrapper.cryptoId}-${c.rich.wrapper.cryptoId}`}>
                      <td>
                        <a href={assetHref(c.assetSymbol)} className="sym">
                          {c.assetSymbol}
                        </a>
                      </td>
                      <td className="mono">
                        {c.cheap.wrapper.symbol} → {c.rich.wrapper.symbol}
                        <span className="sub">execution cost unknown — not zero</span>
                      </td>
                      <td>
                        <VerdictTag verdict={c.verdict} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>

      <div style={{ height: 14 }} />

      <Panel
        title="every judged pair"
        note="click a row for the asset"
        flush
        right={
          <span className="panel-note">
            prices /v5/real-world-assets/quotes/latest · depth /v1/dex/token/pools
          </span>
        }
      >
        {analysis.crossings.length === 0 ? (
          <div className="empty">
            No pair could be judged: no asset had two wrappers with a usable price and volume.
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Cheap side</th>
                <th>Rich side</th>
                <th className="n">Spread</th>
                <th className="n">Cost</th>
                <th className="n">Net</th>
                <th>Route</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {analysis.crossings.map((c) => (
                <tr
                  key={`${c.assetSymbol}-${c.cheap.wrapper.cryptoId}-${c.rich.wrapper.cryptoId}`}
                  className="clickable"
                  onClick={() => {
                    window.location.hash = assetHref(c.assetSymbol);
                  }}
                >
                  <td className="asset-cell">
                    <a href={assetHref(c.assetSymbol)}>{c.assetSymbol}</a>
                    <span className="sub">{c.assetName}</span>
                  </td>
                  <td>
                    <span className="sym">{c.cheap.wrapper.symbol}</span>
                    <span className="sub">{c.cheap.wrapper.issuerName ?? 'issuer unknown'}</span>
                  </td>
                  <td>
                    <span className="sym">{c.rich.wrapper.symbol}</span>
                    <span className="sub">{c.rich.wrapper.issuerName ?? 'issuer unknown'}</span>
                  </td>
                  <td className="n">
                    <Val value={c.spreadBps} fmt={(n) => `${n.toFixed(1)}`} />
                    <span className="sub">bps</span>
                  </td>
                  <td className="n">
                    <Val value={c.costBps} fmt={(n) => `${n.toFixed(1)}`} />
                    <span className="sub">bps</span>
                  </td>
                  <td className="n">
                    <Val
                      value={c.netBps}
                      fmt={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`}
                      tone={signTone(c.netBps)}
                    />
                    <span className="sub">bps</span>
                  </td>
                  <td>
                    {c.chainMismatch ? (
                      <span className="flag bad">cross-chain</span>
                    ) : c.issuerMismatch ? (
                      <span className="flag on">cross-issuer</span>
                    ) : (
                      <span className="flag">same chain</span>
                    )}
                    <span className="sub">
                      {c.chainMismatch
                        ? 'bridge not priced'
                        : c.issuerMismatch
                          ? 'redemption, not a swap'
                          : 'one venue, one issuer'}
                    </span>
                  </td>
                  <td>
                    <VerdictTag verdict={c.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div style={{ height: 14 }} />

      <Panel title="assets in scope" note="open one for the full wrapper ledger" flush>
        <table className="data">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>Type</th>
              <th className="n">Wrappers</th>
              <th className="n">Voting</th>
              <th className="n">Anchor</th>
              <th className="n">Anchor method</th>
              <th>Cheapest on screen</th>
              <th>Cheapest you can buy</th>
              <th>Trap</th>
              <th className="n">Pairs</th>
            </tr>
          </thead>
          <tbody>
            {analysis.assets.map((a) => (
              <tr
                key={a.asset.slug || a.asset.symbol}
                className="clickable"
                onClick={() => {
                  window.location.hash = assetHref(a.asset.symbol);
                }}
              >
                <td className="asset-cell">
                  <a href={assetHref(a.asset.symbol)}>{a.asset.symbol}</a>
                </td>
                <td>{a.asset.name}</td>
                <td className="muted">{a.asset.assetType.replace(/_/g, ' ')}</td>
                <td className="n">{a.rows.length}</td>
                <td className="n">{a.rows.filter((r) => r.eligible).length}</td>
                <td className="n">
                  <Val value={a.anchor} fmt={(n) => `$${n.toFixed(2)}`} />
                </td>
                <td className="muted">{a.anchorMethod}</td>
                <td className="mono">{a.cheapestOnScreen?.wrapper.symbol ?? 'not measured'}</td>
                <td className="mono">
                  {a.cheapestReachable
                    ? a.cheapestReachable.wrapper.symbol
                    : 'not measured — no wrapper is tradeable at this size'}
                </td>
                <td>
                  {a.trap ? (
                    <span className="flag bad">trap</span>
                  ) : a.cheapestReachable ? (
                    <span className="flag">no</span>
                  ) : (
                    <span className="flag">not measured</span>
                  )}
                </td>
                <td className="n">{a.crossings.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div style={{ height: 14 }} />

      <Panel title="reading the numbers">
        <div className="grid cols-2">
          <div>
            <p className="tiny" style={{ marginTop: 0 }}>
              <b style={{ color: 'var(--txt-2)' }}>Spread</b> — the gap between the two wrappers
              after their prices are put in the same unit. It is a comparison, not a trade.
            </p>
            <p className="tiny">
              <b style={{ color: 'var(--txt-2)' }}>Cost</b> — the price impact of buying the cheap
              side and selling the rich side, each side priced against the visible USD liquidity of
              the pools CoinMarketCap reports. It is charged on both legs.
            </p>
            <p className="tiny">
              <b style={{ color: 'var(--txt-2)' }}>Net</b> — spread minus cost. Positive means the
              trade survives its own friction.
            </p>
          </div>
          <div>
            <p className="tiny" style={{ marginTop: 0 }}>
              <b style={{ color: 'var(--txt-2)' }}>Trap</b> — the cheapest wrapper on the screen is
              not the cheapest wrapper you can buy. It is either unbuyable, unpriceable or
              stale.
            </p>
            <p className="tiny">
              <b style={{ color: 'var(--txt-2)' }}>Stale share</b> — voting wrappers whose own
              quote was last struck more than a day ago. A price that has not moved in a day is not
              necessarily a price you can get.
            </p>
            <p className="tiny">
              <b style={{ color: 'var(--txt-2)' }}>Not measured</b> — wherever a figure is absent
              from the payload it says so. It is never rounded down to zero.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
