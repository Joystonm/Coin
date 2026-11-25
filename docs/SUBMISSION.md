# Submission

Everything you need to fill in the DoraHacks form, plus the X post. Copy, paste,
adjust the URLs.

---

## 1. Track — pick exactly one

> ### **Markets and Trading Tools**

**Why this one.** The product is a trading-decision tool: it identifies a
price discrepancy in tokenized assets and decides whether it is worth acting
on. That is the definition of a trading tool, and it is what a judge reading
the brief will score against *"does it work"* and *"is it useful to a real
person"*.

**If you would rather submit it elsewhere**, change one line in this document
and one line in the README. Nothing in the code changes — the track is a
submission-form field, not an architectural property. The other three options
would each require reframing the pitch rather than the product:

| track | honest fit | what it would cost |
| --- | --- | --- |
| **Markets and Trading Tools** | strong — it is a screener that decides whether a trade is worth making | nothing |
| Data and Visualisation | plausible — the dashboard is the product's front door | the pitch becomes "we drew some charts", which loses the *prices the round trip* argument |
| AI Agents and Automation | weak — the MCP server is one of four surfaces, not the product | the pitch becomes "we have an MCP server", which is much smaller than what was built |
| Real World Assets | strong on subject matter, but the emphasis lands on the *asset class* rather than the *trading decision* | the API feedback gets framed as domain commentary rather than as product feedback, which loses its value |

**Decision: Markets and Trading Tools.** The brief permits exactly one track;
"all" is not a legal answer, so this document names one.

---

## 2. The form fields

### Title

> **Cross the Spread — a tokenized-asset spread screener that prices the round trip**

### Tagline / one-liner

> CoinMarketCap lists four wrappers of NVDA at four prices. A screener calls the
> gap an opportunity. This one prices the round trip, checks whether the price
> is still alive, and tells you when the cheapest row is a trap.

### Description

