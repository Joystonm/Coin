# Method

How every number in this project is produced, and what it is allowed to say.

The short version: a wrapper spread is a price comparison, not a trade. This
document explains how the project turns a comparison into a trade, what it
costs, and where the arithmetic refuses to go further.

---

## 0. The contract

`src/lib/` contains the whole engine. It is **pure**: no `fetch`, no
`Date.now()`, no DOM, no globals. Every function takes its inputs, including
the reference time, as arguments.

That is not style. It is what lets the same code produce the number in the
terminal (`cli/cts.ts`), the number on the page (`src/ui/`), the number an
agent gets through MCP (`mcp/server.ts`) and the number the hosted API serves
(`api/`). Four surfaces, one engine, one answer. A screener whose web page and
whose API disagree is a screener nobody can trust.

```
snapshot.json ──▶ src/lib/analysis.ts ──▶ Analysis
                      │
                      ├── parity.ts   what is a wrapper worth?
                      ├── depth.ts    can you get it, and what does it cost?
                      ├── history.ts  how much does the asset move on its own?
                      └── crossing.ts is the spread capturable?
```

Everything below describes those four files.

---

## 1. Price — what is a wrapper worth?

### 1.1 The anchor

To ask "is this wrapper cheap", you need a reference. The reference is a
**consensus anchor**: the volume-weighted mean price of the wrappers that agree
with each other.

Two decisions matter here.

**The anchor is volume-weighted.** A wrapper quoting $3,525 with $1.5bn of
market cap and $106m of daily volume is worth more as a reference than a
wrapper quoting $3,519 with $940k of volume. Weighting by volume means a
wrapper nobody trades cannot drag the anchor.

**The reference unit is a cluster, not a median.** This is the subtle one, and
it was a real bug before it was a test. Gold has seven wrappers. Two of them
quote per troy ounce, one quotes per gram, and the rest quote something else
entirely. A plain median across seven prices lands *between* two units when the
split is even, and then every wrapper looks like it is trading at a huge
dislocation — or, worse, the average is taken and becomes a price nobody trades
at. `robustReference` instead finds the **largest cluster of wrappers that
agree within `SAME_UNIT_TOLERANCE` (25%)**, ranked by count and then by volume,
and takes the median of that cluster. In the fixture that is the four wrappers
that agree on ~$3,525; the gram-quoted wrapper is recognised as a unit variant
and normalised into it.

**A wrapper that cannot be explained is never rescaled.** `detectUnit` only
recognises a ratio it knows (grams, ounces, troy ounces, milligrams, and the
share splits that tokenized stocks come in). A wrapper sitting at a ratio
nothing explains is reported as an *unexplained dislocation* and left out of
the anchor. Silently rescaling it would be inventing a conversion rate that
does not exist.

### 1.2 The unit problem, in the API's own words

The RWA payload has no unit field. Two wrappers of the same `rwa_id` can
legitimately differ by 31× because one is per gram and one is per ounce, and
nothing in the response says so. This is not a rounding detail — it is the
difference between a 0.03% spread and a 3,000% one. The product therefore
detects it, normalises it, and files it as a finding with a reproduction.

### 1.3 Deviation, and the leave-one-out floor

Each wrapper's **deviation** is its distance from the anchor, in basis points.

The **noise floor** is how far apart the *other* wrappers normally sit. It is
computed **leave-one-out**: the pair under test is excluded from the floor that
judges it. Without that, a wrapper with an idiosyncratic price inflates the
floor that is supposed to catch it, and the product grades its own homework.

### 1.4 The floors

| constant | value | what it does |
| --- | --- | --- |
| `LIQUID_VOLUME_USD` | $50,000 | below this a wrapper does not get a vote on the anchor |
| `TRADEABLE_VOLUME_USD` | $250,000 | below this a wrapper is not counted as buyable |
| `DISLOCATION_BPS` | 25 | above this a wrapper is flagged as off-consensus |
| `OFF_PEG_BPS` | 500 | above this it is called off-peg |
| `AGGREGATE_GAP_BPS` | 100 | how far CMC's own aggregate may sit from our anchor before it is a finding |

---

## 2. Freshness — is that price still a price?

**The RWA endpoint does not timestamp wrappers individually.** It gives you a
price for a wrapper and the asset's own `last_updated`, and nothing in between.

So the product joins on `crypto_id` to `/v2/cryptocurrency/quotes/latest`, which
*does* timestamp each token individually, and measures the age of each
wrapper's own quote:

| freshness | age |
| --- | --- |
| `live` | under 24 hours |
| `stale` | over 24 hours |
| `dormant` | over 7 days |
| `unknown` | no timestamp at all |

A stale price is still a price — the liquidity figure is still measured — but
it is not a price you can trade. The two are separate axes on purpose, and a
stale print can never be the other side of a `capturable` verdict.

