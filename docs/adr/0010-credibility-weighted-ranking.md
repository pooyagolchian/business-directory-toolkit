# ADR 0010 — Rank by a credibility-weighted mean, not a raw star average

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

Every listing page in this directory — `/category/[l2]`, `/area/[area]`,
`/area/[area]/[l2]` — needs a default order. The first implementation sorted by
the star rating descending, because that is the obvious thing to do and the
number is already printed on the card.

It is wrong in a way that is visible on the page: **a lone 5-star review
outranks 2,000 reviews averaging 4.6.**

The star average is an _estimate_, and an estimate drawn from three samples
deserves less confidence than one drawn from three thousand. Sorting by the raw
average treats the two as interchangeable.

The v0.1 Dubai corpus says so outright. `ratingDistribution()` measures the
median review count standing behind each rating band:

| Rating band | Median reviews |
| ----------- | -------------: |
| Below 3.0   |             12 |
| 3.0–3.4     |             18 |
| 3.5–3.9     |             48 |
| 4.0–4.4     |             93 |
| 4.5–4.9     |            139 |
| 5.0         |         **11** |

The median climbs monotonically all the way up the scale and then collapses at
exactly 5.0, where **47% of businesses have fewer than ten reviews**. 2,283
Dubai businesses hold an exact 5.0 — the single most common rating in the city.

**A perfect score is not the top of the scale, it is the bottom of the
evidence.** Sorting by rating does not sort by quality; it sorts, quite
reliably, by how few people have been.

## Decision

**Order listings by `rankScore()` (`packages/core/src/rank.ts`), a
credibility-weighted mean.**

```
score = (v / (v + m)) * R + (m / (v + m)) * C

R = this business's rating      v = its review count
C = corpus mean rating          m = how many reviews count as "enough"
```

The same shape IMDb uses for its top-250, and Bayesian in spirit: treat the
corpus average as a prior belief, and let each business's own reviews move the
score away from it in proportion to the evidence behind them. As `v` grows the
first term dominates and the score converges on `R`.

### Both parameters come from the data

`corpusPrior()` derives a `RankPrior` from the corpus rather than from a
constant:

- `mean` — the arithmetic mean of every rating present. **4.49** on the Dubai
  crawl.
- `weight` — the **median** review count, floored at 1. **76** on the Dubai
  crawl.

The median, not the mean, and that is the load-bearing choice. Review counts
are heavily skewed by a handful of landmarks — one Dubai listing carries
**102,494** reviews, enough to pull its band's mean to five times its median —
and a mean would set the bar far above what a typical business could ever
clear. The median makes the threshold self-scaling: in a directory where
everyone has thousands of reviews, ten reviews should barely move a score; in
one where ten is typical, ten is real evidence.

### Rules the implementation holds to

1. **With `v = 0` the score is exactly `C`.** An unrated business ranks as
   average rather than as bad, which is the honest reading of no information.
   This is not a corner case: 940 of Dubai's 14,981 businesses carry no rating
   at all, because a meaningful share of what Google Maps returns are _places_
   rather than businesses and will never carry one.
2. **No evidence means the prior, and `rankScore` never returns `NaN`.** A
   rating with no review count behind it is unsupported, and a negative count is
   nonsense — both fall back to `mean`. That is not fussiness: the function is
   used as a sort comparator, and an unstable comparator scrambles a page rather
   than mis-ordering it. `rank.test.ts` pins the four shapes that could produce
   one — `(0, 0)`, `(5, 0)`, `(undefined, 100)`, `(4.4, -1)`.
3. **The prior is computed once per process, from the whole dataset.**
   `getPrior()` in `packages/web/lib/rows.ts` memoises
   `corpusPrior(allBusinesses())`. A category page of six spas would otherwise
   build a prior from six businesses, and every page on the site would rank on a
   different scale.
4. **`FALLBACK_PRIOR` — mean 4.0, weight 25 — is a guard, not a default.** It
   exists for an empty corpus and should never be reached in a real deployment.

### What the reader sees

Four sort orders — `rank` / `reviews` / `rating` / `name`, labelled **Best**,
**Most reviewed**, **Top rated**, **A–Z** — plus a minimum-rating filter of
Any / 4.0+ / 4.5+. "Best" is the default. "Top rated" is still offered, because
sometimes the raw average is genuinely what you want; it is just not a sensible
default. Server-rendered lists go through `byRank()` before `toRow()`, so the
first paint is already best-first rather than re-sorting after hydration.

The effect on real data, from the Spas category at the time of commit `48d1fbd`:

```
by raw rating   5.0 (679), 5.0 (573), 5.0 (293), 5.0 (260)
by rank         5.0 (679), 5.0 (573), 5.0 (293), 4.9 (3,670)   <- promoted
```

### The evidence ships with the ranking, not beside it

`packages/core/src/distribution.ts` exists to publish the measurement above, and
`RatingDistributionFigure` renders it on the home page. Two design decisions in
it follow directly from this ADR:

- **0.1-step bins.** At half-star buckets the distribution looks like a smooth
  climb and the spike at exactly 5.0 disappears into the 4.5–4.9 bucket that
  swallows it. The spike _is_ the finding, so the bins are fine enough to keep
  it. The bands underneath are coarse for the opposite reason — a median is only
  meaningful over enough businesses to have one, and 352 businesses rate below
  3.0 in total.
