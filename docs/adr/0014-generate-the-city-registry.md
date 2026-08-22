# ADR 0014 — Generate the city registry from OpenStreetMap, and mark every unverified config as unverified

- **Status:** Proposed — see "Why this is Proposed and not Accepted" below
- **Date:** 2026-08-22

## Context

[ADR 0005](./0005-toolkit-not-directory.md) made a city data rather than code:
`data/cities/<id>.json` carries the tiles, the bounding boxes, the categories,
the country code and the phone region, and nothing downstream hard-codes a city.
It then listed the cost of that promise in its own Bad section:

> Only one city config is verified. Coordinates for a city we have not crawled
> would be guesswork, and this repository is publication material, so a
> documented template ships instead of invented data.

That position leaves a toolkit with one city in it, which reads to anyone
arriving at the repository as a Dubai directory with extra steps. So the
question was put directly: **can this cover every city in the world?**

It has two different answers, and conflating them is the whole problem.

### As a dataset, no, and the numbers are not close

The v0.1 Dubai crawl cost **1,400 requests** and returned 15,246 unique
businesses, 14,981 of them in the city (`data/cities/dubai.json`). At one credit
per request against the **100,000 credit budget** recorded in `CLAUDE.md`, the
whole budget buys roughly seventy cities. Ten thousand — a round number, and the
order of magnitude is the point — is 14 million credits, **140× over**.

Two accepted decisions independently forbid it anyway.
[ADR 0002](./0002-do-not-redistribute-the-dataset.md) does not permit publishing
the records. [ADR 0009](./0009-bundle-the-dataset-into-the-lambda.md) puts
13.5 MB of one city inside a 250 MB Lambda, so the reference deployment runs out
of room somewhere near eighteen cities and does so as a deploy-time surprise.

### As configuration, yes, and for free

A city config is tiles, bounding boxes, categories, country code and phone
region. **None of that is Google's data.** All of it is derivable from
OpenStreetMap and GeoNames, which are openly licensed. Nobody spends a credit
until they crawl their own city with their own key — which is the behaviour
ADR 0005 was written to produce, and the behaviour the ambassador programme
measures, since a config nobody has crawled is an invitation that cannot be
accepted without a SearchApi account.

### What made the gap urgent rather than theoretical

`loadCity` ended `JSON.parse(raw) as CityConfig`. That cast was harmless while
one hand-written file existed and becomes a hazard the moment configs arrive in
bulk, because most of the ways a config can be wrong do not announce themselves.
The worst is a one-letter density typo: `PAGE_CAP[tile.density]` misses,
`maxPages` falls to 0, and `buildCrawlPlan` skips the tile **in silence**. One
bad tile in forty-four costs a neighbourhood of coverage and prints nothing. A
wrong `countryCode` or an inverted bounding box is worse — `isInCity` then
rejects every record, and the crawl yields an empty directory indistinguishable
from a crawl that honestly found nothing.

That is the class [ADR 0007](./0007-enforce-the-takedown-promise.md) legislated
against: a mechanism that quietly does nothing is worse than no mechanism, because
its presence implies a guarantee.

### And a defect the question itself exposed

`packages/pipeline/src/searchapi.ts` sets `gl` — Google's country-of-search
parameter — to the literal string `"ae"` on **every request for every city**.
`packages/pipeline/src/cli/demand.ts` had already got this right, deriving it
from `city.countryCode.toLowerCase()`, so the repository held both the bug and
its fix at the same time for the whole v0.1 period.

Nothing could have caught it. Only one city existed, and for that city the
constant was correct. It is precisely the shape of defect a registry of a hundred
cities surfaces and a registry of one conceals — and it is not cosmetic, because
a Lisbon crawl would have spent real credits asking Google for UAE-localised
results.

## Decision

**Ship a generator for every city on earth, plus a small seed registry. Breadth
comes from the generator, not from the registry. Every config records where it
came from, and absence of that record means unverified — never verified.**

### Coverage is a capability, not a directory listing

The registry is **not** the coverage claim. `pnpm cities generate --name "Lisbon"`
is. The committed configs are a **test suite for the generator**, chosen for
failure-mode coverage rather than for traffic: RTL scripts, CJK, Cyrillic,
Latin-American address formats, shared dialling codes, multi-polygon and exclave
cities, and at least one city where OSM is known to be thin so the fail-loud path
is exercised rather than assumed.

