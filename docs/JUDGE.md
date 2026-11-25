# Judge's guide

Five minutes, start to finish. Everything below is a command you can paste.

---

## 1. What this is

**Cross the Spread** — a screener for tokenized-equity (and tokenized-gold,
-bond, commodity) wrappers that answers the question a price screener does not:

> After you pay to cross the spread, is there anything left?

CoinMarketCap lists four wrappers of NVDA at four different prices. A naive
screener calls the gap an opportunity. This one prices the round trip, checks
whether the price is still alive, checks whether you can reach the cheap side,
and compares the gap against the asset's own daily volatility.

It returns one of five verdicts — and **three of the five are refusals**:
`not-capturable`, `not-distinguishable`, `dead-side`, `unpriceable`. Those
refusals are the product. A screener that only shows the rows it likes has a
selection bias.

---

## 2. Run it

### Without a key (30 seconds)

```bash
npm install
npm run seed      # writes the offline fixture — no API key needed
npm run dev       # http://localhost:5173
```

The dashboard opens on a fixture snapshot and **says so in plain language** —
the banner reads `OFFLINE FIXTURE — not a live pull`. Nothing computed from the
fixture is ever presented as live.

### With a key (2 minutes)

```bash
cp .env.example .env    # put YOUR key in CMC_API_KEY — never commit it
npm run snapshot        # live pull  -> public/data/snapshot.json
npm run history         # live pull  -> public/data/history.json
npm run dev             # the dashboard now shows live data
```

The key is a request header. It is never written to disk, never appears in the
snapshot, and is redacted in every evidence file.

### In the terminal

```bash
npm run cli -- radar        # every judged pair, with the arithmetic
npm run cli -- asset NVDA   # one asset in full
npm run cli -- findings     # the API's own defects
npm run cli -- calls        # every receipt
npm run cli -- verify       # re-derive every evidence hash
```

---

## 3. What to look at, in order

### a) The radar — the one number that matters

```
NVDA   NVDAP  → NVDAY  spread  52.5  cost  27.7  net  24.7  CAPTURABLE
```

That is the whole thesis in one line: **the spread is bigger than the cost of
executing it, by 24.7 bps.** Then read the two lines under it, because they are
the part a naive screener would never tell you:

> the two wrappers are issued by Paxos and Ondo, so moving between them needs a
> redemption rather than a swap — settlement risk this product does not price
>
> the gap is smaller than the asset's own daily movement: NVDA's tokenized price
> moves a median of 102.7 bps a day over the 30-day history, so the position
> would be marked against you by more than the 24.7 bps it makes before the
> spread closes

**Capturable and not worth doing are both true.** The product says both.

### b) The refusals — the rows a naive screener would have sold you

Scroll the radar past the one good trade. In the fixture:

```
GOLD   XAUTG → GOLDX  spread 154.1  cost 230.2  net -76.1  TOO EXPENSIVE
GOLD   OLDX  → GOLDX  spread 165.4  cost     —  net      —  NOT DISTINGUISHABLE
NVDA   NVDA.D → NVDAY spread 75.2 cost     —  net      —  UNPRICEABLE
TLT    TLTX  → TLTOn  spread 4.5   cost     —  net      —  DEAD SIDE
```

Each refusal names its own reason:

- `TOO EXPENSIVE` — the spread is real, and the friction eats it. **150 bps of
  gold spread, 230 bps of round trip.** A naive screener would have called that
  the best trade in the asset.
- `NOT DISTINGUISHABLE` — `OLDX` last traded 10 days ago. It is the *cheapest
  gold wrapper on the screen* and it is not a price.
- `UNPRICEABLE` — the two wrappers are on different chains (Ethereum vs
  Solana), so closing the trade needs a bridge that no CoinMarketCap endpoint
  prices. **Absence of a pool is not evidence of a free trade.**
- `DEAD SIDE` — the deepest visible pool holds $40,000 against a $100,000
  position.

### c) The trap — the cheapest row is not the cheapest trade

In the asset ledger for NVDA, the cheapest wrapper is `NVDA.D` at $150.21. It
has **no DEX pool CoinMarketCap prices**. The cheapest wrapper you can actually
buy is a different one, at a different price. The radar header reports this
happens on **40% of assets**.

### d) The findings — the API feedback, produced by the product

The Findings page is **auto-detected from the data on every pull**, not
hand-written. Each finding carries a runnable `curl`.

```bash
npm run cli -- findings
```

The headline:

> `/v5/real-world-assets/market-pairs/list` — the endpoint that would show
> where tokenized assets actually quote — is refused on the free plan with
> `error_code 1006`. Execution cost can therefore only be estimated from DEX
> pools, and a wrapper whose liquidity sits on a broker rather than a DEX is
> invisible to us.

