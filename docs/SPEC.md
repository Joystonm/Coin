# Specification

**Cross the Spread** — a tokenized-asset spread screener that prices the round
trip instead of the screen.

This is the *what* document: what the product is, what it computes, what it
refuses to compute, and the data model it runs on. The *how* is in
[`METHOD.md`](METHOD.md); the API's defects are in [`FEEDBACK.md`](FEEDBACK.md).

---

## 1. The problem

CoinMarketCap's Real World Assets endpoints list several tokens for the same
underlying. For NVDA there are at least four — `NVDAX`, `NVDA.D`, `NVDAY`,
`NVDAP` — each with its own price, its own volume, its own market cap, its own
issuer, its own chain.

Every one of them is a screener row. Most screener rows imply an opportunity:
*this token is cheaper than that token, go buy the cheap one and sell the
expensive one*.

That implication is usually wrong, for three separate reasons, and the reasons
are not visible in the price column:

1. **The gap may not be a gap.** The two prices may be quoted in different
   units — one per troy ounce, one per gram — in which case a 3,000% "spread"
   is arithmetic, not opportunity.
2. **The price may not be a price.** A wrapper that stopped trading last week
   keeps quoting its last print, and it is often the cheapest row on the
   screen.
3. **The gap may not be reachable.** The cheapest wrapper may have no venue
   CoinMarketCap prices, so you cannot buy it with the size you are thinking
   of. And even if you can, the round trip costs price impact in two pools.

A screener that shows a spread without pricing it is answering the easy
question.

## 2. The product

For every asset, for every meaningful pair of wrappers, answer one question:

> **After you pay to cross this gap, is there anything left?**

And answer it with one of five verdicts, plus the arithmetic that produced it.

### The five verdicts

| verdict | meaning | what it looks like |
| --- | --- | --- |
| `capturable` | the spread is bigger than the cost of executing it | "the 52.5 bps gap clears the 27.7 bps cost by 24.7 bps" |
| `not-capturable` | the spread is real, but smaller than the friction | "the spread is 18.2 bps; the round trip costs 27.7 bps — short by 9.5 bps" |
| `not-distinguishable` | these are not two prices — noise, or a stale print | "the gap is inside the 12 bps noise floor" |
| `dead-side` | one side cannot be traded at all | "the rich side has no volume to sell into" |
| `unpriceable` | we could not measure the execution, so we do not claim a spread | "different chains — a bridge, which we do not price" |

Three of the five are **refusals**. That is deliberate and it is the product.

A screener with a selection bias shows only the rows it likes. Showing the
`not-capturable` pairs — the ones where a real spread loses to friction — is
the most useful thing it can do, because those are exactly the rows a naive
screener would have sold you. In the committed fixture, **four of the ten
judged pairs are `not-capturable`**, and they are on screen.

### The trap

The product also reports the failure mode it exists to catch:

> **The cheapest wrapper on the screen is often not the cheapest one you can
> buy.**

For each asset it computes the cheapest wrapper that *voted on the anchor* (the
cheapest on screen) and the cheapest wrapper that is actually *buyable* — it
has a price, enough volume, and a pool that can carry the position. When those
are different wrappers, the asset is flagged.

In the fixture this happens on **40% of assets**. On NVDA, `NVDA.D` is quoted
at $150.21 against `NVDAX` at $150.72. It is the cheapest wrapper on the
screen and it has **no DEX pool CoinMarketCap prices**.

A screener that shows the $150.21 is not lying. It is answering a different
question, and it does not say which.

### The second noise floor

Every spread is measured against two floors, not one:

- the **peer floor** — how far apart these wrappers normally sit from the
  consensus (leave-one-out, so a wrapper never grades its own homework);
- the **asset's own volatility** — from `/v5/real-world-assets/quotes/historical`,
  how much the asset moves on its own day to day.

NVDA's tokenized price moves a median of **102.7 bps a day** over the 30-day
window. So the 52.5 bps spread, which clears its execution cost by 24.7 bps,
is *smaller than an ordinary day's move*. The spread is real, the spread is
capturable, and the position would still be marked against you before it
closed. Both sentences are true at once, and the product says both.

---