Committing ten thousand generated configs was considered and rejected — see
Alternatives.

### A country is a field, not a config type

Tiling exists because the Maps engine caps a single query at ~200 results
([ADR 0001](./0001-tile-the-crawl.md)), so the crawl unit has to be
neighbourhood-scale. A country-level config would be either a bag of cities,
which the city registry already is, or a bounding box that plans nothing useful.

What a country actually contributes is two fields the config already carries —
`countryCode` and `phoneRegion` — plus the localisation of category terms.
`gl` is therefore derived from `countryCode` at request time, and the hard-coded
`"ae"` in `buildSearchUrl` is removed — written in the present tense as this
directory's format requires, and not yet true in the code. `hl` stays `"en"`;
see Bad.

### Provenance carries evidence, not a boolean

```jsonc
// generated — the honest default
"verification": {
  "status": "generated",
  "source": "openstreetmap",
  "generatedAt": "2026-09-01",
  "generator": "0.1.0"
}

// verified — someone spent credits and reported what they measured
"verification": {
  "status": "verified",
  "crawledAt": "2026-08-20",
  "requests": 1400,
  "uniqueBusinesses": 15246,
  "inCity": 14981
}
```

A bare `verified: true` invites someone to flip it. These numbers are checkable
by re-running the crawl, and producing a false one costs a real crawl.

`verification` is **optional** in `CityConfig`, because a fork must still be able
to drop in a minimal JSON file — that is ADR 0005's core promise and it outranks
compile-time provenance. But `verificationState()` resolves absence to
`"unknown"`, never to `"verified"`, on the same asymmetric-cost reasoning
`dropSuppressed` uses for a record with no `place_id`: when information is
missing, the cautious answer wins.

`generator` is a version rather than a name, so a bad batch is traceable to the
code that emitted it.

### `parseCityConfig` throws

In `packages/core/src/city.ts`, modelled on `parseSuppressionList`. It rejects
rather than returning a partial config, because a half-valid city and a valid
city look identical from the outside and only one of them is safe — and here the
tell arrives after the credits are gone.

Two deliberate non-checks, both cases where rejecting is worse than accepting:
`cityNames` case is not validated (`isInCity` lowercases both sides, so a
validator refusing `"Lisbon"` would reject a config that demonstrably works), and
an empty `boundingBoxes` list is legal (`isInCity` treats boxes as a sanity check
and returns `true` when there are none). Cross-checking `countryCode` against
tile coordinates is a **warning, not an error**, so a border-straddling city stays
crawlable by someone who knows better than the validator.

### The budget is fitted at plan time, not truncated at run time

Dubai's own hand-tuned config plans 3,170 worst-case requests against a 2,000
budget. Today the fetcher absorbs the overshoot with a hard cap, which means
_which_ tiles lose their coverage is decided by iteration order while the crawl is
running — nobody chose it, and nothing reports it.

`fitToBudget` in `packages/pipeline/src/plan.ts` decides instead, admitting tiles
**density-descending**. Measured against Dubai's real 44 tiles and 40 categories:

| budget | kept                                      | dropped      | worst case |
| ------ | ----------------------------------------- | ------------ | ---------- |
| 2,000  | 23 — **all 15 dense**, 2 medium, 6 sparse | 21 (0 dense) | 2,000      |
| 1,250  | 15 — 10 dense, 0 medium, 5 sparse         | 29 (5 dense) | 1,250      |

Density-descending was earned rather than assumed: the first implementation
admitted tiles in file order, and measuring it showed a 1,250 budget dropping
**five dense tiles** while funding medium ones that happened to be listed
earlier. Output is restored to the caller's original order, because selection is a
cost decision while the result is a file a human has to read.

This turns hard rule 4 — never widen a crawl without saying what it costs — from
a discipline someone has to remember into a property of the code.

### The generator fails loud

Where OSM yields too few candidate centres, the generator prints what went wrong
and exits non-zero. It never falls back to an even grid. A generated grid would be
the "invented data" ADR 0005 refused to ship, wearing a generator's credibility —
and an even grid also wastes requests on water, desert and airports, which is the
thing `data/cities/_template.json` warns about in as many words.

Every generated config is run through `parseCityConfig` before it is written, so
the generator cannot emit something the loader would reject.

