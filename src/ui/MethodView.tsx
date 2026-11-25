/**
 * Method — thresholds, the refusal ladder, the assumptions, and the receipts.
 *
 * Every number on the other pages comes from here: the constants, the
 * thresholds, the calls that produced the data. The constants are imported
 * from `src/lib/*` rather than retyped, so this page cannot drift from the
 * code that made the numbers.
 */

import { Panel, Val } from './components.tsx';
import { int, num, stamp, usdFull } from './format.ts';
import type { AppData } from './data.ts';

import { MIN_SPREAD_BPS } from '../lib/crossing.ts';
import {
  AGGREGATE_GAP_BPS,
  DISLOCATION_BPS,
  LIQUID_VOLUME_USD,
  OFF_PEG_BPS,
  TRADEABLE_VOLUME_USD,
} from '../lib/parity.ts';
import { DORMANT_AFTER_MS, STALE_AFTER_MS } from '../lib/depth.ts';
import { SAME_UNIT_TOLERANCE, UNIT_MATCH_TOLERANCE } from '../lib/units.ts';

function hours(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 48) return `${h} hours`;
  return `${(h / 24).toFixed(0)} days`;
}

interface Threshold {
  name: string;
  value: string;
  why: string;
  source: string;
}

export function MethodView({ data }: { data: AppData }) {
  const { snapshot, analysis } = data;
  const s = analysis.summary;

  const thresholds: Threshold[] = [
    {
      name: 'Minimum spread',
      value: `${MIN_SPREAD_BPS} bps`,
      why: 'A gap smaller than this is two quotes disagreeing, not a spread. Scaled up by the asset’s own dispersion.',
      source: 'crossing.ts · MIN_SPREAD_BPS',
    },
    {
      name: 'Liquidity floor to vote',
      value: usdFull(LIQUID_VOLUME_USD),
      why: 'A wrapper needs this much 24h volume to be allowed to set the consensus anchor.',
      source: 'parity.ts · LIQUID_VOLUME_USD',
    },
    {
      name: 'Liquidity floor to be presented as tradeable',
      value: usdFull(TRADEABLE_VOLUME_USD),
      why: 'Below this, a wrapper is not offered as something you could buy.',
      source: 'parity.ts · TRADEABLE_VOLUME_USD',
    },
    {
      name: 'Dislocation',
      value: `${DISLOCATION_BPS} bps`,
      why: 'Deviation from the anchor worth showing as a dislocation.',
      source: 'parity.ts · DISLOCATION_BPS',
    },
    {
      name: 'Off-peg',
      value: `${OFF_PEG_BPS} bps`,
      why: 'Beyond this, an unexplained deviation means the wrapper is off-peg or its print is bad — and it stops voting.',
      source: 'parity.ts · OFF_PEG_BPS',
    },
    {
      name: 'Aggregate gap',
      value: `${AGGREGATE_GAP_BPS} bps`,
      why: 'CMC’s own aggregate disagreeing with our anchor by this much is treated as a data defect, not a market.',
      source: 'parity.ts · AGGREGATE_GAP_BPS',
    },
    {
      name: 'Stale after',
      value: hours(STALE_AFTER_MS),
      why: 'A quote older than this may no longer be a price you can get. The pair becomes not distinguishable.',
      source: 'depth.ts · STALE_AFTER_MS',
    },
    {
      name: 'Dormant after',
      value: hours(DORMANT_AFTER_MS),
      why: 'A quote older than this is dormant: the token is not being quoted.',
      source: 'depth.ts · DORMANT_AFTER_MS',
    },
    {
      name: 'Same-unit tolerance',
      value: `${(SAME_UNIT_TOLERANCE * 100).toFixed(0)}%`,
      why: 'A price ratio this close to 1 is the same unit, not a unit difference.',
      source: 'units.ts · SAME_UNIT_TOLERANCE',
    },
    {
      name: 'Unit match tolerance',
      value: `${(UNIT_MATCH_TOLERANCE * 100).toFixed(0)}%`,
      why: 'How close a ratio must be to a known factor to count as that factor. We never rescale an unrecognised ratio.',
      source: 'units.ts · UNIT_MATCH_TOLERANCE',
    },
  ];

  const ladder = [
    {
      step: 'A price we cannot compare is not a spread.',
      why: 'If either side has no usable normalised price, there is nothing to compare.',
      verdict: 'not-distinguishable',
    },
    {
      step: 'A stale print is a price that may no longer exist.',
      why: `If either side’s own token quote is older than ${hours(STALE_AFTER_MS)}, the gap is not a live spread.`,
      verdict: 'not-distinguishable',
    },
    {
      step: 'A side with no volume cannot be bought.',
      why: 'No 24h volume, or a deepest pool smaller than the position, means one side of the pair is not a trade.',
      verdict: 'dead-side',
    },
    {
      step: 'Below the noise floor the prices are not distinguishable.',
      why: `The floor is max(${MIN_SPREAD_BPS} bps, the asset’s own leave-one-out dispersion). A wide pair does not define its own noise.`,
      verdict: 'not-distinguishable',
    },
    {
      step: 'We need depth on both sides to price the execution.',
      why: 'No depth lookup for one side means the round trip cannot be costed.',
      verdict: 'unpriceable',
    },
    {
      step: 'Absence of a pool is not evidence of a free trade.',
      why: 'If CoinMarketCap lists no pool with a priced liquidity figure for one side, its execution cost is unknown — never zero.',
      verdict: 'unpriceable',
    },
    {
      step: 'Different chains means the trade leaves the tokenized market.',
      why: 'Closing a cross-chain pair needs a bridge that no CoinMarketCap endpoint prices.',
      verdict: 'unpriceable',
    },
    {
      step: 'Price it: net = spread − cost.',
      why: 'Cost is the constant-product price impact of buying the cheap side and selling the rich side, both legs charged. Positive net means the trade survives its own friction.',
      verdict: 'capturable / not-capturable',
    },
  ];

  const byType = Object.entries(snapshot.universe.byType ?? {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Method<span className="accent">.</span>
          </h1>
          <p className="page-sub">
            What this product measures, what it refuses to guess, and the API calls behind every
            figure on the other pages.
          </p>
        </div>
      </div>

      <div className="grid cols-2">
        <Panel title="scope of this snapshot">
          <dl className="kv">
            <dt>Generated</dt>
            <dd>{stamp(snapshot.generatedAt)}</dd>
            <dt>Source</dt>
            <dd>{snapshot.source === 'fixture' ? 'offline fixture' : 'live pull'}</dd>
            <dt>Assets requested</dt>
            <dd>{int(snapshot.scope.assetsRequested)}</dd>
            <dt>Depth scanned</dt>
            <dd>
              {int(snapshot.scope.depthScannedWrappers)} wrapper
              {snapshot.scope.depthScannedWrappers === 1 ? '' : 's'}
            </dd>
            <dt>Selection rule</dt>
            <dd className="txt">{snapshot.scope.depthSelectionRule}</dd>
            <dt>Notional size</dt>
            <dd>${int(snapshot.scope.sizeUsd)}</dd>
            <dt>Credits</dt>
            <dd>{int(snapshot.scope.credits)}</dd>
            <dt>API calls</dt>
            <dd>{int(snapshot.scope.calls)}</dd>
          </dl>
        </Panel>

        <Panel title="universe" note="/v5/real-world-assets/map">
          <dl className="kv">
            <dt>Total assets</dt>
            <dd>{int(snapshot.universe.totalAssets)}</dd>
            <dt>Issuers</dt>
            <dd>{int(snapshot.universe.issuers)}</dd>
          </dl>
          <div className="divider" />
          <table className="data">
            <thead>
              <tr>
                <th>Asset type</th>
                <th className="n">Count</th>
                <th className="n">Share</th>
              </tr>
            </thead>
            <tbody>
              {byType.map(([type, count]) => (
                <tr key={type}>
                  <td>{type.replace(/_/g, ' ')}</td>
                  <td className="n">{int(count ?? 0)}</td>
                  <td className="n">
                    <Val
                      value={
                        count != null && snapshot.universe.totalAssets > 0
                          ? ((count / snapshot.universe.totalAssets) * 100)
                          : null
                      }
                      fmt={(n) => `${n.toFixed(1)}%`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div style={{ height: 14 }} />

      <Panel title="what a number on this site is">
        <div className="grid cols-2">
          <div>
            <p className="tiny" style={{ marginTop: 0 }}>
              <b style={{ color: 'var(--txt-2)' }}>Normalised price</b> — each wrapper’s price
              multiplied by the factor that puts it in the same unit as its peers, detected from
              the ratio to the peer median. An unrecognised ratio is never rescaled; it is reported
              as an unexplained dislocation.
            </p>
            <p className="tiny">
              <b style={{ color: 'var(--txt-2)' }}>Anchor</b> — the volume-weighted mean of the
              voting wrappers’ normalised prices. If no wrapper clears the liquidity floor, the
              anchor falls back to a plain median. If neither exists, there is no anchor and the
              asset is not comparable.
            </p>
            <p className="tiny">
              <b style={{ color: 'var(--txt-2)' }}>Deviation</b> — the wrapper’s normalised price
              against the anchor, in basis points.
            </p>
          </div>
          <div>
            <p className="tiny" style={{ marginTop: 0 }}>
              <b style={{ color: 'var(--txt-2)' }}>Round-trip cost</b> — the constant-product price
              impact of the two legs:
              <br />
              <span className="mono">
                impact per leg = size / (liquidity + size), cost = buy impact + sell impact
              </span>
              <br />
              with <span className="mono">size = ${int(snapshot.scope.sizeUsd)}</span> and{' '}
              <span className="mono">liquidity</span> the total USD liquidity of the pools
              CoinMarketCap reports for that token.
            </p>
            <p className="tiny">
              <b style={{ color: 'var(--txt-2)' }}>Noise floor</b> — the median absolute deviation
              of the <i>other</i> voting wrappers, measured leave-one-out, floored at{' '}
              {MIN_SPREAD_BPS} bps.
            </p>
            <p className="tiny">
              <b style={{ color: 'var(--txt-2)' }}>Net</b> — spread minus round-trip cost.
            </p>
          </div>
        </div>
      </Panel>

      <div style={{ height: 14 }} />

      <Panel title="the refusal ladder" note="the order the checks run in" flush>
        <div style={{ padding: '4px 14px 10px' }}>
          <ul className="ladder">
            {ladder.map((rung, i) => (
              <li key={i}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <span className="t">
                    {rung.step}
                    <span className="why">{rung.why}</span>
                  </span>
                  <span className="v">
                    <span className="chip ghost">{rung.verdict}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <div style={{ height: 14 }} />

      <Panel title="thresholds" note="read from the code, not retyped here" flush>
        <table className="data">
          <thead>
            <tr>
              <th>Threshold</th>
              <th className="n">Value</th>
              <th>What it does</th>
              <th>Defined in</th>
            </tr>
          </thead>
          <tbody>
            {thresholds.map((t) => (
              <tr key={t.name}>
                <td>{t.name}</td>
                <td className="n">{t.value}</td>
                <td className="muted">{t.why}</td>
                <td className="mono muted">{t.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div style={{ height: 14 }} />

      <div className="grid cols-2">
        <Panel title="assumptions" note="stated, not hidden">
          <ul className="bullets">
            <li>
              <b>Constant-product impact</b> — price impact is modelled as{' '}
              <span className="mono">size / (liquidity + size)</span> on a balanced pool. For a
              Uniswap v3 pool this is an approximation: concentrated-liquidity range effects are not
              modelled.
            </li>
            <li>
              <b>Both legs pay</b> — a round trip crosses the impact twice, once on the way in and
              once on the way out.
            </li>
            <li>
              <b>No gas</b> — gas, priority fees and slippage beyond the modelled impact are not
              priced. Real costs are therefore understated on high-fee chains.
            </li>
            <li>
              <b>No bridge pricing</b> — a cross-chain pair is refused as unpriceable rather than
              costed, because no CoinMarketCap endpoint prices a bridge.
            </li>
            <li>
              <b>No redemption pricing</b> — moving between two issuers is a redemption, not a
              swap. The settlement risk is named in the reasons and not priced.
            </li>
            <li>
              <b>Liquidity is what CMC reports</b> — a token whose liquidity sits on a broker or an
              ATS we cannot see is recorded as unknown, not as illiquid.
            </li>
            <li>
              <b>Quotes are a snapshot</b> — every price, quote timestamp and pool figure is as of{' '}
              {stamp(snapshot.generatedAt)}. Nothing on this site refreshes itself.
            </li>
            <li>
              <b>Units are inferred, never invented</b> — a wrapper whose price ratio matches no
              known unit factor is left out of the anchor and reported as an unexplained
              dislocation.
            </li>
            <li>
              <b>Verdicts are about the round trip</b> — they say nothing about direction, and they
              are not investment advice.
            </li>
          </ul>
        </Panel>

        <Panel title="what this snapshot measured" note="derived from the analysis, not the other way round">
          <dl className="kv">
            <dt>Assets scanned</dt>
            <dd>{int(s.assetsScanned)}</dd>
            <dt>Wrappers seen</dt>
            <dd>{int(s.wrappersSeen)}</dd>
            <dt>Wrappers priced</dt>
            <dd>{int(s.wrappersPriced)}</dd>
            <dt>Wrappers with depth</dt>
            <dd>{int(s.wrappersWithDepth)}</dd>
            <dt>Pairs judged</dt>
            <dd>{int(s.pairsJudged)}</dd>
            <dt>Median spread</dt>
            <dd>{num(s.medianSpreadBps, (n) => `${n.toFixed(1)} bps`)}</dd>
            <dt>Median cost</dt>
            <dd>{num(s.medianCostBps, (n) => `${n.toFixed(1)} bps`)}</dd>
            <dt>Median net</dt>
            <dd>{num(s.medianNetBps, (n) => `${n.toFixed(1)} bps`)}</dd>
            <dt>Trap share</dt>
            <dd>{num(s.trapShare, (n) => `${n.toFixed(1)}%`)}</dd>
            <dt>Stale share</dt>
            <dd>{num(s.staleShare, (n) => `${n.toFixed(1)}%`)}</dd>
            <dt>No priced pool</dt>
            <dd>{num(s.noPoolShare, (n) => `${n.toFixed(1)}%`)}</dd>
            <dt>CMC aggregate gap</dt>
            <dd>
              {num(s.aggregateGapBps, (n) => `${n.toFixed(1)} bps`)} over{' '}
              {int(s.aggregateGapAssets)} asset{s.aggregateGapAssets === 1 ? '' : 's'}
            </dd>
          </dl>
        </Panel>
      </div>

      <div style={{ height: 14 }} />

      <Panel
        title="receipts"
        note={`${int(snapshot.calls.length)} API call${snapshot.calls.length === 1 ? '' : 's'}`}
        flush
        right={
          <span className="panel-note">
            {int(snapshot.scope.credits)} credits · {int(snapshot.scope.calls)} calls recorded
          </span>
        }
      >
        <table className="data">
          <thead>
            <tr>
              <th className="n">#</th>
              <th>Endpoint</th>
              <th>Query</th>
              <th className="n">Credits</th>
              <th className="n">Error</th>
              <th className="n">Elapsed</th>
              <th>At</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.calls.map((call, i) => (
              <tr key={`${call.endpoint}-${i}`}>
                <td className="n muted">{i + 1}</td>
                <td className="mono">{call.endpoint}</td>
                <td className="mono muted">{call.query}</td>
                <td className="n">{int(call.credits)}</td>
                <td className="n">
                  {call.errorCode === 0 ? (
                    <span className="flag on">0 · ok</span>
                  ) : (
                    <span className="flag bad">{call.errorCode}</span>
                  )}
                  {call.errorMessage ? (
                    <span className="sub">{call.errorMessage}</span>
                  ) : null}
                </td>
                <td className="n">{int(call.elapsedMs)} ms</td>
                <td className="mono muted">{stamp(call.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="panel-body">
          <p className="tiny" style={{ margin: 0 }}>
            Error code 0 is CoinMarketCap’s “no error”. Credits and elapsed milliseconds are the
            values the API reported for each call, not client-side measurements.
          </p>
        </div>
      </Panel>

      <div style={{ height: 14 }} />

      <Panel title="issuers seen" flush>
        <table className="data">
          <thead>
            <tr>
              <th>Issuer</th>
              <th className="n">Tokens</th>
              <th>Website</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.issuers.map((issuer) => (
              <tr key={issuer.issuerId}>
                <td>{issuer.name}</td>
                <td className="n">
                  <Val value={issuer.numTokens} fmt={(n) => int(n)} />
                </td>
                <td>
                  {issuer.website ? (
                    <a href={issuer.website} target="_blank" rel="noreferrer noopener">
                      {issuer.website}
                    </a>
                  ) : (
                    <span className="muted">not measured</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
