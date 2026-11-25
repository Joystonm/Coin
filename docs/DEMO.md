# Demo script

Two formats: a **3-minute screen recording** for the submission form, and a
**5-minute live demo** for the presentation slot. Both tell the same story in
the same order, because the story *is* the product.

The order matters and should not be rearranged:

> **here is the spread → here is what it costs to capture → here is what it is
> worth against the asset's own noise → here is what the screener would have
> got wrong → here is where the API got in the way.**

---

## Format A — the 3-minute screen recording

**Setup before you hit record**

- Terminal at 1280×720 (or larger), font size 16+, dark theme.
- Browser at 1440×900, `npm run dev` already running, one tab.
- Notifications off, dock hidden, `Esc` twice to clear Spotlight.
- Close every other app. A judge will notice.
- If you have a key, run `npm run snapshot && npm run history` **before**
  recording, so the pull happens off-camera. If you do not, run `npm run seed`
  — the fixture is honest and the demo is identical in structure.

**Recording order:** record the browser first, then the terminal. Both are
needed; the terminal carries the arithmetic, the browser carries the shape.

---

### Shot list

| # | time | screen | action | what the viewer should be hearing |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | dashboard, Radar | land on the page | "CoinMarketCap lists four wrappers of NVDA. Four prices. A screener calls the gap an opportunity." |
| 2 | 0:12 | dashboard, Radar | hover/point at the `NVDA NVDAP → NVDAY` row | "This one is capturable: the 52.5 basis point gap clears the 27.7 basis point cost of executing it by 24.7." |
| 3 | 0:30 | dashboard, Radar | point at the reason line under that row | "And here's the part a screener wouldn't tell you: the gap is smaller than NVDA's own daily move. 102.7 basis points a day. So the position gets marked against you before the spread closes." |
| 4 | 0:50 | dashboard, Radar | scroll to the `GOLD XAUTG → GOLDX` row | "Now the one a naive screener would have sold you. 154 basis points of gold spread — and the round trip costs 230. It loses." |
| 5 | 1:05 | dashboard, Radar | scroll to `NVDA NVDA.D` and `TLT TLTX` | "This one we can't price at all: different chains, and no endpoint prices a bridge. And this one: the deepest pool holds forty thousand against a hundred thousand position." |
| 6 | 1:20 | dashboard, Radar | point at the header stats | "Ten pairs judged. One capturable. Four not capturable, two not distinguishable, one dead side, two unpriceable. The refusals are the point." |
| 7 | 1:35 | dashboard, Radar → NVDA asset | click the NVDA row | "Here's the asset in full. Every wrapper against the consensus anchor. And this: the cheapest wrapper on the screen is 150 dollars 21." |
| 8 | 1:55 | dashboard, NVDA ledger | point at `NVDA.D`'s row | "It has no pool CoinMarketCap prices. So the cheapest thing on the screen is not the cheapest thing you can buy. That happens on forty percent of assets." |
| 9 | 2:10 | dashboard, NVDA ledger | scroll to the history panel | "And this is the fourth axis. The asset's own thirty-day series. What did the price do while you weren't looking?" |
| 10 | 2:25 | dashboard | click **Findings** | "Now the part for the CoinMarketCap team. These findings are auto-detected from the data on every pull — they're not written by hand." |
| 11 | 2:40 | dashboard, Findings | point at the severity-3 card | "The endpoint that would show where tokenized assets actually quote is refused on the free plan. Error code 1006. So a wrapper whose liquidity sits on a broker is invisible to us, and we record its cost as unknown rather than zero." |
| 12 | 2:52 | dashboard, Findings | point at the `curl` on a card | "Every finding carries a curl. You can run it and see for yourself." |
| 13 | 2:55 | terminal | `npm run cli -- radar` | "The same engine, in the terminal. One `src/lib`, four surfaces — the web page and the API cannot disagree, because they call the same function." |
| 14 | 3:05 | terminal | `npm run cli -- calls` then `npm run cli -- verify` | "And every number traces to a receipt: endpoint, query, status, error code, credits, and the hash of the exact bytes we received. Which I can re-derive, here, now." |

**Land it** (last five seconds, on the terminal or the dashboard header):

> "Cross the Spread. It prices the round trip, and it tells you where the API
> would not let it. The code, the evidence and the feedback are in the repo."

---

### Narration script (verbatim)