In the fixture, `OLDX` quotes $3,519.80 and last traded ten days ago. It is
the *cheapest* gold wrapper on the screen. It is also not a price.

---

## 3. Execution — can you get it, and what does it cost?

### 3.1 Where the liquidity comes from

Two DEX endpoints, used together:

- `/v4/dex/pairs/quotes/latest` — pools for a pair on a chain, with liquidity,
  volume and venue.
- `/v1/dex/token/pools` — the same thing for a token that no pair endpoint
  returns.

A wrinkle worth documenting: `/v1/dex/platform/list` lists the chains, but its
fields are single letters (`n`, `pltA`, `dn`, `v`, `p`) and **it carries no
`network_slug`** — the identifier the DEX endpoints actually accept. The
endpoint that does carry slugs, `/v4/dex/networks/list`, is deprecated and
refused. So the slug has to be *discovered*: the snapshot tries a ranked list
of candidates per chain (the platform name normalised, its acronym, the
platform's own name, the slug the map endpoint implies) and remembers the one
that works. This is recorded as a finding, because a consumer who believes the
platform list gives you slugs will build an empty map.

### 3.2 The price impact model

Constant product, one-sided:

```
impact = size / (liquidity + size)
```

and the **round trip** is two of those, because you buy one side and sell the
other:

```
roundTrip = 2 × size / (L + size)
```

`$100,000` into a `$10,000,000` pool is `99.01 bps` one way and `198.02 bps`
round trip. That is a *thin* market by this project's standard: the round
trip costs more than 1% (`THIN_ROUND_TRIP_BPS = 100`).

Liquidity is summed across every pool that can be priced. A pool with no USD
liquidity figure contributes nothing and is not counted as evidence of
illiquidity.

### 3.3 Days to exit

```
daysToExit = size / volume24h
```

A wrapper with $1m of 24h volume and a $100k position is 0.1 days to exit.
A wrapper with $22,000 of 24h volume is 4.5 days, which is a different kind of
fact.

### 3.4 The refusal

If CoinMarketCap lists no pool for a wrapper, its execution cost is recorded as
**unknown**, never as zero. The wrapper's `tradeability` is `unknown` and the
product says so in words: *"Absence of a pool is not evidence of illiquidity."*

This refusal is the whole reason the trap finding exists.

---

## 4. The trap — the cheapest on the screen is not the cheapest you can buy

For each asset the product computes two things:

- **cheapest on screen** — the lowest-priced wrapper that voted on the anchor;
- **cheapest reachable** — the lowest-priced wrapper that is actually buyable:
  has a price, a volume above the floor, and a pool that can carry the position.

When those are different wrappers, the screen is misleading, and the asset is
flagged.

This is not a hypothetical. In the fixture, NVDA's `NVDA.D` is quoted at
$150.21 against `NVDAX` at $150.72 — it is the cheapest wrapper on the screen.
It has **no DEX pool CoinMarketCap prices**. You cannot buy it with this tool's
money. The cheapest wrapper you can actually buy is a different one at a
different price.

A screener that shows the $150.21 is not lying. It is just answering a
different question, and it does not say which.

---

## 5. The verdict

For each candidate pair — cheapest wrapper against richest — the judge computes:

```
spread = (richPrice / cheapPrice - 1) × 10000
cost   = roundTripImpact(cheap) + roundTripImpact(rich)
net    = spread − cost
```

and then decides. The order of the checks matters, because the earlier checks
are the ones that invalidate the comparison itself.

```
1. no price on one side            → not-distinguishable
2. the price is stale               → not-distinguishable  ("may no longer exist")
3. the gap is inside the noise floor → not-distinguishable
4. one side has no volume           → dead-side           ("not an arbitrage")
5. the sides are on different chains → unpriceable        ("a bridge, which we do not price")
6. we cannot price either leg       → unpriceable        ("not evidence of a free trade")
7. spread ≤ 0                       → not-capturable
8. spread ≤ cost                   → not-capturable     ("short by N bps")
9. otherwise                        → capturable
```

`MIN_SPREAD_BPS = 10`: below that, two wrappers are not two prices.

Two refusals deserve their own note:

- **Different chains** (`SPYon` on Ethereum, `SPYX` on Solana): you would have
  to bridge, and no CoinMarketCap endpoint prices a bridge. The product does
  not guess. It says `unpriceable`.
- **Different issuers** (`NVDAP` is Paxos, `NVDAY` is Ondo): moving between
  them needs a *redemption*, not a swap, and redemption carries settlement
  risk this product does not price. The verdict can still be `capturable`; the
  reason list says the caveat out loud.

### 5.1 Why "not-capturable" is a real answer

Four of the ten judged pairs in the fixture are `not-capturable`: the spread is
genuinely there, and it genuinely does not survive the friction. A screener
that only shows opportunities is a screener with a selection bias. Showing the
`not-capturable` pairs is the point.

---

## 6. The time-series arm

The other three arms look *across* wrappers. This one looks at the same asset
*through time*, from `/v5/real-world-assets/quotes/historical`.

It answers a different question: **how much does this asset move on its own?**

```
NVDA's tokenized price moves a median of 102.7 bps a day over the 30-day history
```

So a 52.5 bps gap between two NVDA wrappers is *smaller than an ordinary
day's move*. The spread is real, the spread is capturable, and the position
would still be marked against you before it closed. Both facts belong in the
answer.

### 6.1 Three statistics, three jobs

| statistic | what it is for |
| --- | --- |
| `medianAbsMoveBps` | the floor a gap has to beat |
| `p95AbsMoveBps` | how bad the ordinary bad days are |
| `positionInHistory` | where today's price sits against the window's own range |

`dailyMovesBps` skips gaps longer than 3.5 days: a move across a weekend or a
trading halt is not a daily move, and counting it would inflate the volatility
floor.

### 6.2 "When did this open?"

The historical endpoint reports the **aggregate** price for an asset, not
per-wrapper prices. So when the aggregate has been pinned to one level for
twenty-nine days and the wrappers now disagree, the disagreement is *new*.

`stabilityOfSeries` decides whether that is true, and it is deliberately
hard to trigger. A breakout needs all three of:

1. the observations before the last one sat on a tight level (dispersion at or
   below the series' own daily noise),
2. that level was held for at least three days, and
3. the last move is more than twice the series' daily noise.

A series that drifted every day for a month has no level to break out of.
Calling that a breakout would be a story about noise, so the product does not
tell it.

### 6.3 When the history is missing

History is optional. With no history file, the product **says the time-series
arm is unavailable** — it does not assume the asset is calm. Absent history is
not evidence of safety.

---

## 7. The receipts

Every call the pipeline makes is recorded as it happens:

```ts
{ endpoint, query, credits, errorCode, errorMessage, elapsedMs, at }
```

`evidence/` holds the raw response bytes for each call, with a SHA-256 digest.
`cts verify` re-derives every digest from the stored bytes and tells you
whether they still match. The API key is a request header and is never written
to disk: every evidence file records the header as `<redacted>`.

This is the "visible evidence of a real API call" the brief asks for, and it is
checkable rather than asserted.

---

## 8. What the API made possible, and where it got in the way

**Made possible:** the three-way join that no single endpoint can do. The RWA
endpoints say *what exists*; the cryptocurrency endpoints say *when it last
traded*; the DEX endpoints say *what it would cost to buy*. Only the
combination produces a verdict about a trade. The historical endpoint adds a
fourth, independent noise floor. `/v2/cryptocurrency/quotes/latest` timestamped
per token is what makes staleness measurable at all.

**Got in the way:** five concrete things, each with a reproduction in
[`docs/FEEDBACK.md`](FEEDBACK.md). The two that hurt the product most:

1. `average_tokenized_price` is taken across wrappers quoted in **different
   units**, so it is a number no wrapper trades at. The product does not trust
   it — it computes its own anchor and reports the gap.
2. `/v5/real-world-assets/market-pairs/list`, the endpoint that would show
   where tokenized assets actually quote, is refused on the free plan
   (`error_code 1006`), so venue-level liquidity for RWA wrappers is invisible.

---

## 9. The credit budget

The free Startup tier is enough for the whole project. The default pull is:

| step | calls | credits |
| --- | --- | --- |
| `/v5/real-world-assets/map` | 1 | 0 |
| `/v5/real-world-assets/assets/list` | 1 | 1 |
| `/v5/real-world-assets/quotes/latest` | 1 | 1 |
| `/v5/real-world-assets/info` | 1 | 1 |
| `/v5/real-world-assets/issuers/list` | 1 | 1 |
| `/v2/cryptocurrency/info` | 1 | 1 |
| `/v2/cryptocurrency/quotes/latest` | 1 | 1 |
| `/v1/dex/platform/list` | 1 | 1 |
| `/v4/dex/pairs/quotes/latest` | 1 + one per wrapper | 1 each |
| `/v1/dex/token/pools` | fallback, one per wrapper | 1 each |
| `/v5/real-world-assets/market-pairs/list` | 1 | 0 (refused) |
| `/v5/real-world-assets/quotes/historical` | 1 | 1 |

The knobs are environment variables, so the budget is tunable without touching
code:

```bash
CTS_ASSET_LIMIT=120      # assets to list        (default 250)
CTS_DEPTH_ASSETS=60      # assets to look up pools for (default 60)
CTS_DEPTH_WRAPPERS=4     # wrappers per asset      (default 4)
CTS_SIZE_USD=100000      # notional size          (default 100000)
CTS_HISTORY_DAYS=30      # history window         (default 30)
```

The live pull in `.github/workflows/live.yml` uses a smaller universe to stay
inside the free tier.
