# Where the API got in the way

**For the CoinMarketCap product team.**

This project is a tokenized-asset spread screener. It lists every wrapper
CoinMarketCap knows about for a real-world asset, prices the round trip between
the cheap one and the rich one, and reports whether anything survives the
friction.

Doing that means joining four separate endpoints against each other, and the
joins are where the API fights back. Six things did. None of them are
"the endpoint was down" — all six are cases where the response was a **success**
that could not be used for the thing it appears to be for.

Nothing in this document is a complaint for its own sake. Every finding below
changed the product: it forced a refusal, a normalisation, or a cross-endpoint
join that the codebase would otherwise not have had. We have listed what we
worked around so you can see exactly what a consumer of the API has to build
around it.

---

## How to read it

| severity | meaning |
| --- | --- |
| **3** | blocks the product — the response cannot be used for its apparent purpose without workarounds that change the answer |
| **2** | material defect — the response is usable but incomplete or misleading |
| **1** | cosmetic |

**How they were found.** None of these are hand-written observations. They are
*derived from the data on every run* by `detectFindings()` in
[`src/lib/analysis.ts`](../src/lib/analysis.ts) and by the probes in
[`scripts/snapshot.ts`](../scripts/snapshot.ts). A finding that stops being
true disappears from the dashboard on the next pull. `cts findings` prints the
same list the dashboard shows, and `cts verify` re-checks the receipts.

Two labels are used for evidence:

- **live** — observed from the live API on **2026-11-25**, Startup tier key.
- **fixture** — observed in the committed offline fixture, which reproduces the
  *shape* of the problem so the behaviour is testable without a key.

---

## The findings

### 1. `average_tokenized_price` blends units — severity 3

**Endpoint** `/v5/real-world-assets/quotes/latest`

`quotes/latest` returns, per asset, the price of each wrapper token **and** an
`average_tokenized_price` for the asset. That average is taken across wrappers
that quote in **different units**. Gold's wrappers include several that quote
per troy ounce and at least one that quotes per gram — and 1 troy oz = 31.1035 g.

The result is a number that **no wrapper trades at**. A consumer who trusts
`average_tokenized_price` as "the price of this asset" gets a price that is
either ~31× too small or ~31× too large depending on how the average happened to
land.

This is not a rounding detail. It is the difference between a **0.03% spread
and a 3,000% one**, and nothing in the payload lets you tell which you are
looking at.

**Reproduce**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/latest?rwa_id=1"
```

Compare the per-wrapper `price` values against each other, then against
`average_tokenized_price`. One wrapper's price is a 31.1× multiple of the
others' — and there is no `unit` field anywhere in the response to say so.

**What we did.** We do not use the field. We compute our own anchor: the
volume-weighted mean of the wrappers that agree with each other, after
normalising recognised unit variants into the reference unit. We then report
`average_tokenized_price` against that anchor as a finding, so the discrepancy
is visible rather than hidden. Our anchor disagrees with the average by more
than 100 bps on the assets where the blend bites.

**Suggested fix.** Either compute `average_tokenized_price` over
unit-normalised, liquidity-weighted wrappers only — and publish the method
alongside the number — or drop the field in favour of the per-wrapper prices.
A field that a naive consumer *will* trust should not be a blend of units.

---

### 2. Wrappers under one `rwa_id` quote in different units, with nothing saying so — severity 3

**Endpoint** `/v5/real-world-assets/quotes/latest`

The same root cause as #1, seen from the other side. Every wrapper of one
asset comes back with a `price` and no `unit`. Two wrappers of the same stock
can legitimately differ by 31× because one is per gram and one is per ounce, or
because one is a whole share and one is a tenth of a share.

Nothing in the payload distinguishes these cases from a genuine dislocation. A
consumer has three bad options and no good one:

1. treat the spread as real → the screener screams "3,000% arbitrage" at a gold
   wrapper quoted per gram;
2. average them → you get `average_tokenized_price` (finding #1);
3. hard-code a conversion table for every wrapper → unmaintainable, and wrong
   the day a new issuer launches.

**Reproduce**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/latest?rwa_id=1"
```

Sort the wrappers by `price`. In the fixture: `GOLD/XAUTG` is priced per gram
(1 troy oz = 31.1035 g) while its peers are per ounce.

**What we did.** We detect known ratios — grams, troy ounces, milligrams, and
the share splits tokenized stocks come in — and normalise them into the
reference unit. A wrapper sitting at a ratio *nothing* explains is reported as
an **unexplained dislocation** and left out of the anchor. We never rescale a
price we cannot explain, because that would be inventing a conversion rate that
does not exist.

**Suggested fix.** Add a per-token `units_per_share` (or `unit` /
`quote_denomination`) field, and optionally a price expressed per underlying
unit alongside the native one. With that, comparing two wrappers of one asset
is arithmetic instead of guesswork — and `average_tokenized_price` becomes
well-defined.