> CoinMarketCap's Real World Assets endpoints list several tokens for the same
> underlying. For NVDA there are four — NVDAX, NVDA.D, NVDAY, NVDAP — each with
> its own price, its own volume, its own pool. Any screener will show you the
> gap between them and call it an opportunity.
>
> This one asks what happens after you pay to cross it.
>
> The NVDA spread between NVDAP and NVDAY is 52.5 basis points. The round trip
> costs 27.7 — buying into ninety million of liquidity, selling out of sixty
> million, at a hundred thousand dollars. So it's capturable, by 24.7 basis
> points.
>
> But the gap is smaller than NVDA's own daily move. Over the last thirty days
> the tokenized price moved a median of 102.7 basis points a day. So the
> position would be marked against you by more than it makes, before the spread
> closes. Both things are true at once, and the product says both.
>
> Now the row a naive screener would have sold you: gold, a hundred and fifty
> four basis points of spread — and two hundred and thirty basis points of
> round trip. It loses. We show it anyway, because a screener that only shows
> the rows it likes has a selection bias.
>
> And the ones we refuse to price at all: two wrappers on different chains,
> where closing the trade needs a bridge no CoinMarketCap endpoint prices. We
> don't guess. We say unpriceable. Absence of a pool is not evidence of a free
> trade.
>
> On the asset page, the cheapest wrapper on the screen is NVDA.D at a hundred
> and fifty dollars twenty-one. It has no pool CoinMarketCap prices. The
> cheapest thing you can actually buy is a different one. That happens on forty
> percent of assets.
>
> And this last page is for the CoinMarketCap team. Every finding on it is
> auto-detected from the data on each pull, not written by hand. The worst one:
> the endpoint that would show where tokenized assets actually quote is refused
> on the free plan — error code 1006 — so a wrapper whose liquidity sits on a
> broker instead of a DEX is invisible to us. We record its cost as unknown,
> never as zero. Every finding carries a curl.
>
> One engine, four surfaces — this dashboard, a CLI, seven read-only MCP tools
> and a hosted API. They call the same pure functions, so they cannot disagree.
> And every number on the screen traces to a receipt with a hash of the exact
> bytes we received, which I can re-derive in front of you.

---

## Format B — the 5-minute live demo

Same story, with room to answer questions. Run it against the **live** pull if
you have a key; the numbers will differ from the fixture, and that is fine —
**say so out loud** ("these are live, pulled this morning, and the numbers
move"). If a number comes out `—`, say what that means; the refusals are the
interesting part and a live pull has more of them.

| time | beat | where |
| --- | --- | --- |
| 0:00 | the problem, in one image | the dashboard radar |
| 0:30 | the one good trade, and why it is still not free | NVDA asset page |
| 1:30 | the trap | NVDA asset page, `NVDA.D` |
| 2:00 | the refusals | radar, scroll |
| 2:45 | the API feedback | findings page |
| 3:30 | the engine: one `src/lib`, four surfaces | terminal |
| 4:15 | the receipts, re-derived live | terminal, `cts verify` |
| 4:45 | the MCP server — an agent asking the same question | terminal / MCP inspector |
| 5:00 | close | back to the dashboard |

**Live-demo rules that are worth the effort**

- **Never type an API key on screen.** The pull is done before the demo. If
  someone asks for a live pull, offer the `live.yml` workflow instead — it runs
  the same pull and publishes the evidence as an artifact.
- **Have the fixture ready as a fallback.** If the deployed site is down, the
  demo still works from `npm run seed && npm run dev`. Say "here's the
  committed snapshot" rather than apologising.
- **Leave the terminal at `npm run cli -- radar`** between beats so that a
  question about the arithmetic is one keypress away.

---

## Questions you should expect, and the answers

**"How do you know the spread is real and not just two different units?"**
> The API doesn't say. Two wrappers of one `rwa_id` can quote per troy ounce
> and per gram, and nothing in the payload says so — a 31× difference. So we
> detect known ratios, normalise them into the reference unit, and if a price
> is at a ratio *nothing* explains we report it as an unexplained dislocation
> and leave it out of the anchor. We never rescale something we can't explain.

**"Where does the 27.7 basis points come from?"**
> Constant-product price impact, one-sided: `size / (liquidity + size)`. Buy
> into NVDAP's ninety million: 11.1 bps. Sell out of NVDAY's sixty million:
> 16.6. A round trip is two of those, because you buy one side and sell the
> other. It's a model, not a quote — and we say it's a model.

**"Why not just show the profitable ones?"**
> Because then you'd have no way to know what you'd missed. Four of the ten
> judged pairs in the fixture are not capturable, and they're the rows a naive
> screener would have sold you.

**"Is this live data?"**
> The dashboard says at the top: `OFFLINE FIXTURE — not a live pull` or the
> live source and the pull time. The API says the same. We never present
> fixture output as live.

**"How much of the free tier does this use?"**
> The whole default pull is inside the Startup tier; the credit budget is
> written down in `docs/METHOD.md` §9, and `cts calls` prints what the last
> pull actually cost.

**"Why is there a `not-distinguishable` verdict?"**
> Because two prices that aren't two prices shouldn't be shown as a spread. A
> gap inside the peer noise floor, or a price that last traded ten days ago,
> is not an opportunity — it's an artefact.

**"What would you do with more API budget?"**
> The honest answer is the finding list: `market-pairs/list` would remove the
> biggest unknown in the execution model, and per-wrapper `last_updated` would
> remove a join. Both are in the feedback document.

---

## Recording notes

- Record at **1920×1080** and let the player scale down; 1440×900 is the
  minimum that keeps the reason lines readable.
- **Terminal text must be legible.** 16pt minimum, and no more than 60
  characters of output on screen at a time. `cts radar` prints ~60 columns —
  good. If your terminal is wider, the table will space out; cap it at 100
  columns.
- **Cut dead air.** Every "umm" costs you a quarter of a second of a
  three-minute video, which is a quarter of a second of the judge's patience.
- **Do not add music.** A screener with music reads as a screener.
- **Subtitles are worth it.** Most judges watch muted. The narration above is
  written to work as a subtitle track.
- **End on a still frame** of the radar with the capturable row visible, for
  three seconds — it becomes the video's thumbnail.