- **Two panels, two axes, never overlaid.** Counts and review medians have
  unrelated scales, and pinning two y-scales to one plot invents a visual
  correlation the data does not contain: the alignment between them would be a
  choice we made, not a fact we measured.

### Where the constants would have been wrong

`FALLBACK_PRIOR` is exactly the shape a hardcoded version of this would have
taken, and Dubai shows both halves of it wrong. A prior mean of 4.0 sits roughly
half a star below the measured 4.49, so every thinly-reviewed business would be
dragged towards a rating the city does not actually have. A weight of 25 is a
third of the measured median of 76, so ten reviews would count for far more than
the corpus says they are worth.

Those numbers looked reasonable when they were written. They were reasonable for
no city that has been measured. ADR 0005
(`0005-toolkit-not-directory.md`) makes "a different city" the normal case
rather than the exception, so a constant that happened to fit Dubai would be no
better than one that fits nothing — it would just be wrong somewhere else.

## Consequences

**Good:**

- Removes the failure mode rather than patching around it. There is no
  minimum-review hack, no manual curation list, no editorial thumb.
- Both parameters are measured, so the toolkit transplants to another city with
  no edits. A market town with 400 businesses and a median of 8 reviews gets its
  own threshold automatically (ADR 0005).
- An unrated business lands at the corpus mean instead of at the bottom of the
  page, which is the only defensible place to put something we know nothing
  about.
- It costs nothing to compute. `rankScore` is a pure function in
  `packages/core` over two fields every record already carries — no API call, no
  extra crawl, no stored column.
- The default is defensible in public. The home-page figure shows the working,
  which matters for a repository whose files are quoted in articles.
- Nothing is hidden. The raw stars are still on every card and "Top rated" is
  one click away.

**Bad:**

- **The published order no longer matches the visible stars.** A user sees a 5.0
  sorted below a 4.6 and has no explanation on the page unless one is given. The
  rating distribution figure is currently that explanation, and it lives on the
  home page rather than beside the list it explains.
- **It structurally favours incumbents.** A genuinely excellent new business
  cannot outrank an established one until it accumulates reviews, so the
  directory helps the already-popular. That is the correct statistical answer and
  an uncomfortable editorial one, and stating it is cheaper than pretending the
  ranking is neutral.
- **`m` is the corpus median, so it moves whenever the dataset does.** Rankings
  shift between crawls even when no business changes anything, and nothing in
  the UI or the pipeline surfaces that they shifted.
- **The prior is city-wide, not per category.** A vertical whose ratings
  genuinely run low is pulled up towards a mean it does not belong to, and one
  that runs high is pulled down.
- **Ranking now depends on a whole-corpus statistic.** That is cheap while the
  corpus is a bundled array read once per container (ADR 0009) and stops being
  free the moment the backend is DynamoDB. Milestone 2 must either precompute
  and store the prior or pay for it on every list.
- **`byRank()` does not use the memoised prior sitting next to it.** It calls
  `corpusPrior(allBusinesses())` per invocation while `getPrior()` in the same
  file caches the identical result — an extra full scan of the corpus for every
  sorted list, producing exactly the same numbers.
- **`/search` is not rank-ordered.** `search()` in `packages/web/lib/data.ts`
  scores by match strength with a `log10(reviews + 1)` tie-break, so the same
  businesses can come out in a different order there than on a category page.
  Two orderings on one site is a defect waiting to be reported, not a feature.

## Alternatives considered

- **Sort by the raw star average.** Rejected: it is what was there, and a lone
  5-star review outranking 2,000 reviews at 4.6 is the whole reason this ADR
  exists.
- **Sort by review count.** Rejected: it measures popularity, not quality. Kept
  as the "Most reviewed" option rather than made the default.
- **Hide anything below a minimum review count.** Rejected: it deletes
  businesses from a directory whose job is coverage, and the cliff would be
  arbitrary. The minimum-_rating_ filter is offered instead, as an explicit user
  choice rather than a silent one.
- **Wilson lower bound on a confidence interval.** Rejected: it is built for
  up/down votes. A 1–5 star average with a count is not a Bernoulli trial, and
  reconstructing one from the two numbers we hold would invent the data it
  needs.
- **IMDb's own constants.** Rejected for the reason in "Where the constants
  would have been wrong": a fixed `m` is wrong in both directions on a different
  city, and ADR 0005 makes a different city the normal case.
- **`rating × log(reviews)`.** Rejected: no principled scale, and it rewards
  review count without bound. It survives only as the tie-break inside
  `search()`, where the absolute value never matters.
- **Per-category priors.** Deferred, and it is the fourth item on the Bad list.
  The top 100 categories cover 87% of businesses, so the Zipf tail would draw
  priors from a handful of records each. Revisit when there is a sample-size
  test that decides which categories have earned their own.
- **Recency-weighted reviews.** Deferred: `rankScore` reads the aggregate rating
  and count, and per-review `iso_date` exists only on `AnonymousReview`, which
  `packages/core/src/reviews.ts` strips and never persists — for the same
  redistribution and personal-data reasons as ADR 0002
  (`0002-do-not-redistribute-the-dataset.md`).
- **Explain the order on the listing page itself.** Deferred, and it is the
  first item on the Bad list. The home-page figure carries the explanation for
  now, which is the wrong place for it.
