# ADR 0001 — Tile the crawl geographically, because one query is capped at ~200 results

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

This is chronologically the first decision the project made, and every cost
figure published since rests on it. It has never been written down. The
reasoning currently lives in a comment above `PAGE_CAP` in
`packages/pipeline/src/plan.ts`, in the `note` field of
`data/cities/dubai.json`, and in the `_readme` array of
`data/cities/_template.json` — three places, none of them the decision record.

The SearchApi Google Maps engine returns 20 results a page and caps a single
query at roughly 200 results in total. The obvious first move is to paginate
past that, and it does not work, because **the ceiling is per query, not per
page.** The probe that settled it is committed as
`fixtures/searchapi/google_maps_downtown_page11_empty.json`: the response for
`page=11` carries `search_metadata`, `search_parameters` and
`search_information`, and **no `local_results` key at all**. Not an empty
array — the key is absent. The eleventh request is guaranteed waste, so no
amount of pagination buys what tiling buys; it just spends credits against a
wall.

That makes "restaurants in Dubai" unable to enumerate Dubai's restaurants. The
arithmetic is not close: 40 category queries at ~200 results each is 8,000 in
the theoretical best case, before the measured ~45% cross-category duplicate
rate takes its share — against the **15,246 unique businesses** the v0.1 crawl
actually found. A city does not fit through one query per category.

So the crawl has to be partitioned in space before it is partitioned in
anything else. And because one request is one credit
(`CREDIT_PER_REQUEST = 1` in `packages/pipeline/src/cli/plan.ts`), _how_ it is
partitioned is not an implementation detail. It is the credit bill.

## Decision

**A city is crawled as a set of named geographic tiles, one query per
(tile, category) pair, with pagination depth decided at run time.**

### Tiles are real neighbourhood centres, not an even grid

`data/cities/dubai.json` ships **44 tiles and 40 categories** — Downtown Dubai
at `25.1972, 55.2744` zoom 15, Deira at `25.2697, 55.3095` zoom 15, out to
Hatta at `24.7994, 56.1213` zoom 13, which is Dubai but 130 km from the city
and needs its own bounding box. Fifteen tiles are marked `dense`, 18 `medium`,
11 `sparse`.

An even grid over the bounding box would be trivial to generate and worse to
run. Business density follows neighbourhoods; a grid spends requests on water,
desert and airports at exactly the same rate as it spends them on Deira.

Measured overlap between Downtown and Deira was **0**. Tiles partition cleanly,
so tiling pays no duplication tax of its own. The ~45% duplicate rate the crawl
does pay is cross-category — one business tagged with several categories is
returned by each one's query — and `runCrawl` absorbs it with a single global
`seen` set of `place_id` values, so a repeat is counted in `duplicatesSkipped`
rather than stored twice.

### `density` × `tier` is the cost lever, and it is a table, not a formula

```ts
const PAGE_CAP: Record<Density, Record<Tier, number>> = {
  dense: { broad: 5, standard: 3, niche: 1 },
  medium: { broad: 3, standard: 2, niche: 0 },
  sparse: { broad: 1, standard: 0, niche: 0 },
};
```

A zero means the pair is never requested at all — `buildCrawlPlan` drops it
before a credit is committed. Crawling "law firms" in the desert spends money
to find nothing, and `plan.test.ts` asserts that it does not happen.

For Dubai that turns 44 × 40 = **1,760 possible pairs into 1,250 planned
first-page requests**, with 510 pairs dropped outright. The worst case, if
every surviving job paginated to its cap, is **3,170 requests** against a
planned budget of 2,000 out of the 100k credit allowance. No cap exceeds 10 by
construction — `plan.test.ts` guards it against the page-11 cliff — and in the
Dubai config the deepest is 5.

### Only page 1 is planned

Stage 0 plans first pages and nothing else. Depth is enqueued at run time by
`shouldFetchNextPage` in `packages/pipeline/src/fetch.ts`, which continues only
when the page came back **full at 20 results** (`FULL_PAGE`) **and at least 30%
of them were new** (`DEFAULT_MIN_NEW_RATIO = 0.3`).

Both halves are load-bearing. A short page means Google is out of results — the
committed page-2 fixture returns 10, and four of those ten were already seen on
page 1. A full page of mostly-seen businesses means the useful end of the query
arrived before the hard ceiling did. Pre-planning depth would commit credits to
pages the data says are not worth fetching.

### The plan is deterministic, and failures do not abort it

`buildCrawlPlan` emits jobs in a fixed order, so a published crawl reproduces
exactly from the committed city config. That is the internal reproducibility
ADR 0002 promises even though the upstream Google results drift underneath it —
and it works with the raw archive: `runCrawl` hands every response to `onRaw`
_before_ parsing, so later stages can be re-run without re-spending.