Full write-up, with all six findings and their reproductions:
[`docs/FEEDBACK.md`](FEEDBACK.md).

### e) The receipts — proof, not assertion

```bash
npm run cli -- calls
npm run cli -- verify
```

Every call records endpoint, query, HTTP status, CoinMarketCap's own error
code, credits charged and the SHA-256 of the exact bytes received. The raw
bytes are in `evidence/`, so the hash can be re-derived from the committed
artifact. `cts verify` re-derives every one of them.

`evidence/` also records the key as `<redacted>` — it is a request header and
never appears in a response.

---

## 4. Where the API is used, exactly

| endpoint | what it is used for |
| --- | --- |
| `/v5/real-world-assets/map` | the universe: how many assets of each type exist |
| `/v5/real-world-assets/assets/list` | the assets, ranked by tokenized market cap |
| `/v5/real-world-assets/quotes/latest` | every wrapper's price, volume and market cap under one `rwa_id` |
| `/v5/real-world-assets/info` | the underlying's description, industry, exchange, and its TradFi listing |
| `/v5/real-world-assets/issuers/list` | who issues each wrapper |
| `/v5/real-world-assets/quotes/historical` | the asset's own daily aggregate series — the volatility floor |
| `/v5/real-world-assets/market-pairs/list` | attempted; refused on the free plan — a finding, with evidence |
| `/v2/cryptocurrency/info` | each wrapper's chain and contract address |
| `/v2/cryptocurrency/quotes/latest` | each wrapper's own quote **with its own timestamp** |
| `/v1/dex/platform/list` | the chains to look pools up on |
| `/v4/dex/pairs/quotes/latest` | pool liquidity, volume and venue |
| `/v1/dex/token/pools` | the same pools for a token no pair endpoint returns |

**The two joins are the interesting part**, because neither is possible with
one endpoint:

1. **RWA quotes × token quotes, on `crypto_id`.** The RWA endpoint does not
   timestamp wrappers individually. Joining it to
   `/v2/cryptocurrency/quotes/latest` on `crypto_id` is the only way to know a
   wrapper's price is a day old — and that is what makes `NOT DISTINGUISHABLE`
   possible instead of `CAPTURABLE`.
2. **RWA quotes × DEX pools.** Prices come from one endpoint, execution cost
   from another. Without both, a spread is a price comparison with no cost
   attached, which is exactly the thing this project exists to fix.

A third, independent floor comes from `/v5/real-world-assets/quotes/historical`:
the asset's **own** volatility, which is what says a 52.5 bps gap is smaller
than a day's noise.

---

## 5. How it is built

```
src/lib/     the engine — pure functions, no I/O, no clock, no globals
src/ui/      the dashboard (React 19 + Recharts)
cli/cts.ts   the terminal surface
mcp/server.ts  7 read-only MCP tools
api/         the hosted API (Vercel functions)
scripts/     snapshot.ts · history.ts · seed.ts · cmc.ts · check.ts
tests/       105 tests over the engine and the API
```

`src/lib/` is **pure** — no `fetch`, no `Date.now()`, no DOM, no globals. That
is why the terminal, the browser, the agent and the hosted API can all answer
the same question and cannot disagree: they call the same function.

```bash
npm test          # 105 tests
npm run build     # typecheck + production build
```

CI runs typecheck → test → build, and then **two guards that enforce the
hackathon's key rule mechanically** rather than by trust:

- a grep for anything shaped like `CMC_API_KEY = <16+ chars>` anywhere in the
  tree;
- a check that no `.env` file is tracked by git.

---

## 6. The MCP server

```bash
npm run mcp
```

Seven read-only tools: `list_assets`, `get_asset`, `judge_spread`,
`find_traps`, `price_impact`, `list_findings`, `list_calls`.

The division of labour is the point. The **model chooses the asset and the
size**; **deterministic code decides the truth**. There is no tool that returns
an opinion the engine did not compute, and no write tool at all.

---

## 7. Honest limits

Worth stating, because they are the reason the refusals exist:

- Execution cost is modelled as constant-product price impact against the DEX
  liquidity CoinMarketCap reports. It is a **model**, not a quote.
- The asset's volatility floor comes from the **aggregate** series, which is
  per-asset, not per-wrapper.
- Wrappers on different chains are `unpriceable`, and wrappers from different
  issuers carry a redemption caveat that is **not** priced.
- The fixture is a fixture. The dashboard says so; the API says so; the CLI
  says so.

---

## 8. If you only do one thing

Run this:

```bash
npm run seed && npm run cli -- radar
```

and read the reason line under `NVDA NVDAP → NVDAY`. Then run
`npm run cli -- findings` and pick the finding that blocks the product
(`severity 3`).

That is the project in two commands: **it prices the trade, and it tells you
where the API would not let it.**
