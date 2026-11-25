import { fixtureSnapshot } from './seed.ts';
import { analyse, detectFindings } from '../src/lib/analysis.ts';

const snap = fixtureSnapshot();
const quotes = Object.fromEntries(Object.entries(snap.quotes).map(([k, v]) => [Number(k), v]));
const pools = Object.fromEntries(Object.entries(snap.pools).map(([k, v]) => [Number(k), v]));
const a = analyse(snap, quotes, pools, { sizeUsd: 100_000, now: Date.parse(snap.generatedAt) });
console.log('summary', JSON.stringify(a.summary, null, 1));
for (const asset of a.assets) {
  console.log('--', asset.asset.symbol, 'anchor', asset.anchor?.toFixed(2), asset.anchorMethod);
  for (const r of asset.rows)
    console.log(
      '   ',
      r.wrapper.symbol,
      r.status,
      r.normalizedPrice?.toFixed(2),
      'dev',
      r.deviationBps?.toFixed(1),
      'unit',
      r.unit?.label ?? '-',
      'elig',
      r.eligible,
      r.excludedBecause ?? '',
    );
  for (const c of asset.crossings)
    console.log(
      '    CROSS',
      c.cheap.wrapper.symbol,
      '->',
      c.rich.wrapper.symbol,
      c.verdict,
      'spread',
      c.spreadBps?.toFixed(1),
      'cost',
      c.costBps?.toFixed(1),
      'net',
      c.netBps?.toFixed(1),
    );
  console.log('    trap', asset.trap);
}
console.log('findings', detectFindings(snap, a, quotes).map((f) => f.id));