> ## Cross the Spread
>
> CoinMarketCap's Real World Assets endpoints list several tokens for the same
> underlying. For NVDA there are at least four — `NVDAX`, `NVDA.D`, `NVDAY`,
> `NVDAP` — each with its own price, its own volume, its own issuer, its own
> chain. Every one of them is a screener row, and most screener rows imply an
> opportunity: *this token is cheaper than that token, go buy the cheap one and
> sell the expensive one.*
>
> That implication is usually wrong, for three separate reasons, and none of
> them are visible in the price column:
>
> 1. **The gap may not be a gap.** The two prices may be quoted in different
>    units — one per troy ounce, one per gram — in which case a 3,000% "spread"
>    is arithmetic, not opportunity.
> 2. **The price may not be a price.** A wrapper that stopped trading last week
>    keeps quoting its last print, and it is often the cheapest row on screen.
> 3. **The gap may not be reachable.** The cheapest wrapper may have no venue
>    CoinMarketCap prices, and even if it does, the round trip costs price
>    impact in two pools.
>
> **Cross the Spread answers the question a price screener does not: after you
> pay to cross this gap, is there anything left?**
>
> ### What it does
>
> For every asset, for every meaningful pair of wrappers, it computes the
> spread, the cost of executing it, and the net — and then returns one of five
> verdicts:
>
> | verdict | meaning |
> | --- | --- |
> | `capturable` | the spread is bigger than the cost of executing it |
> | `not-capturable` | the spread is real, but smaller than the friction |
> | `not-distinguishable` | the two prices are not two prices — noise, or a stale print |
> | `dead-side` | one side cannot be traded at all |
> | `unpriceable` | we could not measure the execution, so we do not claim a spread |
>
> Three of the five are **refusals**. That is the point. A screener with a
> selection bias shows only the rows it likes; showing the `not-capturable`
> pairs — where a real spread loses to friction — is the most useful thing it
> can do. In the committed fixture, four of the ten judged pairs are
> `not-capturable`, and they are on screen.
>
> ### The example that carries it
>
> ```
> NVDA  NVDAP → NVDAY   spread 52.5 bps   cost 27.7 bps   net 24.7 bps   CAPTURABLE
> ```
>
> The spread clears the cost of executing it — buying into $90m of liquidity,
> selling out of $60m, at a $100,000 notional. And in the same breath:
>
> > the gap is smaller than the asset's own daily movement: NVDA's tokenized
> > price moves a median of 102.7 bps a day over the 30-day history, so the
> > position would be marked against you by more than the 24.7 bps it makes
> > before the spread closes
>
> **Capturable and not worth doing are both true.** The product says both.
>
> ### The trap it is built to find
>
> The cheapest wrapper on the screen is often not the cheapest one you can buy.
> On NVDA, `NVDA.D` is quoted at $150.21 against `NVDAX` at $150.72 — the
> cheapest row on the screen — and it has **no DEX pool CoinMarketCap prices**.
> The cheapest wrapper you can actually buy is a different one, at a different
> price. In the fixture this happens on **40% of assets**.
>
> A screener that shows the $150.21 is not lying. It is answering a different
> question, and it does not say which. This one says which.
>
> ### Four surfaces, one engine
>
> `src/lib/` is pure — no `fetch`, no clock, no DOM, no globals — so the number
> in the terminal, the number in the browser, the number an agent gets through
> MCP and the number the hosted API serves are computed by the same function
> and **cannot disagree**.
>
> | surface | what it is |
> | --- | --- |
> | **Web dashboard** | the radar, the per-asset ledger, the findings, the method |
> | **CLI** | `cts radar`, `cts asset NVDA`, `cts capturable`, `cts findings`, `cts calls`, `cts verify` |
> | **MCP server** | 7 read-only tools — the model picks the asset and the size, deterministic code decides the truth |
> | **Hosted API** | `/api/judge`, `/api/provenance`, `/api/findings`, `/api/snapshot` |
>
> ### Where the API got in the way
>
> The findings page is **auto-detected from the data on every pull**, not written
> by hand, and each finding carries a runnable `curl`. Six were found; the two
> that hurt the product most:
>
> - **`average_tokenized_price` blends units.** It is averaged across wrappers
>   quoted in different units, so it is a price no wrapper trades at. The
>   product does not trust it — it computes its own volume-weighted,
>   unit-normalised anchor and reports the gap.
> - **`/v5/real-world-assets/market-pairs/list` is refused on the free plan**
>   (`error_code 1006`). That is the endpoint that would show where tokenized
>   assets actually quote, so a wrapper whose liquidity sits on a broker rather
>   than a DEX is invisible. We record its execution cost as *unknown*, never as
>   zero — absence of a pool is not evidence of a free trade.
>
> Full write-up with reproductions: [`docs/FEEDBACK.md`](docs/FEEDBACK.md).
>
> ### Evidence, not assertion
>
> Every call produces a receipt — endpoint, query, HTTP status, CoinMarketCap's
> own error code, credits charged, and the SHA-256 of the exact bytes received
> — and the raw bytes are committed under `evidence/` so the hash can be
> re-derived. `cts verify` re-derives every one of them. The API key is a
> request header, is never written to disk, and is redacted in every evidence
> file; CI fails the build if anything key-shaped is ever committed.

### Demo video / deployed link / screen recording

> - **Demo:** `<your deployed URL or the recording link>`
> - **Repo:** `<your GitHub URL>`
> - **Track:** Markets and Trading Tools

### Tech stack

> TypeScript · React 19 + Recharts · Vite · Vercel functions · MCP SDK ·
> Vitest · Node 20

---

## 3. The CMC API endpoints used

The brief asks for the endpoints to be named explicitly. Here is the list, with
what each one is used for — and, more usefully, **which of them the product
could not do without**:

