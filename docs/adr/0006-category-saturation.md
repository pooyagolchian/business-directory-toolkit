# ADR 0006 — Category saturation is real, and it is now measured

- **Status:** Accepted · verified 2026-08-21
- **Date:** 2026-08-21

## Context

The project's central cost claim is that **classifying distinct category
strings is far cheaper than classifying businesses**, because Google's category
vocabulary is finite and saturates while business count does not.

That claim was, until now, **unmeasured**. The only evidence was a 100-business
restaurant-only sample that produced **0.89 distinct categories per business** —
an unflattering ratio that, taken at face value, would have made the whole
approach pointless. Publishing a savings multiple on that basis would have been
indefensible.

## The measurement

Taken from the archived raw responses of the in-progress v0.1 crawl, across all
40 verticals. **Zero additional API credits** — the crawl archives every raw
response to disk before parsing (Stage 1), so the corpus was already sitting
there to be read.

| Businesses | Distinct categories | Ratio | New categories per 100 businesses |
| ---------: | ------------------: | ----: | --------------------------------: |
|        250 |                 165 | 0.660 |                              66.0 |
|        500 |                 343 | 0.686 |                              71.2 |
|        750 |                 533 | 0.711 |                   **76.0** ← peak |
|      1,000 |                 643 | 0.643 |                              44.0 |
|      1,250 |                 728 | 0.582 |                              34.0 |
|      1,500 |                 803 | 0.535 |                              30.0 |
|      1,750 |                 856 | 0.489 |                              21.2 |
|      2,000 |                 887 | 0.444 |                              12.4 |
|      2,500 |                 966 | 0.386 |                              12.0 |
|      2,750 |                 978 | 0.356 |                           **4.8** |

**2,816 businesses → 983 distinct categories. Ratio 0.349 and falling.**

## Decision

**The thesis holds.** Marginal discovery fell from 76 to 4.8 new categories per
100 businesses — a **94% decline** — and the curve turned decisively after 750
businesses.

The earlier 0.89 figure was not wrong, it was simply the first hundred points of
a curve that had not turned yet. A single dense vertical saturates slowly
because it keeps producing cuisine-specific variants; across 40 verticals the
shared vocabulary asserts itself quickly.

**Rules adopted from this:**

1. Quote the **measured** distinct-category count at crawl completion. Do not
   quote a savings multiple before then.
2. Report the **marginal** rate alongside the total. The marginal rate is the
   real story — it is what makes the next 1,000 businesses effectively free.
3. Publish the curve, including its unflattering start. The turn is more
   convincing than any endpoint.

## VERIFIED at crawl completion (2026-08-21)

The crawl finished at 1,400 requests. Re-running the measurement over the full
corpus:

| Businesses | Distinct | Ratio | New categories per 100 businesses |
| ---------: | -------: | ----: | --------------------------------: |
|      2,000 |      954 | 0.477 |                              47.7 |
|      4,000 |    1,244 | 0.311 |                              14.5 |
|      6,000 |    1,377 | 0.230 |                               6.7 |
|      8,000 |    1,472 | 0.184 |                               4.8 |
|     10,000 |    1,560 | 0.156 |                               4.4 |
|     12,000 |    1,671 | 0.139 |                               5.5 |
|     14,000 |    1,735 | 0.124 |                               3.2 |

**15,246 businesses → 1,788 distinct categories. Ratio 0.117. Final marginal
rate 4.3 new categories per 100 businesses.**

The pre-registered threshold was 15 per 100. At 4.3 the thesis is **confirmed**.

**Publishable claim:** classifying categories instead of businesses puts
**1,788 items** in front of the model instead of **15,246** — **8.5x fewer** —
and the marginal rate of 4.3 means the next thousand businesses add roughly 43
new strings, not a thousand.

### Where the earlier projection was wrong

This document previously projected ~1,100–1,300 distinct categories at 10,000
businesses. The measured figure at 10,000 was **1,560** — the projection
undershot by 20–42% of its own value (1,100 was low by 460, 1,300 by 260).

The decay is slower in the tail than the early curve suggested, and it is not
perfectly monotonic: the marginal rate ticked back up at 12,000 (5.5) as sparse
outer tiles introduced business types the city centre never contained. The
direction of the thesis was right; the specific number was too optimistic.
Publish the measurement, not the extrapolation.

## Consequences

**Good:**

- The project's central cost claim is now a measurement rather than an
  assertion: **1,788 items** in front of the model instead of 15,246, and a
  marginal rate of 4.3 per 100 to say what the _next_ crawl costs.
- It cost **zero API credits** to learn. Stage 1 archives every raw response
  before parsing, so the corpus was already on disk
  ([ADR 0001](./0001-tile-the-crawl.md)).
- The saving compounds across crawls rather than repeating. Because
  `data/taxonomy-map.json` is committed and `mergeTaxonomy` lets the existing
  entry win, a string is classified once, ever.
- The unflattering start is published — 0.89 distinct categories per business on
  the restaurant-only sample — so the turn in the curve is checkable rather than
  claimed.

**Bad:**

- **A wrong hand-mapped entry is permanent and silent.** `mergeTaxonomy` is
  `{ ...incoming, ...existing }` — the committed entry always wins, over both
  the keyword rules and the model. That is deliberate, and the root README sells
  it as the whole reason a one-line taxonomy pull request is worth making. It
  also means a category mapped to the wrong `l2` survives every future crawl,
  every `seed-taxonomy` run and every `classify --yes`, with nothing that
  re-examines it and no signal that anything is wrong. The 1,250 entries
  currently committed have no expiry and no second reader.
- **The tail is classified with no review step.** `pnpm classify --yes` calls
  Haiku 4.5 and writes the merged map straight to disk — there is no
  intermediate file to inspect and no approval gate between the model's answer
  and a live browse page. On the v0.1 corpus that is **537 of 1,787 strings**
  going in unreviewed. The `--dry-run` reports the count and the cost; it does
  not report the mappings.
- **The marginal rate is not monotonic, so 4.3 is an endpoint and not a law.**
  It ticked back _up_ to 5.5 at 12,000 businesses when sparse outer tiles
  introduced business types the city centre never contained. Nothing here
  establishes that a city with a coarser or more fragmented Google taxonomy will
  not tick up again, later, and further. The thesis is measured for Dubai; the
  specific number is not portable, and the 15-per-100 pre-registered threshold
  is the claim that ports, not the 4.3.

## Why this matters beyond the cost number

The naive design sends every business to an LLM, so cost scales linearly with
the dataset forever. This design sends each _string_ once, ever — including
across future crawls, because `data/taxonomy-map.json` is committed and
`mergeTaxonomy` always lets the existing entry win. A re-crawl that introduces
no new categories costs nothing at all.