### Why this is Proposed and not Accepted

**Nothing has yet generated a city from OpenStreetMap.** What exists is the pure,
offline half: `distanceKm`, `classifyDensity`, `spaceOut` and `SPACING_FLOORS` in
`packages/core/src/tiles.ts`, `fitToBudget` in `packages/pipeline/src/plan.ts`,
and `parseCityConfig` plus the `verification` field wired through `loadCity` and
`pnpm plan --list`. The network half — Nominatim, Overpass, and the `fixtures/osm/`
recordings that would make it testable offline — is **not started**, and
`fixtures/osm/` does not exist. The design document sequencing this work marks
that step **PART DONE** in its own words.

The two numbers this decision rests on are therefore still guesses, and one of
them is named for it. `PROVISIONAL_DENSITY_THRESHOLDS` is called provisional so
it cannot be quoted as measured; turning it into a measurement means counting
POIs around each of Dubai's 44 hand-placed tiles and fitting the thresholds that
best reproduce its known 15 / 18 / 11 split. Density drives `PAGE_CAP`, which is
the credit bill, so accepting this decision before that pass has run would put a
guess inside a number the README publishes — which is the specific failure the
Bad list below warns about.

**Accepted comes after the validation gate, not before it.** That gate is three
published numbers: tile recall (fraction of the 44 hand-placed tiles with a
generated tile within 1 km), density agreement (a confusion matrix against the
known 15 / 18 / 11 split), and cost delta (generated `maxRequests` against the
hand-tuned 3,170). If auto-tiles cost materially more credits for the same
coverage, that number goes in the README rather than being tuned away. Until
those three exist, this document records an argued direction and a half-built
mechanism, and saying "Accepted" would claim more than the code delivers.

## Consequences

**Good:**

- **Coverage stops being bounded by the credit budget.** Adding a city costs zero
  credits, because a config is not data. The 100,000-credit budget now constrains
  only how many cities get _verified_, which is the thing it should have
  constrained all along.
- **Every generated config is a lead.** An unverified config is an invitation with
  a defined shape: crawl it, open a PR flipping `status` and attaching measured
  `requests` / `uniqueBusinesses` / `inCity`. Every such PR required a SearchApi
  key, so the contribution and the conversion are the same event — which is the
  metric ADR 0005 was already optimising for.
- **The registry is reviewable.** One file of generator logic is auditable in a
  way ten thousand config files are not.
- **`parseCityConfig` closes a silent-failure hole that existed independently of
  any of this.** A density typo now names the file, the field and the value
  instead of dropping a tile in silence.
- **A city's real cost is stated before it is spent**, by construction rather than
  by discipline.
- **The `gl` defect gets fixed as a consequence**, and the repository would stop
  paying for UAE-localised results in cities that are not in the UAE. Stated in
  the conditional deliberately: as of this document `packages/pipeline/src/searchapi.ts:18`
  still reads `url.searchParams.set("gl", "ae")`, and it is listed here as
  something this decision causes rather than something it has already done.

**Bad:**

- **This is a genuine retreat from ADR 0005's position.** That document said a
  documented template ships _instead of_ invented data. A generated config is
  derived from a cited open source rather than invented, and it says so on every
  record — but the repository now ships coordinates for cities nobody has
  crawled, and calling that anything other than a softening would be dishonest.
  This ADR exists so the change is recorded rather than quietly reinterpreted.
- **`verification` is a trust claim with no cryptographic backing whatsoever.**
  Anyone can write `status: "verified"` with plausible numbers.
  `parseCityConfig` checks that the evidence is _coherent_ — it rejects
  `inCity > uniqueBusinesses` — but coherence is not truth. The defence is
  social: a wrong claim is checkable by re-running the crawl, and making one
  costs a real crawl. That is weaker than it sounds and is the honest boundary of
  what the field means.
- **OSM `place=*` coverage is uneven, and unevenly in a way that matters.** It is
  excellent in Western Europe, good across most of Asia and Latin America, and
  thin in parts of the Gulf and sub-Saharan Africa. The generator fails loudly
  there rather than inventing a grid, which is the right failure — but it means
  registry coverage will mirror OSM's own mapping inequality. A toolkit whose
  worldwide claim is strongest exactly where the world is already best served is
  a thing to say out loud, not to discover in a bug report.