| # | endpoint | what it is used for | could we do without it? |
| --- | --- | --- | --- |
| 1 | `/v5/real-world-assets/map` | the universe: how many assets of each type exist | no — it is where the asset universe comes from |
| 2 | `/v5/real-world-assets/assets/list` | the assets, ranked by tokenized market cap | no — it is the asset list |
| 3 | `/v5/real-world-assets/quotes/latest` | every wrapper's price, volume and market cap under one `rwa_id` | no — it is the price data |
| 4 | `/v5/real-world-assets/info` | the underlying's description, industry, exchange and its TradFi listing | no — it is what makes an asset an *asset* rather than a ticker |
| 5 | `/v5/real-world-assets/issuers/list` | who issues each wrapper | yes — but without it we cannot say "these need a redemption, not a swap" |
| 6 | `/v5/real-world-assets/quotes/historical` | the asset's own daily aggregate series — the volatility floor | no — it is the fourth axis |
| 7 | `/v5/real-world-assets/market-pairs/list` | attempted; refused on the free plan (`error_code 1006`) — filed as a finding | it is the venue-level liquidity view we are missing |
| 8 | `/v2/cryptocurrency/info` | each wrapper's chain and contract address | no — it is how we know two wrappers are on different chains |
| 9 | `/v2/cryptocurrency/quotes/latest` | each wrapper's own quote **with its own timestamp** | no — it is what makes staleness measurable |
| 10 | `/v1/dex/platform/list` | the chains to look pools up on | partly — see finding #4, it does not carry the slug the DEX endpoints need |
| 11 | `/v4/dex/pairs/quotes/latest` | pool liquidity, volume and venue | no — it is the execution cost |
| 12 | `/v1/dex/token/pools` | the same pools for a token no pair endpoint returns | no — it is the fallback that finds depth for single tokens |

**The two joins are the interesting part**, because neither is possible with one
endpoint:

1. **`/v5/real-world-assets/quotes/latest` × `/v2/cryptocurrency/quotes/latest`,
   on `crypto_id`.** The RWA endpoint does not timestamp wrappers individually.
   Joining the two is the only way to know a wrapper's price is a day old — and
   it is what makes the `not-distinguishable` verdict possible instead of a
   false `capturable`.
2. **`/v5/real-world-assets/quotes/latest` × `/v4/dex/pairs/quotes/latest`.**
   Prices from one endpoint, execution cost from another. Without both, a
   spread is a price comparison with no cost attached — which is exactly the
   thing this project exists to fix.

And a third, independent floor from
`/v5/real-world-assets/quotes/historical`: the asset's **own** volatility, which
is what says a 52.5 bps gap is smaller than a day's noise.

---

## 4. Evidence of a real API call

The brief asks for code *and* response. Both are in the repo, and the receipts
make them checkable.

### The code

[`scripts/cmc.ts`](../scripts/cmc.ts) is the whole client — 260 lines, no
dependencies, and it never throws on an API error because a `1006` is data:

```ts
const res = await fetch(url, {
  headers: { [KEY_HEADER]: this.apiKey, Accept: 'application/json' },
  signal: AbortSignal.timeout(30_000),
});
const raw = Buffer.from(await res.arrayBuffer());

const status = body?.status ?? {};
const receipt: Receipt = {
  endpoint,
  query: qs,
  httpStatus: res.status,
  errorCode: Number(status.error_code ?? (res.ok ? 0 : res.status)),
  errorMessage: status.error_message ?? (body ? null : 'response was not JSON'),
  credits: Number(status.credit_count ?? 0),
  elapsedMs: Number(status.elapsed ?? elapsedMs),
  at: status.timestamp ?? new Date().toISOString(),
  fromCache: false,
};
```

### The response

Every call writes the exact bytes it received, with their hash:

```json
{
  "request": "GET https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/latest?rwa_id=1",
  "headers": { "X-CMC_PRO_API_KEY": "<redacted>" },
  "sha256": "…",
  "raw": "{ \"data\": { \"data\": { \"1\": { … } } }, \"status\": { \"credit_count\": 1, … } }",
  "response": { "data": { "data": { "1": { … } } } }
}
```

### Check it yourself