A failing request is recorded in `errors` and skipped, never thrown. One
rate-limited tile must not cost the remaining requests of a run.

### This is what makes ADR 0005 possible

Because the tiling is data, a city is data. `data/cities/<id>.json` is the whole
extension point, and pointing the toolkit at somewhere new changes no code.
ADR 0005 reframed the project as a toolkit for any city; it could only do that
because this decision had already put the expensive part in a JSON file. The
40 categories here are crawl _queries_, incidentally — not the taxonomy. The
category strings Google returns are ADR 0006's subject.

## Consequences

**Good:**

- The ~200-result ceiling stops being a limit and becomes a unit. Coverage is
  bought by adding tiles, which is a line of JSON, not a code change
- The credit bill is knowable before it is spent. `pnpm crawl --dry-run` prints
  1,250 up front and 3,170 worst case and exits without touching the network,
  and `--yes` is required before anything is charged
- v0.1 came in under budget: **1,400 requests → 15,246 unique businesses,
  14,981 of them inside Dubai, 0 errors** against a ~2,000-request plan
- Tiles are disjoint in practice, so the strategy costs nothing in duplication
- Adaptive depth spends the extra 150 requests where pages were still
  productive rather than spreading them evenly over pairs that were finished
- One bad tile costs one job, not the run
- A published crawl is reproducible from the committed config, which is the
  only reproducibility available once ADR 0002 forbids shipping the dataset

**Bad:**

- **Tiles are hand-authored per city.** This is the toolkit's one genuinely
  manual step, and it is the step that decides the credit bill. A user who
  invents plausible-looking coordinates gets a bad crawl and no warning that it
  was bad
- **Only Dubai's tiling has ever been verified.** `_template.json` deliberately
  ships documented guidance rather than invented coordinates for a second city,
  which is correct under ADR 0005 but leaves the extension point untested in
  practice
- **`density` and `tier` are judgement calls, not measurements.** Nothing checks
  that a tile marked `dense` is dense, and a wrong label silently over-spends or
  under-collects with no signal either way. `zoom` is unchecked in the same way:
  the template recommends 15/14/13 by density, and Dubai ships 8 of its 18
  `medium` tiles at zoom 15 and 6 of its 11 `sparse` tiles at zoom 14
- **The yield constant is stale.** `plan.ts` still estimates at
  `UNIQUE_PER_REQUEST = 17.5`, derived from ~12% duplication measured _within_ a
  single query stream. Over a full crawl the figure is **10.9**, because
  cross-category overlap dominates and the in-query measurement could not see
  it. The pre-crawl `estimatedUniqueBusinesses` therefore overstates by 38% — it
  printed ~21,875 for Dubai — and has not been corrected. Read the printed
  estimate as an upper bound, not a forecast
- **Tile coverage overlaps even where tile results do not.** A tile centre is a
  point and the engine returns a radius around it, so boundaries are soft. That
  is exactly why area cannot be taken from crawl provenance — 52% of businesses
  sat in a different tile than the query that found them — and needs its own
  decision, recorded in ADR 0011
- **Adding a city is real work before any spend.** Read a `_readme` array, pick
  neighbourhood centres by hand, guess three density labels. That is a genuine
  barrier for the casual user ADR 0002 already made pay for their own key

## Alternatives considered

- **Paginate deeper instead of tiling.** Rejected on the probe: `page=11`
  returns a response with no `local_results` key, so the ceiling is per query
  and pagination cannot reach past it.
- **One query per category for the whole city.** Rejected: 40 queries at ~200
  results is 8,000 before the ~45% cross-category duplicate rate, against 15,246
  businesses actually present.
- **An even grid over the bounding box.** Rejected: business density follows
  neighbourhoods, so a uniform grid buys desert and water at full price.
- **Pre-plan pagination depth in Stage 0.** Rejected: it commits credits to
  pages the page-11 cliff and the duplicate rate say are worthless. Depth is
  decided by `shouldFetchNextPage` after the page has been seen.
- **Crawl every (tile, category) pair regardless of density.** Rejected: that is
  1,760 requests instead of 1,250, and the extra 510 are niche and standard
  categories in sparse tiles — the pairs least likely to return anything.
- **Derive tiles automatically from a population or street-network density
  layer.** Deferred: it adds an offline data dependency to a step that runs once
  per city, and no second city has been crawled yet to justify it.
- **A cross-tile dedup pass.** Not needed: measured overlap between Downtown and
  Deira was 0, and `runCrawl` already dedupes globally by `place_id` for the
  cross-category case, which is the one that actually bites.
