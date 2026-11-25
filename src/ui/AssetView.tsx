/**
 * Asset page — the full ledger for one underlying.
 *
 * Every wrapper that CMC lists under one rwa_id, what it is worth relative to
 * its peers, whether it was allowed to vote, and — where a pool exists — what
 * it would cost to actually take it.
 */

import { Panel, Val, VerdictTag, signTone } from './components.tsx';
import { HistoryPanel } from './HistoryPanel.tsx';
import { ago, days, isKnown, num, price, usd, usdFull } from './format.ts';
import { assetHref } from './router.ts';
import type { AppData } from './data.ts';
import type { AssetAnalysis } from '../lib/analysis.ts';
import type { Freshness, Tradeability } from '../lib/depth.ts';

const FRESHNESS_COLOR: Record<Freshness, string> = {
  live: '#35d6a4',
  stale: '#f2b544',
  dormant: '#ff6b6b',
  unknown: '#8b93a1',
};

const TRADEABILITY_COLOR: Record<Tradeability, string> = {
  tradeable: '#35d6a4',
  thin: '#f2b544',
  'not-tradeable': '#ff6b6b',
  unknown: '#b18cff',
};

export function AssetView({ data, symbol }: { data: AppData; symbol: string }) {
  const { snapshot, analysis } = data;
  const wanted = symbol.toLowerCase();
  const asset: AssetAnalysis | undefined = analysis.assets.find(
    (a) =>
      a.asset.symbol.toLowerCase() === wanted ||
      a.asset.slug.toLowerCase() === wanted ||
      a.asset.name.toLowerCase() === wanted,
  );

  if (!asset) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-title">Unknown asset</h1>
            <p className="page-sub">
              <span className="mono">{symbol}</span> is not in this snapshot. The scanned assets are{' '}
              {analysis.assets.map((a) => a.asset.symbol).join(', ')}.
            </p>
          </div>
        </div>
        <Panel title="assets in scope">
          <div className="badge-row">
            {analysis.assets.map((a) => (
              <a key={a.asset.symbol} href={assetHref(a.asset.symbol)} className="chip ghost">
                {a.asset.symbol}
              </a>
            ))}
          </div>
        </Panel>
      </>
    );
  }

  const a = asset;
  const meta = a.asset;
  const deploymentOf = (cryptoId: number) => snapshot.deployments[String(cryptoId)];
  const gapToCmc =
    meta.avgTokenizedPrice != null && a.anchor != null
      ? (meta.avgTokenizedPrice / a.anchor - 1) * 10_000
      : null;
  // The widest gap on this asset, so the history panel can say whether it
  // stands clear of the asset's own noise.
  const spreads = a.crossings
    .map((c) => c.spreadBps)
    .filter((v): v is number => v != null);
  const widestSpread = spreads.length ? Math.max(...spreads) : null;

  return (
    <>
      <div className="crumbs">
        <a href="#/radar">Radar</a>
        <span>/</span>
        {meta.symbol}
      </div>

      <div className="page-head">
        <div>
          <h1 className="page-title">
            {meta.name}
            <span className="accent"> · {meta.symbol}</span>
          </h1>
          <p className="page-sub">
            {meta.assetType.replace(/_/g, ' ')} · rwa_id{' '}
            <span className="mono">{meta.rwaId ?? 'null'}</span> · CMC rank{' '}
            <span className="mono">{meta.rank ?? 'not measured'}</span> ·{' '}
            {a.rows.length} wrapper{a.rows.length === 1 ? '' : 's'} listed
          </p>
        </div>
        <div className="page-actions">
          <a className="chip ghost" href="#/radar">
            ← back to radar
          </a>
        </div>
      </div>

      {a.trap ? (
        <div className="note violet" style={{ marginBottom: 14 }}>
          <b>The screen's cheapest wrapper is not the cheapest one you can buy.</b>{' '}
          {a.cheapestOnScreen ? (
            <>
              On screen the cheapest is{' '}
              <span className="mono">
                {a.cheapestOnScreen.wrapper.symbol} @ $
                {price(a.cheapestOnScreen.normalizedPrice)}
              </span>{' '}
              ({num(a.cheapestOnScreen.deviationBps, (n) => `${n.toFixed(1)} bps`)} against the
              anchor)
              {a.cheapestReachable
                ? ` — but it is not a buy, and the cheapest wrapper you can actually buy is ${a.cheapestReachable.wrapper.symbol} @ $${price(a.cheapestReachable.normalizedPrice)}.`
                : ' — and no wrapper of this asset is tradeable at the notional size, so there is no "cheapest you can buy" to compare against.'}
            </>
          ) : (
            'This asset has no voting wrapper to compare.'
          )}
        </div>
      ) : null}

      <div className="grid cols-60-40">
        <div>
          <Panel
            title="wrapper ledger"
            note="price normalised into the asset's reference unit"
            flush
            right={
              <span className="panel-note">
                /v5/real-world-assets/quotes/latest · /v2/cryptocurrency/quotes/latest
              </span>
            }
          >
            <table className="data">
              <thead>
                <tr>
                  <th>Wrapper</th>
                  <th>Issuer</th>
                  <th className="n">Raw price</th>
                  <th className="n">Normalised</th>
                  <th>Unit</th>
                  <th className="n">Dev</th>
                  <th className="n">Vol share</th>
                  <th>Vote</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {a.rows.map((row) => (
                  <tr key={row.wrapper.cryptoId}>
                    <td>
                      <span className="sym">{row.wrapper.symbol}</span>
                      <span className="sub">
                        id {row.wrapper.cryptoId}
                        {deploymentOf(row.wrapper.cryptoId)?.chains?.length
                          ? ` · ${deploymentOf(row.wrapper.cryptoId)?.chains.join(', ')}`
                          : ''}
                      </span>
                    </td>
                    <td>{row.wrapper.issuerName ?? <span className="muted">unknown</span>}</td>
                    <td className="n">
                      <Val value={row.wrapper.price} fmt={price} />
                    </td>
                    <td className="n">
                      <Val value={row.normalizedPrice} fmt={price} />
                    </td>
                    <td>
                      {row.unit ? (
                        <span className="flag on">{row.unit.label}</span>
                      ) : (
                        <span className="muted">same unit</span>
                      )}
                      {row.unexplainedRatio ? (
                        <span className="sub flag bad">unexplained ratio</span>
                      ) : null}
                    </td>
                    <td className="n">
                      <Val
                        value={row.deviationBps}
                        fmt={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`}
                        tone={signTone(row.deviationBps)}
                      />
                      <span className="sub">bps</span>
                    </td>
                    <td className="n">
                      <Val value={row.volumeShare * 100} fmt={(n) => n.toFixed(1)} />
                      <span className="sub">%</span>
                    </td>
                    <td>
                      {row.eligible ? (
                        <span className="flag on">voted</span>
                      ) : (
                        <span className="flag bad">excluded</span>
                      )}
                    </td>
                    <td>
                      {row.excludedBecause ? (
                        <span className="muted">{row.excludedBecause}</span>
                      ) : (
                        <span className="muted">voted on the anchor</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="judged pairs"
            note={`${a.crossings.length} pair${a.crossings.length === 1 ? '' : 's'}`}
            flush
          >
            {a.crossings.length === 0 ? (
              <div className="empty">
                No pair could be judged for this asset: it needs two wrappers with a usable price and
                enough volume to vote.
              </div>
            ) : (
              a.crossings.map((c) => (
                <div
                  key={`${c.cheap.wrapper.cryptoId}-${c.rich.wrapper.cryptoId}`}
                  style={{ borderBottom: '1px solid var(--line-soft)' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '10px 14px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {c.cheap.wrapper.symbol}{' '}
                      <span style={{ color: 'var(--txt-3)' }}>→</span> {c.rich.wrapper.symbol}
                    </span>
                    <VerdictTag verdict={c.verdict} />
                    <span className="tiny">
                      spread{' '}
                      <Val value={c.spreadBps} fmt={(n) => `${n.toFixed(1)} bps`} /> · cost{' '}
                      <Val value={c.costBps} fmt={(n) => `${n.toFixed(1)} bps`} /> · net{' '}
                      <Val
                        value={c.netBps}
                        fmt={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)} bps`}
                        tone={signTone(c.netBps)}
                      />
                    </span>
                    <span className="tiny" style={{ marginLeft: 'auto' }}>
                      noise floor{' '}
                      <Val value={c.noiseBps} fmt={(n) => `${n.toFixed(1)} bps`} />
                      {c.chainMismatch ? ' · cross-chain' : ''}
                      {c.issuerMismatch ? ' · cross-issuer' : ''}
                    </span>
                  </div>
                  <div style={{ padding: '0 14px 13px' }}>
                    <ul className="reasons">
                      {c.reasons.map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))
            )}
          </Panel>
        </div>

        <div>
          <Panel title="consensus anchor">
            <dl className="kv">
              <dt>Anchor</dt>
              <dd>
                <Val value={a.anchor} fmt={(n) => `$${n.toFixed(2)}`} />
              </dd>
              <dt>Method</dt>
              <dd>{a.anchorMethod}</dd>
              <dt>Voters</dt>
              <dd>
                {a.rows.filter((r) => r.eligible).length} of {a.rows.length} wrappers
              </dd>
              <dt>Anchor setter</dt>
              <dd>
                {a.rows.some((r) => r.setsAnchor)
                  ? a.rows
                      .filter((r) => r.setsAnchor)
                      .map((r) => r.wrapper.symbol)
                      .join(', ')
                  : 'no single wrapper — the anchor is a weighted mean'}
              </dd>
              <dt>CMC aggregate</dt>
              <dd>
                <Val value={meta.avgTokenizedPrice} fmt={(n) => `$${n.toFixed(2)}`} />{' '}
                <span className="tiny">
                  (
                  <Val
                    value={gapToCmc}
                    fmt={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(0)} bps`}
                    tone={signTone(gapToCmc)}
                  />{' '}
                  vs anchor)
                </span>
              </dd>
            </dl>
          </Panel>

          {a.notes.length > 0 ? (
            <Panel title="notes">
              <ul className="bullets">
                {a.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <HistoryPanel
            symbol={meta.symbol}
            points={data.series[meta.symbol.toUpperCase()] ?? []}
            hasHistory={data.hasHistory}
            anchor={a.anchor}
            spreadBps={widestSpread}
          />

          <Panel
            title="execution"
            note={`notional $${snapshot.scope.sizeUsd.toLocaleString('en-US')}`}
            flush
            right={<span className="panel-note">/v1/dex/token/pools</span>}
          >
            <table className="data">
              <thead>
                <tr>
                  <th>Wrapper</th>
                  <th className="n">Pool liq</th>
                  <th className="n">Round trip</th>
                  <th className="n">Days to exit</th>
                  <th>Freshness</th>
                  <th>Tradeability</th>
                </tr>
              </thead>
              <tbody>
                {a.rows.map((row) => {
                  const d = a.depths[row.wrapper.cryptoId];
                  if (!d) {
                    return (
                      <tr key={row.wrapper.cryptoId}>
                        <td>
                          <span className="sym">{row.wrapper.symbol}</span>
                        </td>
                        <td className="n">
                          <span className="val val-unknown">not measured</span>
                        </td>
                        <td className="n">
                          <span className="val val-unknown">not measured</span>
                        </td>
                        <td className="n">
                          <span className="val val-unknown">not measured</span>
                        </td>
                        <td>
                          <span className="val val-unknown">not measured</span>
                        </td>
                        <td>
                          <span className="val val-unknown">not measured</span>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={row.wrapper.cryptoId}>
                      <td>
                        <span className="sym">{row.wrapper.symbol}</span>
                        <span className="sub">
                          {d.pools.length === 0
                            ? 'no DEX pool listed'
                            : d.pools
                                .map((p) => `${p.dexName ?? 'pool'} · ${p.platform ?? 'chain unknown'}`)
                                .join(' / ')}
                        </span>
                      </td>
                      <td className="n">
                        <Val
                          value={d.poolLiquidityUsd}
                          fmt={usd}
                          title={d.poolLiquidityUsd != null ? usdFull(d.poolLiquidityUsd) : undefined}
                        />
                      </td>
                      <td className="n">
                        <Val value={d.roundTripImpactBps} fmt={(n) => `${n.toFixed(1)} bps`} />
                      </td>
                      <td className="n">
                        <Val value={d.daysToExit} fmt={days} />
                      </td>
                      <td>
                        <span style={{ color: FRESHNESS_COLOR[d.freshness] }}>{d.freshness}</span>
                        <span className="sub">
                          {d.quoteUpdatedAt
                            ? `${d.quoteUpdatedAt} · ${ago(d.quoteAgeMs)}`
                            : 'no timestamp on the token quote'}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: TRADEABILITY_COLOR[d.tradeability] }}>
                          {d.tradeability}
                        </span>
                        {d.unknownBecause ? (
                          <span className="sub">{d.unknownBecause}</span>
                        ) : (
                          <span className="sub">
                            24h volume {isKnown(d.volume24h) ? usd(d.volume24h) : 'not measured'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <Panel title="asset record" note="/v5/real-world-assets/assets/list">
            <dl className="kv">
              <dt>Slug</dt>
              <dd>{meta.slug}</dd>
              <dt>Tokenised cap</dt>
              <dd>
                <Val value={meta.tokenizedMarketCap} fmt={usd} />
              </dd>
              <dt>Tokenised vol 24h</dt>
              <dd>
                <Val value={meta.tokenizedVolume24h} fmt={usd} />
              </dd>
              <dt>Last updated</dt>
              <dd>{meta.lastUpdated ?? 'not measured'}</dd>
              <dt>Industry</dt>
              <dd>{meta.industry ?? 'not measured'}</dd>
              <dt>Website</dt>
              <dd className="txt">
                {meta.website ? (
                  <a href={meta.website} target="_blank" rel="noreferrer noopener">
                    {meta.website}
                  </a>
                ) : (
                  'not measured'
                )}
              </dd>
              <dt>Tradfi venue</dt>
              <dd className="txt">
                {meta.tradfiMarkets.length === 0
                  ? 'not measured'
                  : meta.tradfiMarkets
                      .map((m) => `${m.exchange ?? 'unknown'}${m.ticker ? ` ${m.ticker}` : ''}`)
                      .join(', ')}
              </dd>
              <dt>Description</dt>
              <dd className="txt">{meta.description ?? 'not measured'}</dd>
            </dl>
          </Panel>
        </div>
      </div>

      <div style={{ height: 14 }} />

      <Panel title="every asset in this snapshot" flush>
        <table className="data">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th className="n">Wrappers</th>
              <th className="n">Pairs</th>
              <th>Verdicts</th>
            </tr>
          </thead>
          <tbody>
            {analysis.assets.map((other) => (
              <tr key={other.asset.symbol}>
                <td className="asset-cell">
                  <a href={assetHref(other.asset.symbol)}>{other.asset.symbol}</a>
                </td>
                <td>{other.asset.name}</td>
                <td className="n">{other.rows.length}</td>
                <td className="n">{other.crossings.length}</td>
                <td>
                  <span className="badge-row">
                    {other.crossings.map((c, i) => (
                      <VerdictTag key={i} verdict={c.verdict} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