```bash
npm run cli -- calls      # every receipt: endpoint, query, status, error code, credits
npm run cli -- verify     # re-derive every SHA-256 from the committed bytes
npm run cli -- findings   # the API defects, each with a runnable curl
```

The weekly `live.yml` workflow runs the same pull and publishes the snapshot
and the raw evidence as artifacts, so there is a dated, public record of the
API's behaviour rather than one good afternoon.

---

## 5. What the API made possible, and where it got in the way

*This is the brief's question, in the brief's shape. The full version is
[`docs/FEEDBACK.md`](FEEDBACK.md); this is the submission-length answer.*

### What it made possible

Four CoinMarketCap endpoints are the entire substance of this product, and
three of them do something no other free source does.

`/v5/real-world-assets/quotes/latest` is the only place that publishes **every
wrapper of a real-world asset with a price, a volume and a market cap
together** — the peer set is the whole basis of the product, and nothing else
provides it. `/v2/cryptocurrency/quotes/latest` **timestamps each token
individually**, which is the fact that makes staleness measurable at all: a
wrapper that stopped trading ten days ago keeps quoting its last print, and
without that join it is indistinguishable from a live one.
`/v5/real-world-assets/quotes/historical` gives the asset's **own** aggregate
daily series, which is a second and independent noise floor — it is what lets
the product say *"this 52.5 bps gap is smaller than NVDA's own median daily
move of 102.7 bps"*, a statement about the asset rather than about the
wrappers, and the reason a capturable spread can still be a bad trade. And
`/v4/dex/pairs/quotes/latest` puts a **liquidity number behind each price**,
which is what turns "these two prices differ" into "these two prices differ by
more than it costs to trade them".

The join is the product. `RWA quotes × token quotes × DEX pools × historical`
is a question that no single endpoint can answer, and that the API makes
possible — the API is doing something that is genuinely hard to do without it.

### Where it got in the way

Six concrete things, each with a reproduction, each of which changed the
codebase.

**`average_tokenized_price` blends units (severity 3).** It is averaged across
wrappers quoted in different units — some per troy ounce, some per gram — so
it is a price **no wrapper trades at**. A consumer who trusts it gets either a
0.03% spread or a 3,000% one and has no way to tell which from the payload. We
do not trust it: we compute our own volume-weighted, unit-normalised anchor
and report the disagreement.

**No unit field on wrapper prices (severity 3).** Two wrappers of one
`rwa_id` can legitimately differ by 31×, and nothing says so. We detect known
ratios, normalise them, and — importantly — **never rescale a price we cannot
explain**; it is reported as an unexplained dislocation and left out of the
anchor.

**`market-pairs/list` is refused on the free plan (severity 3).** The endpoint
that would show where tokenized assets actually quote returns
`error_code 1006` on the Startup tier. Since many wrappers have no DEX pool
CoinMarketCap prices, venue-level liquidity for RWA wrappers is invisible to
us. We record those execution costs as **unknown**, never zero — absence of a
pool is not evidence of a free trade.

**The DEX platform list carries no slug (severity 2).**
`/v1/dex/platform/list` returns 249 platforms under single-letter keys (`n`,
`pltA`) and **no `network_slug`**, while `/v4/dex/pairs/quotes/latest` requires
a `network_slug` and neither endpoint's reference documents the allowed
values. The one endpoint that does carry slugs, `/v4/dex/networks/list`, is
deprecated and refuses with `error_code 1005`. So the slug has to be
*discovered* — we try ranked candidates and record which one worked.

**Wrappers are not individually timestamped (severity 2)** — covered above;
this is the join that fixes it.

**Null prices carry no status (severity 2).** A wrapper with `price: null` is
neither tradable nor a discount; without a status field a consumer that reads
null as zero ranks it as the cheapest thing in the asset. We model it as a
distinct row status and keep it out of every ranking.

---

## 6. The X post

The brief asks for: the DoraHacks submission link, the demo video, and
`#BuildwithCMC` — with the CMC API portrayed positively. Here are two.

### Option A — the thesis post