---

### 3. `market-pairs/list` is refused on the free plan — severity 3

**Endpoint** `/v5/real-world-assets/market-pairs/list`

This is the endpoint that would answer the question the whole product turns on:
**where does a tokenized asset actually quote?** The reference lists it for
every plan. On the Startup tier it is refused with:

```
error_code 1006 — plan does not support this endpoint
```

**Reproduce**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  "https://pro-api.coinmarketcap.com/v5/real-world-assets/market-pairs/list?symbol=SPY&limit=5"
```

**Why it matters.** Without it, the only visibility into execution cost is the
DEX endpoints — and **many tokenized-asset wrappers have no DEX pool that
CoinMarketCap prices.** Their liquidity may sit on a broker or an ATS, which
`market-pairs/list` would show and the DEX endpoints cannot. In the committed
fixture, 2 of the 16 wrappers we looked up have no priced pool at all — and
for those two we cannot measure the execution cost at all, which is a
different fact from "it is expensive".

The absence of a pool is *not* evidence of illiquidity, and a consumer that
treats it as such will report a false negative on a genuinely tradable asset.
We record execution cost as **unknown**, never as zero, and `tradeability` as
`unknown` rather than `illiquid`. That refusal is visible in the product: the
dashboard says *"Absence of a pool is not evidence of illiquidity."*

**What we did.** We modelled execution from DEX depth where a priced pool
exists, and refused to price the leg where none does — which pushes the verdict
from `capturable` to `unpriceable` rather than to a fabricated number.

**Suggested fix.** Two things, and the second is the cheap one:

1. align the plan table in the reference with the actual gating; and
2. **name the minimum plan in the error message**, so a consumer can tell
   whether to upgrade or to work around it.

A bare `1006` costs a consumer an afternoon of guessing. `1006: requires
Professional` costs them one look.

---

### 4. The endpoint that lists DEX platforms does not carry the slug the DEX endpoints require — severity 2

**Endpoints** `/v1/dex/platform/list`, `/v4/dex/networks/list`

`/v1/dex/platform/list` is the discovery endpoint for chains. It returns 249
platforms — and its fields are single letters:

```
id, n, pltA, dn, v, p, na, cid, i
```

`n` is the display name, `pltA` the acronym. **There is no `network_slug`.**

But `/v4/dex/pairs/quotes/latest` requires a `network_slug`, and
`/v1/dex/token/pools` requires a `platform`. Neither's reference documents the
allowed values. The one endpoint that *does* carry `network_slug`,
`/v4/dex/networks/list`, is marked deprecated and refuses anonymous calls with
`error_code 1005` (403) — and on the keyless public path it is refused too.

So the slug has to be **discovered**: try a ranked list of candidates per chain
and keep the one that returns pools.

**Reproduce**

```bash
# The listing that succeeds and does not carry the slug:
curl "https://pro-api.coinmarketcap.com/public-api/v1/dex/platform/list"

# The endpoint that carries the slug, and refuses:
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  "https://pro-api.coinmarketcap.com/v4/dex/networks/list"
```

**What we did.** We build candidate slugs per chain from the platform name
(slugified), its acronym, and the platform's own name, try them in order, and
record which one worked so the next refresh starts from it. It works — but it
is discovery, not lookup, and it costs extra calls: one 404-ing request per
wrong candidate, per wrapper.

**Suggested fix.** Include `network_slug` on `/v1/dex/platform/list` — the
endpoint already returns the chain's own `cid`, so it has the identity to do it.
Alternatively, publish the accepted values for `platform` and `network_slug` in
the reference. Either one removes the guessing.

---

### 5. A wrapper can keep quoting a price it stopped trading at — severity 2

**Endpoints** `/v5/real-world-assets/quotes/latest`, `/v2/cryptocurrency/quotes/latest`

The RWA payload gives a price for a wrapper and the *asset's* `last_updated`.
**It does not timestamp wrappers individually.** A wrapper that stopped
trading ten days ago keeps quoting its last price, at the same timestamp as its
peers, and there is no way to tell from the RWA response alone.

This matters more than it sounds. In our fixture the wrapper `OLDX` quotes
$3,519.80 and last traded on 2026-11-15 — and it is **the cheapest gold wrapper
on the screen**. It is also not a price. A screener that surfaces it as the
discount is surfacing a dead print as the best opportunity in the asset.

**Reproduce**

```bash
# The RWA payload: one timestamp for the whole asset.
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/latest?rwa_id=1"