## 3. The data model

Everything is a plain serialisable shape with explicit `null`s. **A missing
number is never coerced to zero** — the whole product is about telling the
difference between "zero" and "we could not measure it".

### The snapshot

The unit of persistence is the **snapshot**: everything one pull produced.

```ts
interface Snapshot {
  generatedAt: string;
  source: 'live' | 'fixture';       // never presented as live when it is not
  universe: { totalAssets, byType, issuers };
  assets: RwaAsset[];                // the assets, with their wrappers
  issuers: Issuer[];
  deployments: Record<cryptoId, TokenDeployment>;  // chain + contract
  quotes: Record<cryptoId, TokenQuote>;            // each token's own quote
  pools: Record<cryptoId, Pool[]>;                 // DEX pools per token
  calls: ApiCall[];                                // every receipt
  apiIssues: ApiIssue[];                           // problems found in the API's data
  scope: SnapshotScope;                            // what was measured, and how much it cost
}
```

`scope` matters: a reader must be able to tell what was *not* measured.

```ts
interface SnapshotScope {
  assetsRequested: number;        // how many assets we asked for
  depthScannedWrappers: number;   // how many wrappers we looked up pools for
  depthSelectionRule: string;     // the rule that chose them
  sizeUsd: number;                // the notional every cost figure refers to
  credits: number;                // total credits spent
  calls: number;                  // total API calls
}
```

### The wrapper

```ts
interface Wrapper {
  cryptoId: number;         // the ONLY safe join key in this API
  symbol: string;
  name: string;
  issuerId: string | null;
  issuerName: string | null;
  price: number | null;     // may be in the wrapper's own unit — see METHOD.md §1.2
  marketCap: number | null;
  volume24h: number | null;
}
```

`price` is `null` when the API said `null`. It is never `0`.

### The receipt

Every number on screen traces to one of these.

```ts
interface Receipt {
  endpoint: string;      // '/v5/real-world-assets/quotes/latest'
  query: string;         // the exact query string sent
  httpStatus: number;
  errorCode: number;     // CMC's own code, 0 = ok
  errorMessage: string | null;
  credits: number;       // what it charged
  elapsedMs: number;
  at: string;            // CMC's response timestamp
  fromCache: boolean;
  cacheAgeSeconds?: number;
}
```

The raw bytes behind each receipt are written to `evidence/` with their
SHA-256, so the hash can be re-derived from the committed artifact. `cts
verify` does exactly that.

### The analysis

```ts
interface Analysis {
  generatedAt: string;
  universe: ...;
  assets: AssetAnalysis[];   // per asset: rows, anchor, depths, crossings, trap
  crossings: CrossingPair[]; // every judged pair, across all assets
  summary: {
    assetsScanned, wrappersSeen, wrappersPriced, wrappersWithDepth, pairsJudged,
    byVerdict, capturableShare,
    medianSpreadBps, medianCostBps, medianNetBps,
    trapShare, staleShare, noPoolShare,
    aggregateGapBps, aggregateGapAssets,
  };
  findings: Finding[];       // API defects, auto-detected from this snapshot
  calls: ApiCall[];
}
```

Per asset:

```ts
interface AssetAnalysis {
  asset: RwaAsset;
  rows: ParityRow[];              // every wrapper against the anchor
  anchor: number | null;          // the consensus price
  anchorMethod: 'volume-weighted mean' | 'median' | 'none';
  depths: Record<cryptoId, DepthAssessment>;
  crossings: CrossingPair[];      // every candidate pair, judged
  cheapestOnScreen: ParityRow | null;
  cheapestReachable: ParityRow | null;
  trap: boolean;
  notes: string[];                // sentences a reader should not miss
}
```

### The three axes

| axis | question | file | key output |
| --- | --- | --- | --- |
| **price** | what is a wrapper worth relative to its peers? | `parity.ts`, `units.ts` | `anchor`, `deviationBps`, `unit` |
| **freshness** | is that price still a price? | `depth.ts` | `live` / `stale` / `dormant` / `unknown` |
| **execution** | can you get it, and what does it cost? | `depth.ts` | `impactBps`, `roundTripBps`, `daysToExit`, `tradeability` |
| **time** | how much does the asset move on its own? | `history.ts` | `medianAbsMoveBps`, `p95AbsMoveBps`, `positionInHistory`, `brokeOut` |

