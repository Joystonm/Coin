# Cross the Spread

**A tokenized-equity spread screener that prices the round trip instead of the screen.**

*Hackathon track: **Markets and Trading Tools*** · CoinMarketCap API · MIT

CoinMarketCap lists several wrappers of the same real-world asset — NVDAX, NVDA.D,
NVDAY, NVDAP — each with its own price, its own volume, its own pool. A screener
that shows them side by side calls the gap between them an opportunity. It is not
one. Capturing it means buying the cheap side, selling the rich side, and paying
for both legs in price impact, plus whatever it costs to actually get from one
wrapper to the other.

This project asks the question the screener does not: **after you pay to cross it,
is there anything left?**

```
the 52.5 bps gap clears the 27.7 bps cost by 24.7 bps
the gap is smaller than the asset's own daily movement: NVDA's tokenized price
  moves a median of 102.7 bps a day over the 30-day history, so the position
  would be marked against you by more than the 24.7 bps it makes before the
  spread closes
```

Both sentences are true at once. That is the product.

---

## What it does

It judges every pair of wrappers of the same asset on three axes and one
time-series arm, and returns one of five verdicts:

| verdict | meaning |
| --- | --- |
| `capturable` | the spread is bigger than the cost of executing it |
| `not-capturable` | the spread is real, but smaller than the friction |
| `not-distinguishable` | the two prices are not two prices — noise, or a stale print |
| `dead-side` | one side cannot be traded at all |
| `unpriceable` | we could not measure the execution, so we do not claim a spread |

The last three are answers, not failures. "We could not measure it" is never
rounded into "no", because a screener that says "no" when it means "I don't
know" is the thing this project is replacing.

It also reports the trap it is built to find: **the cheapest wrapper on the
screen is often not the cheapest one you can buy.** In the offline fixture that
happens on 40% of assets.

## The four surfaces

One engine, four ways to read it. `src/lib/` is pure — no DOM, no clock, no
network — so the number in the terminal, the number in the browser and the
number an agent gets through MCP are computed by the same function from the
same file, and cannot disagree.

| surface | what it is | how to run it |
| --- | --- | --- |
| **Web** | the dashboard: radar, per-asset ledger, findings, method | `npm run dev` |
| **CLI** | `cts radar`, `cts capturable`, `cts asset NVDA`, `cts findings` | `npm run cli -- radar` |
| **MCP server** | 7 read-only tools so an agent can ask the same questions | `npm run mcp` |
| **Hosted API** | `/api/judge`, `/api/provenance`, `/api/findings`, `/api/snapshot` | `vercel deploy` |

## Quick start

```bash
npm install
npm run seed        # writes the offline fixture — no API key needed
npm run dev         # http://localhost:5173
```

```bash
npm test            # 105 tests
npm run build       # typecheck + production build
```

With a live CoinMarketCap key:

```bash
cp .env.example .env      # put your key in .env — never commit it
npm run snapshot          # live pull -> public/data/snapshot.json
npm run history           # live pull -> public/data/history.json
npm run cli -- radar      # read it back
```

`npm run seed` writes a fixture with `source: "fixture"`. The dashboard says so
in plain language, and so does the API. Nothing computed from the fixture is
ever presented as live.

The snapshot is committed to the repository, in two forms:
`public/data/snapshot.json` (what the app reads) and
`public/data/snapshot.pretty.json` (the same thing, indented, for reading).
That is deliberate — the demo has to keep working after the hackathon keys
revert to the Basic tier, and a committed snapshot is the only way to promise
that. The weekly `live.yml` workflow pulls fresh data and publishes the result
as an artifact without committing it, so the receipts of a real pull stay
inspectable and the repository stays deterministic.

## The CMC API endpoints used