# The per-token timestamps, joined on crypto_id.
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=1&convert=USD"
```

**What we did.** We join `/v5/real-world-assets/quotes/latest` to
`/v2/cryptocurrency/quotes/latest` on `crypto_id` — a join no single endpoint
supports — and take each wrapper's own `last_updated` as the age of its price.
Freshness becomes its own axis, separate from price and separate from depth:
`live` (<24h) / `stale` (>24h) / `dormant` (>7d) / `unknown`. A stale print can
never be the other side of a `capturable` verdict, but it is still reported,
because "this price is a week old" is more useful than hiding the row.

**Suggested fix.** Return `last_updated` per wrapper token in the RWA payload.
The information already exists in the platform — `/v2/cryptocurrency/quotes/latest`
returns it — so this is a payload change, not a new pipeline. A `status` field
per wrapper (`active` / `stale` / `delisted`) would let a consumer filter
without a second call.

---

### 6. Wrappers are listed with a null price and no status to explain it — severity 2

**Endpoint** `/v5/real-world-assets/quotes/latest`

Some wrappers come back with `price: null`. They are neither tradable nor a
discount — they are absent — but the payload carries no field distinguishing
"never traded" from "delisted" from "temporarily unquoted".

**Reproduce**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  "https://pro-api.coinmarketcap.com/v5/real-world-assets/quotes/latest?rwa_id=1"
```

**Why it matters.** A consumer that reads a null price as zero ranks that
wrapper as the *cheapest thing in the asset* and puts it at the top of a
screener. A consumer that reads it as "no data" drops it. Only one of those is
right, and nothing in the response says which.

**What we did.** We model null price as a distinct row status (`no-price`),
keep it out of the anchor and out of the cheapest-wrapper ranking, and surface
it as a count on the asset's row so the omission is visible instead of silent.

**Suggested fix.** A per-wrapper `status` field — `active` / `delisted` /
`not-yet-traded` / `unquoted` — would make a null price self-describing.

---

## Priority summary

| # | finding | severity | one-line fix |
| --- | --- | --- | --- |
| 1 | `average_tokenized_price` blends units | 3 | compute it over unit-normalised, liquidity-weighted wrappers, or drop it |
| 2 | no unit field on wrapper prices | 3 | add `units_per_share` per token |
| 3 | `market-pairs/list` refused on the free plan | 3 | align the plan table, and name the minimum plan in the error |
| 4 | DEX platform list carries no `network_slug` | 2 | include `network_slug` on `/v1/dex/platform/list` |
| 5 | wrappers are not individually timestamped | 2 | return `last_updated` per wrapper token |
| 6 | null prices carry no status | 2 | add a per-wrapper `status` field |

Findings 1 and 2 are one fix. Findings 5 and 6 are one payload change.

---

## What the API made possible

This is not a list of complaints. Four CoinMarketCap endpoints are the entire
substance of the product, and three of them do something no other free source
does:

- **`/v5/real-world-assets/quotes/latest`** is the only place that lists every
  wrapper of a real-world asset with a price, a volume and a market cap
  **together**. Nothing else publishes the peer set.
- **`/v2/cryptocurrency/quotes/latest`** timestamps each token individually.
  That single fact is what makes staleness measurable — it is the join behind
  finding #5, and without it a dead print is indistinguishable from a live one.
- **`/v5/real-world-assets/quotes/historical`** gives the asset's own aggregate
  daily series, which is a **second, independent noise floor**. It is what
  lets the product say *"this 52.5 bps gap is smaller than NVDA's own median
  daily move of 102.7 bps"* — a statement about the *asset*, not about the
  wrappers, and the reason a capturable spread can still be a bad trade.
- **`/v4/dex/pairs/quotes/latest` and `/v1/dex/token/pools`** put a
  liquidity number behind each price, which is what turns "these two prices
  differ" into "these two prices differ by more than it costs to trade them".

The join is the product. `RWA quotes` × `token quotes` × `DEX pools` ×
`historical` is a question that no single endpoint can answer, and the fact
that it takes four is not a flaw — it is the shape of the data.

---

## Reproducing all of it

Nothing above requires trusting us.

```bash
# 1. Pull live (needs your own key in .env — never commit it).
npm run snapshot
npm run history

# 2. Print the findings the product derived from that pull.
npm run cli -- findings

# 3. Check every receipt: endpoint, query, HTTP status, error code, credits,
#    and the SHA-256 of the exact bytes received.
npm run cli -- calls
npm run cli -- verify

# 4. Inspect the raw responses behind any single finding.
ls evidence/
```

The evidence files hold the exact bytes the API returned, alongside the
SHA-256 of those bytes, so anyone can re-derive the hash and confirm the
response was not edited. The API key is a request header and is never written
to disk; every evidence file records it as `<redacted>`.

The scheduled `live.yml` workflow runs the same pull weekly and uploads the
snapshot and the raw evidence as artifacts, so there is a dated, public record
of the API's behaviour over time — not a single good afternoon.

---

*Written by the Cross the Spread team, for the Build with CMC hackathon. Every
example here is reproducible with the `curl` shown.*