> CoinMarketCap's API lists four wrappers of NVDA at four prices.
>
> A screener calls the gap an opportunity. This one prices the round trip:
> 52.5 bps spread, 27.7 bps to execute, 24.7 bps left — and then tells you the
> gap is smaller than NVDA's own 102.7 bps daily move, so you'd be marked
> against you before it closes.
>
> It also tells you when the cheapest row is a trap (40% of assets), and when
> it won't price the trade at all.
>
> Built with the CoinMarketCap API — RWA, crypto quotes and DEX pools, joined
> into something none of them can answer alone.
>
> ▶️ [demo video]
> 🔗 [submission link]
>
> #BuildwithCMC

### Option B — the API-feedback post

> Built a spread screener on the CoinMarketCap API — and it surfaced six
> concrete places the API could be sharper, all with runnable `curl`s:
>
> • `average_tokenized_price` averages across wrappers quoted in different units
> • no unit field on wrapper prices
> • `market-pairs/list` is plan-gated on the free tier
> • the DEX platform list doesn't carry the `network_slug` the DEX endpoints need
> • wrappers aren't individually timestamped
> • null prices carry no status
>
> The API made the joins possible — nothing else publishes every wrapper of an
> asset with price, volume and its own timestamp together.
>
> ▶️ [demo video]
> 🔗 [submission link]
>
> #BuildwithCMC

**Option A** leads with what the project does; **Option B** leads with the
feedback. The brief rewards both, so **post A at the demo link and B as a
follow-up** — and tag CoinMarketCap's account on B.

Do not post the key. Do not post the `.env`. Do not post a screenshot that
shows a request header with a live key in it — if you capture one, blur it
before it goes anywhere.

---

## 7. Pre-submission checklist

**Required by the brief**

- [ ] **One track** selected: **Markets and Trading Tools**
- [ ] **Public** GitHub repository, and the link in the form
- [ ] **Demo** deployed link *and/or* a screen recording — the link in the form
- [ ] **X post** published with: the DoraHacks submission link, the demo video,
      and `#BuildwithCMC`
- [ ] **CMC API endpoints named explicitly** — §3 above, pasted into the form
- [ ] **Evidence of a real API call** — code and response — §4 above
- [ ] **A note on what the API made possible and where it got in the way** — §5
      above, pasted into the form

**Repository hygiene**

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] **No API key anywhere in the tree.** `git grep -nEI 'CMC_API_KEY.*[A-Za-z0-9]{16,}'`
      returns nothing. CI enforces this, but check before you push.
- [ ] `.env` is not tracked: `git ls-files --error-unmatch .env` fails
- [ ] `.env.example` is committed and contains a placeholder, not a key
- [ ] The demo works from a clean clone with **no key**: `npm install && npm run seed && npm run dev`
- [ ] The dashboard says `OFFLINE FIXTURE — not a live pull` when it is the fixture

**Content**

- [ ] The README names the track in one line
- [ ] `docs/FEEDBACK.md` reads as feedback, not as complaint — check the tone
      before you publish it
- [ ] The demo script in `docs/DEMO.md` has been run at least once, out loud
- [ ] The X post is posted, and the demo video is attached to it

**Deployment — one of these, so the demo link is live**

- [ ] **GitHub Pages** (zero setup): **Settings → Pages → Source: GitHub
      Actions**. The `pages.yml` workflow publishes
      `https://joystonm.github.io/Coin/` on the next push. No key, no account.
- [ ] **Vercel** (serves the hosted API too): add `VERCEL_TOKEN`,
      `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as repository secrets, or run
      `vercel deploy --prod` once and connect the project. `deploy.yml` then
      deploys on every push.
- [ ] Open the deployed URL and check the **Findings** page loads — it is the
      one that needs `public/data/snapshot.json` to be served alongside the
      bundle.

**Deadline**

> Submissions close **9 December 2026, 23:59 UTC**. Leave a day. The demo
> recording takes longer than you think, and you will want to re-take it once
> after you have seen it.
