# ADR 0006 — Category saturation is real, and it is now measured

- **Status:** Accepted
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

## Projection, explicitly labelled

Extrapolating the decay, the vocabulary appears to converge toward **~1,100–1,300
distinct categories** at 10,000 businesses, a ratio near 0.12. **This is a
projection, not a measurement**, and must be labelled as such anywhere it
appears until the crawl completes.

## What would change this decision

If marginal discovery plateaus above roughly 15 new categories per 100
businesses through the remainder of the crawl, the vocabulary is not saturating
as cleanly as this data suggests and the article's thesis needs rewriting rather
than restating. Re-run the measurement at crawl completion before publishing.

## Why this matters beyond the cost number

The naive design sends every business to an LLM, so cost scales linearly with
the dataset forever. This design sends each _string_ once, ever — including
across future crawls, because `data/taxonomy-map.json` is committed and
`mergeTaxonomy` always lets the existing entry win. A re-crawl that introduces
no new categories costs nothing at all.
