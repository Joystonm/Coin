/**
 * The command line.
 *
 * Everything the product knows, answerable without a network connection and
 * without an API key: it reads the committed snapshot and runs the same
 * analysis the web UI runs. If the numbers in the terminal disagree with the
 * numbers on the page, that is a bug, and the test suite checks for it.
 *
 *   cts radar                 every judged pair, widest first
 *   cts capturable            only the pairs that survive their own friction
 *   cts asset NVDA            one asset, in full
 *   cts findings              what the API got wrong, with a repro for each
 *   cts calls                 every API call this snapshot was built from
 *   cts verify                re-derive the SHA-256 of each evidence file
 *   cts refresh               pull a new snapshot from CoinMarketCap
 *
 * Options: --size <usd>  --limit <n>  --json  --snapshot <path>  --no-color
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSession, findAsset, type Session } from '../src/lib/session.ts';
import type { CrossingVerdict } from '../src/lib/crossing.ts';

const USE_COLOR = !process.env.NO_COLOR && process.stdout.isTTY === true;

const COLOURS: Record<CrossingVerdict, string> = {
  capturable: '[32m',
  'not-capturable': '[33m',
  'not-distinguishable': '[90m',
  'dead-side': '[31m',
  unpriceable: '[35m',
};

function paint(text: string, colour: string): string {
  return USE_COLOR ? `${colour}${text}[0m` : text;
}

function bold(text: string): string {
  return USE_COLOR ? `[1m${text}[0m` : text;
}

function dim(text: string): string {
  return USE_COLOR ? `[90m${text}[0m` : text;
}

const VERDICT_LABEL: Record<CrossingVerdict, string> = {
  capturable: 'CAPTURABLE',
  'not-capturable': 'TOO EXPENSIVE',
  'not-distinguishable': 'NOT DISTINGUISHABLE',
  'dead-side': 'DEAD SIDE',
  unpriceable: 'UNPRICEABLE',
};

interface Args {
  command: string;
  positional: string[];
  size?: number;
  limit: number;
  json: boolean;
  snapshot?: string;
  color: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { command: 'radar', positional: [], limit: 25, json: false, color: USE_COLOR };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--size') {
      args.size = Number(argv[++i]);
    } else if (arg === '--limit') {
      args.limit = Number(argv[++i]);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--no-color') {
      args.color = false;
    } else if (arg === '--snapshot') {
      args.snapshot = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.command = 'help';
    } else {
      rest.push(arg);
    }
  }
  if (rest.length) {
    args.command = rest[0] as string;
    args.positional = rest.slice(1);
  }
  return args;
}

function money(value: number | null): string {
  if (value == null) return 'not measured';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

function bps(value: number | null): string {
  if (value == null) return 'not measured';
  return `${value.toFixed(1)} bps`;
}

function heading(text: string): void {
  process.stdout.write(`\n${bold(text)}\n`);
}

function fixtureBanner(session: Session): void {
  if (!session.isFixture) return;
  process.stdout.write(
    `\n${paint('  OFFLINE FIXTURE — not a live pull.', '[33m')} ${dim(
      'Run `npm run snapshot` with an API key for live data.',
    )}\n`,
  );
}

function commandRadar(session: Session, args: Args): void {
  const { analysis } = session;
  const rows = [...analysis.crossings].sort((a, b) => (b.spreadBps ?? 0) - (a.spreadBps ?? 0));
  const shown = rows.slice(0, args.limit);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
    return;
  }

  heading(`Cross the Spread — ${analysis.summary.pairsJudged} judged pairs`);
  fixtureBanner(session);
  process.stdout.write(
    `\n  ${bold('capturable')} ${analysis.summary.capturableShare?.toFixed(0) ?? '—'}%   ` +
      `${bold('median spread')} ${bps(analysis.summary.medianSpreadBps)}   ` +
      `${bold('median cost')} ${bps(analysis.summary.medianCostBps)}\n`,
  );

  for (const c of shown) {
    const verdict = paint(VERDICT_LABEL[c.verdict].padEnd(21), COLOURS[c.verdict]);
    const spread = (c.spreadBps ?? 0).toFixed(1).padStart(7);
    const cost = (c.costBps == null ? '—' : c.costBps.toFixed(1)).padStart(8);
    const net = (c.netBps == null ? '—' : c.netBps.toFixed(1)).padStart(8);
    process.stdout.write(
      `\n  ${bold(c.assetSymbol.padEnd(6))} ${c.cheap.wrapper.symbol.padEnd(9)} → ${c.rich.wrapper.symbol.padEnd(9)}` +
        `  spread ${spread}  cost ${cost}  net ${net}   ${verdict}\n`,
    );
    process.stdout.write(`    ${dim(c.reasons.join('  ·  '))}\n`);
  }
  if (rows.length > shown.length) {
    process.stdout.write(`\n  ${dim(`… ${rows.length - shown.length} more (use --limit)`)}\n`);
  }
}

function commandCapturable(session: Session, args: Args): void {
  const capturable = session.analysis.crossings.filter((c) => c.verdict === 'capturable');
  if (args.json) {
    process.stdout.write(`${JSON.stringify(capturable, null, 2)}\n`);
    return;
  }
  heading(`Capturable spreads — ${capturable.length} of ${session.analysis.summary.pairsJudged} judged pairs`);
  fixtureBanner(session);
  if (!capturable.length) {
    process.stdout.write(
      `\n  ${dim('None. Every gap in this snapshot is eaten by its own execution cost, its own noise,')}\n` +
        `  ${dim('or a side that cannot be traded at the quoted price.')}\n`,
    );
    return;
  }
  for (const c of capturable) {
    process.stdout.write(
      `\n  ${bold(c.assetSymbol)}  ${c.cheap.wrapper.symbol} → ${c.rich.wrapper.symbol}  ` +
        `${paint(`+${(c.netBps ?? 0).toFixed(1)} bps`, COLOURS.capturable)} net ` +
        `${dim(`(spread ${(c.spreadBps ?? 0).toFixed(1)}, cost ${(c.costBps ?? 0).toFixed(1)})`)}\n`,
    );
    for (const reason of c.reasons) process.stdout.write(`    ${dim('·')} ${reason}\n`);
  }
}

function commandAsset(session: Session, args: Args): void {
  const symbol = args.positional[0] ?? '';
  const asset = findAsset(session, symbol);
  if (!asset) {
    process.stderr.write(
      `No asset matching "${symbol}" in this snapshot. ` +
        `Known: ${session.analysis.assets.slice(0, 12).map((a) => a.asset.symbol).join(', ')}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(asset, null, 2)}\n`);
    return;
  }

  heading(`${asset.asset.name} (${asset.asset.symbol})`);
  fixtureBanner(session);
  process.stdout.write(
    `\n  anchor ${bold(asset.anchor?.toFixed(4) ?? 'none')} ${dim(`(${asset.anchorMethod})`)}   ` +
      `asset type ${asset.asset.assetType}   ` +
      `wrappers ${asset.rows.length}   ` +
      `tokenized cap ${money(asset.asset.tokenizedMarketCap)}\n`,
  );
  if (asset.asset.tradfiMarkets.length) {
    for (const m of asset.asset.tradfiMarkets) {
      process.stdout.write(
        `  ${dim('lists as')} ${m.ticker ?? '?'} ${dim('on')} ${m.exchange ?? '?'}\n`,
      );
    }
  }
  if (asset.asset.lastUpdated) {
    process.stdout.write(`  ${dim('last updated')} ${asset.asset.lastUpdated}\n`);
  }

  heading('  Wrappers');
  process.stdout.write(
    `  ${'SYMBOL'.padEnd(11)}${'PRICE'.padStart(12)}${'NORMALISED'.padStart(13)}${'DEV'.padStart(9)}` +
      `${'VOL SHARE'.padStart(11)}  ${'STANDS'}\n`,
  );
  for (const row of asset.rows) {
    const dev = row.deviationBps == null ? '—' : `${row.deviationBps.toFixed(1)}`;
    const stands = row.excludedBecause ?? (row.setsAnchor ? 'sets the anchor' : 'votes on the anchor');
    const mark = row.eligible ? '' : paint('×', '[31m');
    process.stdout.write(
      `  ${(row.wrapper.symbol + mark).padEnd(11)}` +
        `${(row.wrapper.price == null ? 'none' : row.wrapper.price.toFixed(4)).padStart(12)}` +
        `${(row.normalizedPrice == null ? 'none' : row.normalizedPrice.toFixed(4)).padStart(13)}` +
        `${dev.padStart(9)}` +
        `${`${(row.volumeShare * 100).toFixed(1)}%`.padStart(11)}  ${dim(stands)}\n`,
    );
    if (row.unit) {
      process.stdout.write(`  ${' '.repeat(11)}${dim(`quoted per ${row.unit.label}`)}\n`);
    }
  }

  heading('  Pairs');
  if (!asset.crossings.length) {
    process.stdout.write(`  ${dim('No pair could be judged for this asset.')}\n`);
  }
  for (const c of asset.crossings) {
    process.stdout.write(
      `\n  ${bold(`${c.cheap.wrapper.symbol} → ${c.rich.wrapper.symbol}`)}  ` +
        `spread ${bps(c.spreadBps)}  cost ${bps(c.costBps)}  net ${bps(c.netBps)}  ` +
        `${paint(VERDICT_LABEL[c.verdict], COLOURS[c.verdict])}\n`,
    );
    for (const reason of c.reasons) process.stdout.write(`    ${dim('·')} ${reason}\n`);
    if (c.chainMismatch) process.stdout.write(`    ${dim('· the two wrappers sit on different chains')}\n`);
  }

  const depths = Object.entries(asset.depths);
  if (depths.length) {
    heading('  Execution');
    process.stdout.write(
      `  ${'SYMBOL'.padEnd(11)}${'LIQUIDITY'.padStart(13)}${'IMPACT'.padStart(10)}${'EXIT (d)'.padStart(11)}` +
        `${'FRESH'.padStart(10)}  ${'TRADEABLE'}\n`,
    );
    for (const [, d] of depths) {
      process.stdout.write(
        `  ${d.symbol.padEnd(11)}` +
          `${money(d.poolLiquidityUsd).padStart(13)}` +
          `${(d.roundTripImpactBps == null ? '—' : `${d.roundTripImpactBps.toFixed(1)}`).padStart(10)}` +
          `${(d.daysToExit == null ? '—' : d.daysToExit.toFixed(2)).padStart(11)}` +
          `${d.freshness.padStart(10)}  ${d.tradeability}\n`,
      );
      if (d.unknownBecause) process.stdout.write(`  ${' '.repeat(11)}${dim(d.unknownBecause)}\n`);
    }
  }

  const history = session.histories[asset.asset.symbol.toUpperCase()];
  if (history) {
    heading('  History');
    if (history.thin) {
      process.stdout.write(
        `  ${dim(`only ${history.observations} observations — too thin to draw a conclusion from`)}\n`,
      );
    } else {
      process.stdout.write(
        `  ${dim(`${history.observations} daily observations, ${history.from?.slice(0, 10)} → ${history.to?.slice(0, 10)}`)}\n` +
          `  ${dim('median daily move')} ${bps(history.medianAbsMoveBps)}   ` +
          `${dim('p95')} ${bps(history.p95AbsMoveBps)}   ` +
          `${dim('max')} ${bps(history.maxAbsMoveBps)}   ` +
          `${dim('window total')} ${bps(history.totalMoveBps)}\n`,
      );
    }
  }

  if (asset.notes.length) {
    heading('  Notes');
    for (const note of asset.notes) process.stdout.write(`  ${dim('·')} ${note}\n`);
  }

  if (asset.trap && asset.cheapestOnScreen && asset.cheapestReachable) {
    heading('  The trap');
    process.stdout.write(
      `  ${paint('!', '[31m')} The cheapest wrapper on the screen is ${bold(asset.cheapestOnScreen.wrapper.symbol)} ` +
        `at ${asset.cheapestOnScreen.normalizedPrice?.toFixed(4)}.\n` +
        `  ${dim('But the cheapest one you could actually buy is')} ${bold(asset.cheapestReachable.wrapper.symbol)} ` +
        `at ${asset.cheapestReachable.normalizedPrice?.toFixed(4)}.\n`,
    );
  }
}

function commandFindings(session: Session, args: Args): void {
  if (args.json) {
    process.stdout.write(`${JSON.stringify(session.findings, null, 2)}\n`);
    return;
  }
  heading(`API findings — ${session.findings.length} detected from this snapshot`);
  fixtureBanner(session);
  for (const f of session.findings) {
    const sev = f.severity === 3 ? paint('BLOCKER', '[31m') : f.severity === 2 ? paint('MAJOR', '[33m') : dim('MINOR');
    process.stdout.write(`\n  ${bold(f.title)}  ${sev}\n`);
    process.stdout.write(`  ${f.detail}\n\n`);
    process.stdout.write(`  ${dim('endpoint')} ${f.endpoint}\n`);
    process.stdout.write(`  ${dim('evidence ')} ${f.evidence}\n`);
    if (f.repro) {
      process.stdout.write(`\n  ${dim('reproduce:')}\n`);
      for (const line of f.repro.match(/.{1,96}/g) ?? [f.repro]) {
        process.stdout.write(`    ${dim(line)}\n`);
      }
    }
    if (f.suggestedFix) {
      process.stdout.write(`\n  ${dim('suggested fix:')} ${f.suggestedFix}\n`);
    }
  }
}

function commandCalls(session: Session, args: Args): void {
  const calls = session.snapshot.calls ?? [];
  if (args.json) {
    process.stdout.write(`${JSON.stringify(calls, null, 2)}\n`);
    return;
  }
  heading(`API calls — ${calls.length} made, ${session.snapshot.scope?.credits ?? '?'} credits`);
  process.stdout.write(
    `  ${'ENDPOINT'.padEnd(44)}${'CREDITS'.padStart(8)}${'CODE'.padStart(6)}${'MS'.padStart(7)}\n`,
  );
  for (const c of calls) {
    const code = c.errorCode === 0 ? 'ok' : paint(String(c.errorCode), '[31m');
    process.stdout.write(
      `  ${c.endpoint.padEnd(44)}${String(c.credits).padStart(8)}${code.padStart(6)}${String(c.elapsedMs).padStart(7)}\n`,
    );
    if (c.errorMessage) process.stdout.write(`    ${dim(c.errorMessage)}\n`);
  }
}

function commandVerify(): void {
  const dir = join(process.cwd(), 'evidence');
  if (!existsSync(dir)) {
    process.stdout.write('No evidence directory. Run `npm run snapshot` to capture one.\n');
    return;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  heading(`Evidence — ${files.length} files`);
  process.stdout.write(
    `  ${dim('re-deriving the SHA-256 of each stored response body and comparing it to the recorded digest')}\n`,
  );
  let ok = 0;
  let bad = 0;
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8');
    let parsed: { sha256?: string; raw?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      process.stdout.write(`  ${paint('×', '[31m')} ${file}: not valid JSON\n`);
      bad += 1;
      continue;
    }
    if (!parsed.sha256) {
      process.stdout.write(`  ${paint('×', '[31m')} ${file}: no sha256 recorded\n`);
      bad += 1;
      continue;
    }
    if (parsed.raw == null) {
      process.stdout.write(
        `  ${paint('×', '[31m')} ${file}: no raw body stored, so the digest cannot be re-derived\n`,
      );
      bad += 1;
      continue;
    }
    // Re-derive the digest from the stored bytes and compare it to the digest
    // that was recorded at the moment of the call. A match means the response
    // in the repository is byte-for-byte the response the API returned.
    const digest = createHash('sha256').update(parsed.raw, 'utf8').digest('hex');
    const matches = digest === parsed.sha256;
    if (matches) ok += 1;
    else bad += 1;
    process.stdout.write(
      `  ${matches ? paint('✓', '[32m') : paint('×', '[31m')} ${file.padEnd(34)} ${dim(parsed.sha256.slice(0, 16))}…\n`,
    );
  }
  process.stdout.write(`\n  ${ok} intact, ${bad} unreadable\n`);
  if (bad) process.exitCode = 1;
}

async function commandRefresh(args: Args): Promise<void> {
  const { runSnapshot } = await import('../scripts/snapshot.ts');
  await runSnapshot({
    sizeUsd: args.size,
    onCall: (receipt) => {
      const mark = receipt.errorCode === 0 ? dim('·') : paint('!', '[31m');
      process.stdout.write(
        `  ${mark} ${receipt.endpoint} ${receipt.httpStatus} ${receipt.credits}cr ${receipt.elapsedMs}ms\n`,
      );
    },
  });
}

function commandHistory(session: Session, args: Args): void {
  const entries = Object.entries(session.histories);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(session.histories, null, 2)}\n`);
    return;
  }
  heading(`History — ${entries.length} assets with a price series`);
  fixtureBanner(session);
  if (!entries.length) {
    process.stdout.write(
      `\n  ${dim('No history loaded. Run `npm run history` with an API key to pull the daily series.')}\n` +
        `  ${dim('Until then the product makes no claim about how the asset has been moving.')}\n`,
    );
    return;
  }
  process.stdout.write(
    `  ${'ASSET'.padEnd(9)}${'OBS'.padStart(5)}${'MEDIAN MOVE'.padStart(14)}${'P95 MOVE'.padStart(12)}` +
      `${'MAX MOVE'.padStart(12)}${'WINDOW TOTAL'.padStart(15)}\n`,
  );
  for (const [symbol, h] of entries) {
    process.stdout.write(
      `  ${symbol.padEnd(9)}` +
        `${String(h.observations).padStart(5)}` +
        `${bps(h.medianAbsMoveBps).padStart(14)}` +
        `${bps(h.p95AbsMoveBps).padStart(12)}` +
        `${bps(h.maxAbsMoveBps).padStart(12)}` +
        `${bps(h.totalMoveBps).padStart(15)}` +
        `${h.thin ? paint('  thin', '[33m') : ''}\n`,
    );
  }
}

function commandHelp(): void {
  process.stdout.write(
    `\n${bold('Cross the Spread')} — is that spread actually capturable?\n\n` +
      `  ${bold('cts radar')}            every judged pair, widest first\n` +
      `  ${bold('cts capturable')}       only the pairs that survive their own friction\n` +
      `  ${bold('cts asset <SYMBOL>')}   one asset, in full\n` +
      `  ${bold('cts findings')}         what the API got wrong, with a repro for each\n` +
      `  ${bold('cts history')}          how the assets have been moving, day by day\n` +
      `  ${bold('cts calls')}            every API call this snapshot was built from\n` +
      `  ${bold('cts verify')}            re-derive the SHA-256 of each evidence file\n` +
      `  ${bold('cts refresh')}          pull a new snapshot from CoinMarketCap\n\n` +
      `  ${dim('--size <usd>   the notional size every cost figure refers to')}\n` +
      `  ${dim('--limit <n>    how many rows to show')}\n` +
      `  ${dim('--json         machine-readable output')}\n` +
      `  ${dim('--snapshot <path>   read a different snapshot file')}\n` +
      `  ${dim('--no-color')}\n\n`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.color) {
    // Force the plain path by pretending the terminal is not a TTY.
    process.env.NO_COLOR = '1';
  }

  switch (args.command) {
    case 'help':
      commandHelp();
      return;
    case 'refresh':
      await commandRefresh(args);
      return;
    case 'verify':
      commandVerify();
      return;
    default:
      break;
  }

  const session = openSession(args.snapshot, args.size);
  switch (args.command) {
    case 'asset':
      commandAsset(session, args);
      break;
    case 'capturable':
      commandCapturable(session, args);
      break;
    case 'findings':
      commandFindings(session, args);
      break;
    case 'calls':
      commandCalls(session, args);
      break;
    case 'history':
      commandHistory(session, args);
      break;
    case 'radar':
      commandRadar(session, args);
      break;
    default:
      process.stderr.write(`Unknown command "${args.command}". Try \`cts help\`.\n`);
      process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