- **`PROVISIONAL_DENSITY_THRESHOLDS` are still two invented numbers.** `dense: 150`
  and `medium: 40` in `packages/core/src/tiles.ts` are placeholders, named so they
  cannot be quoted as measured. Density drives `PAGE_CAP`, which is the credit
  bill, so until the Overpass calibration pass runs, every generated config's cost
  profile rests on a guess. Shipping the generator before that measurement would
  put a guess inside a number the README publishes.
- **Categories are English-language search terms.** `data/category-map.json` maps
  an OSM tag to a Google query string, and a Lisbon crawl will ask for
  "bakeries" rather than "padarias". `hl=en` stays hard-coded for the same reason.
  The size of that loss is unmeasured; it is a known limitation, not a solved
  problem.
- **Regenerating a city rewrites its indexed URLs.** [ADR 0011](./0011-area-from-coordinates-not-provenance.md)
  records that a tile is simultaneously a query point and a browse facet, so tile
  ids are `/area/` URLs submitted in `sitemap.ts`. A generator that improves a
  city's tiling silently breaks every one of them, and there is no redirect
  mechanism. The generator makes an existing trap much easier to spring.
- **The reference deployment does not get any wider.** ADR 0009 bundles a single
  `DIRECTORY_CITY` at build time. A registry of a thousand cities and a site
  serving one is the state this leaves behind until Milestone 2 replaces the
  bundle with DynamoDB.
- **The registry must not become the Milestone 3 SEO surface.** Programmatic pages
  for cities nobody has crawled would be thin content wearing a generator's
  credibility, and would recreate the ADR 0005 problem in the one place it is
  most visible. Nothing in the code currently prevents it.

## Alternatives considered

- **Crawl every city and ship the dataset.** Rejected on arithmetic and on two
  ADRs: 140× the credit budget, forbidden to publish by ADR 0002, and structurally
  capped near eighteen cities by ADR 0009's bundling.
- **Commit a generated config for every city on earth.** Rejected. At Dubai's
  10,284 bytes, ten thousand configs is on the order of 100 MB against a
  repository that measures **1.31 MB across 162 tracked files** today. Nobody can
  review it, and given the OSM coverage gap above, a systematic slice of it would
  be quietly wrong — in a repository whose stated purpose is publication. Breadth
  belongs in the generator, where it is one auditable artefact.
- **Country-level configs instead of city-level.** Rejected: the ~200-result
  ceiling forces a neighbourhood-scale crawl unit, so a country config is either a
  bag of cities or a box that plans nothing. What a country genuinely contributes
  is already two fields on the city config.
- **A generator with no seed registry at all.** Rejected: nothing would exercise
  the generator against the world's variety of scripts, dialling plans and
  geometries, and a toolkit shipping one city still reads as a Dubai directory.
  The seed tier is a test suite, and it is sized like one.
- **Keep hand-writing configs.** Rejected. It does not scale past a handful, and
  ADR 0005's "guesswork" objection applies at least as strongly to a human
  guessing Lisbon's neighbourhoods from a map as to a generator reading
  locally-placed OSM nodes.
- **GeoNames rather than OSM for tile centres.** Rejected as the primary source:
  GeoNames populated places are points carrying population, and the thing that
  drives tile placement and `PAGE_CAP` is _business_ density, which needs POI
  counts. Those come from Overpass. GeoNames remains useful for name resolution
  and is not ruled out as a secondary source.
- **Publish generated configs as Milestone 3 pages to prove coverage.** Rejected,
  and recorded in Bad above rather than left as an open option, because it is the
  tempting mistake this decision creates.

## A note on the number

This document was drafted as **ADR 0012** in
`docs/superpowers/specs/2026-08-22-global-city-registry-design.md` and renumbered
on discovering that 0012 is already spoken for: ADR 0008 cites it for the reviews
stage's deliberate refusal to archive raw responses, and the note in
[README.md](./README.md) reserved it until that document was written.
Lead-generation scoring was renumbered 0012 → 0013 for the same reason two days
earlier. That is twice now, which suggests the note is load-bearing and should
stay at the top of the numbering section rather than being folded into the table.

The reservation has since been discharged:
[ADR 0012](./0012-do-not-archive-raw-review-responses.md) was written on
2026-08-22 and dated to the day its decision was taken, so ADR 0008's citation
now resolves to a document instead of to a promise.