Time is the fourth arm, and it is the only one that looks *through* the asset
rather than *across* its wrappers.

---

## 4. The contract

`src/lib/` is **pure**. No `fetch`, no `Date.now()`, no DOM, no globals. Every
function takes its inputs — including the reference time — as arguments.

That is not style. It is the reason four surfaces can exist and agree:

```
                snapshot.json
                      │
                      ▼
              src/lib/analysis.ts  ──▶ Analysis
                      │
      ┌───────────────┼───────────────┬──────────────┐
      ▼               ▼               ▼              ▼
   cli/cts.ts     src/ui/ (React)   mcp/server.ts   api/ (Vercel)
   the terminal    the dashboard     the agent      the hosted API
```

A screener whose web page and whose API disagree is a screener nobody can
trust. The single engine is what makes that impossible rather than unlikely.

`api/_core.ts` is the same rule at the edge: it contains the hosted API's logic
and **no `process.env`** — no key, no environment, no hidden state. The hosted
API serves a committed snapshot, so the demo keeps working after the
hackathon keys revert to the Basic tier.

---

## 5. The four surfaces

### The dashboard (`src/ui/`)

Four views:

- **Radar** — every asset as a row: the anchor, the widest spread, the cost, the
  net, the verdict. One glance at where the money is and where it is not.
- **Asset ledger** — one asset in full: every wrapper against the anchor, every
  pair judged, the freshness and depth of each side, the price history, and the
  notes.
- **Findings** — the API's own defects, auto-detected from the snapshot, each
  with a runnable `curl`.
- **Method** — the arithmetic, in the product, so a reader never has to open
  the repository to check a claim.

### The CLI (`cli/cts.ts`)

```
cts radar                  the radar, as a table
cts asset NVDA             one asset in full
cts capturable             only the pairs that survive
cts findings               the API findings
cts calls                  every receipt
cts verify                 re-derive every evidence hash
cts history NVDA           the time-series arm for one asset
```

### The MCP server (`mcp/server.ts`)

Seven **read-only** tools. The division of labour is the point: the model
chooses the *asset* and the *size*, and deterministic code decides the truth.

| tool | what it does |
| --- | --- |
| `list_assets` | the universe, with the aggregate stats |
| `get_asset` | one asset in full |
| `judge_spread` | judge one pair, at one notional size |
| `find_traps` | the assets where the screen's cheapest is not the reachable one |
| `price_impact` | the cost of a given size, against the measured depth |
| `list_findings` | the API defects |
| `list_calls` | the receipts |

There is no write tool, and no tool that returns an opinion the code did not
compute.

### The hosted API (`api/`)

```
GET /api/judge?asset=NVDA&sizeUsd=100000
GET /api/provenance
GET /api/findings
GET /api/snapshot
```

CORS-open, no key, served from the committed snapshot. `judge` returns the
verdict, the arithmetic behind it, and the receipts it rests on.

---

## 6. Non-goals

Stated up front, because a screener's non-goats are what keep it honest:

- **Not an execution system.** It does not route an order, size a position, or
  pick a venue. It prices the *idea* of the trade.
- **Not a market maker.** It does not quote, hold inventory, or forecast.
- **Not a bridge or settlement layer.** Different chains is `unpriceable`,
  different issuers is a caveat, and both stay that way.
- **Not a price feed.** It reads CoinMarketCap's prices; it does not have its
  own.
- **Not a signal.** There is no "buy" or "sell" here. There is a spread, a
  cost, and a verdict.

---

## 7. What "done" means

The product is done when:

1. every number on screen comes from `src/lib/` and nowhere else;
2. every number on screen traces to a receipt with a re-derivable hash;
3. every refusal is a *named* refusal, not a missing value;
4. the fixture and the live pull produce the same *shape* of answer, so the
   demo never rots;
5. the findings page is derived from the data, so it cannot drift from it.

Item 5 is the one that is easiest to fake and hardest to fake well, and it is
the reason the findings are auto-detected rather than written by hand.