| endpoint | what it is used for |
| --- | --- |
| `/v5/real-world-assets/map` | the universe: how many assets of each type exist |
| `/v5/real-world-assets/assets/list` | the assets, ranked by tokenized market cap |
| `/v5/real-world-assets/quotes/latest` | every wrapper's price, volume and market cap under one `rwa_id` |
| `/v5/real-world-assets/info` | the underlying's description, industry, exchange, and its TradFi listing |
| `/v5/real-world-assets/issuers/list` | who issues each wrapper |
| `/v5/real-world-assets/quotes/historical` | the asset's own daily aggregate series — the volatility floor |
| `/v5/real-world-assets/market-pairs/list` | attempted; refused on the free plan — see `docs/FEEDBACK.md` |
| `/v2/cryptocurrency/info` | each wrapper's chain and contract address |
| `/v2/cryptocurrency/quotes/latest` | each wrapper's own quote **with its own timestamp** |
| `/v1/dex/platform/list` | the chains to look pools up on |
| `/v4/dex/pairs/quotes/latest` | pool liquidity, volume and venue |
| `/v1/dex/token/pools` | the same pools for a token that no pair endpoint returns |

Two of those joins are the point of the project:

1. The RWA endpoint **does not timestamp wrappers individually**. Joining it to
   `/v2/cryptocurrency/quotes/latest` on `crypto_id` is the only way to know a
   wrapper's price is a day old.
2. `/v5/real-world-assets/quotes/historical` gives the asset's **own** aggregate
   series, which is a second, independent noise floor — and the only way to
   know that a disagreement opened *today* rather than being structural.

## What the API got in the way

This is a first-class output, not a footnote. The dashboard has a Findings page
and `cts findings` prints the same list, each finding with a `curl` a reader
can run. The headline one:

> `/v5/real-world-assets/market-pairs/list` is the endpoint that would show where
> tokenized assets actually quote. It is refused on the free plan with
> `error_code 1006`, so execution cost can only be estimated from DEX pools —
> and a wrapper whose liquidity sits on a broker rather than a DEX is invisible
> to us.

Full write-up in [`docs/FEEDBACK.md`](docs/FEEDBACK.md). It is also the answer
to the brief's question about where the API got in the way.

## Continuous integration

Three workflows, all in [`.github/workflows/`](.github/workflows):

| workflow | what it does | needs |
| --- | --- | --- |
| `ci.yml` | typecheck → test → build, then two guards: nothing key-shaped is committed, and no `.env` is tracked | nothing |
| `pages.yml` | builds the site and publishes it to **https://joystonm.github.io/Coin/** | Pages enabled (one click) |
| `live.yml` | pulls live data weekly (Mondays 06:17 UTC) and uploads the snapshot and the raw evidence as artifacts. **Commits nothing** | `CMC_API_KEY` |
| `deploy.yml` | builds and deploys to Vercel on every push — this one serves the hosted API as well | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |

Add the secrets under **Settings → Secrets and variables → Actions** and the
matching workflow starts working on its own — no file edit. Until then those
jobs report *"nothing to do"* and go green, rather than showing a red X.

Two deployment paths, on purpose. **Pages** is the zero-account one: the site
is static and the snapshot is committed, so it needs no key and no third-party
setup. **Vercel** is the fuller one, because it serves `/api/judge`,
`/api/provenance`, `/api/findings` and `/api/snapshot` alongside the site.
Turn Pages on under **Settings → Pages → Source: GitHub Actions**.

The key guards in `ci.yml` are the mechanical form of the hackathon's rule:
*do not commit keys to a public repo, or they will ask you to rotate it and it
counts against code quality.* The build fails rather than trusting a human to
notice.

## Documentation

| document | what it is for |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | what the product is, and the data model it runs on |
| [`docs/METHOD.md`](docs/METHOD.md) | the method, in detail: parity, freshness, execution, the verdict, the credit budget |
| [`docs/FEEDBACK.md`](docs/FEEDBACK.md) | where the CoinMarketCap API got in the way, with reproductions |
| [`docs/JUDGE.md`](docs/JUDGE.md) | how to run this in five minutes and what to look at |
| [`docs/DEMO.md`](docs/DEMO.md) | the demo script, shot list and narration |
| [`docs/SUBMISSION.md`](docs/SUBMISSION.md) | the DoraHacks submission text and the X post |

## Repository layout

```
src/lib/        the engine — pure functions, no I/O, no clock, no globals
src/ui/         the dashboard
cli/cts.ts      the terminal surface
mcp/server.ts   the MCP server: 7 read-only tools
api/            the hosted API (Vercel functions)
scripts/        snapshot.ts · history.ts · seed.ts · cmc.ts · check.ts
tests/          105 tests over the engine and the API
docs/           the documents above
```

`src/lib/` is the contract. If a number appears anywhere, it was computed
there.

## Licence

MIT.
