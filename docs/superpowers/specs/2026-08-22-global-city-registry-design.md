# Global city registry — design

- **Date:** 2026-08-22
- **Status:** Sections 1 and 2 signed off in brainstorming; 3–5 written up here.
  **Steps 1 and 2 are implemented and green, and step 3's pure selection logic
  is done** (395 tests, typecheck, lint, prettier). What remains of step 3 is
  the network half: fetching candidates from Nominatim and Overpass, and the
  `fixtures/osm/` recordings that make it testable offline.
- **Milestone:** Its own. Not v0.1, not v0.2.
- **Needs an ADR:** written — [ADR 0014](../../adr/0014-generate-the-city-registry.md), 2026-08-22

## The question this answers

"Can the directory cover every city in the world?"

Answered as a **dataset**, no: at the measured 1,400 requests per city and one
credit per request, ten thousand cities is 14M credits against a 100k budget —
140× over — and publishing the result is the exact redistribution
`docs/adr/0002-do-not-redistribute-the-dataset.md` exists to forbid. The
architecture agrees: `docs/adr/0009-bundle-the-dataset-into-the-lambda.md` puts
13.5MB of one city inside a 250MB Lambda, so the current design stops at roughly
eighteen cities and does so as a deploy-time surprise.

Answered as **configuration**, yes, and for free. A city config is tiles,
bounding boxes, categories, country code and phone region. None of that is
Google's data. All of it is derivable from OpenStreetMap and GeoNames, which are
openly licensed. Nobody spends a credit until they crawl their own city with
their own key — which is the behaviour
`docs/adr/0005-toolkit-not-directory.md` was written to produce, and the
behaviour the ambassador programme actually measures.

**So: ship a generator for every city on earth, plus a small seed registry.**

## 1. Tile generation

### Command

```bash
pnpm cities generate --name "Lisbon" --budget 2000
```

Free. Touches OpenStreetMap and nothing else. New CLI at
`packages/pipeline/src/cli/cities.ts`; the pure logic lives in `packages/core`
and is TDD'd, per the hard rule.

**No new dependency.** Node 24 has global `fetch`. `libphonenumber-js` is
already present and already knows the `countryCode` → dialling-region mapping.

### Six stages

1. **Resolve** — Nominatim turns a name into an OSM administrative relation,
   giving `name`, `countryCode`, alternate names, and a boundary.
   `phoneRegion` is derived from `countryCode`.
2. **Bounding boxes** — the boundary polygon becomes one or more boxes. A
   multi-polygon city yields several, which is the shape Dubai's detached Hatta
   box already has.
3. **Candidate centres** — Overpass, `place=suburb|quarter|neighbourhood` nodes
   inside the boundary. These are locally-named points placed by people who
   live there, which is what `data/cities/_template.json` demands: _"Use real
   neighbourhood centres, not an even grid: business density follows
   neighbourhoods, and an even grid wastes requests on water, desert, and
   airports."_
4. **Density measurement** — one Overpass count per candidate: `shop` +
   `amenity` + `office` within a fixed radius. This is a direct, free proxy for
   exactly what the `density` field predicts.
5. **Spacing** — a density-dependent minimum separation, applied greedily by
   POI count descending, so the busiest centre in a cluster survives.
6. **Fit to budget** — admit tiles in descending density while
   `buildCrawlPlan(...).estimate.maxRequests` stays under `--budget`.

### Stage 6 is the part that matters

Dubai's hand-tuned config does not fit its own budget. `pnpm plan --city dubai`:

```text
Tiles       44  (dense 15, medium 18, sparse 11)
Categories  40  (broad 10, standard 20, niche 10)
Requests    up front 1,250 · worst case 3,170 · planned budget 2,000
⚠  Worst case exceeds the 2,000 budget by 1,170 requests.
```

The fetcher absorbs the overshoot with a hard cap. That means **which** tiles
get dropped is decided by iteration order at run time — nobody chose it. Fitting
to budget at plan time makes the choice deliberate: shed the sparsest tiles and
keep the dense ones. It converts hard rule 4 — _never widen a crawl without
saying what it costs_ — from a discipline into a property of the generator.

This is a behaviour change from today and it is intentional.

**Implemented and measured.** `fitToBudget` in `packages/pipeline/src/plan.ts`,
against Dubai's real 44 tiles and 40 categories:

| budget | kept                                   | dropped      | worst case |
| ------ | -------------------------------------- | ------------ | ---------- |
| 2,000  | 23 — **all 15 dense**, 2 med, 6 sparse | 21 (0 dense) | 2,000      |
| 1,250  | 15 — 10 dense, 0 med, 5 sparse         | 29 (5 dense) | 1,250      |

Selection runs **density-descending, not file order**, and that distinction was
earned rather than assumed: the first implementation admitted tiles in file
order, and measuring it showed a 1,250 budget dropping **five dense tiles**
while funding medium ones that happened to be listed earlier. Output is
restored to the caller's original order, because selection is a cost decision
while the result is a config file a human has to read.

### Calibration ground truth

Dubai's 44 hand-placed tiles are labelled data. Nearest-neighbour spacing,
computed from `data/cities/dubai.json`:

| density | n   | min     | median  | max      |
| ------- | --- | ------- | ------- | -------- |
| dense   | 15  | 0.78 km | 1.30 km | 4.19 km  |
| medium  | 18  | 0.61 km | 2.58 km | 4.53 km  |
| sparse  | 11  | 2.04 km | 5.90 km | 78.10 km |

Dense areas legitimately pack tight — `difc` and `sheikh-zayed-road` are 0.78 km
apart and both were kept. The 78 km sparse outlier is Hatta, the exclave.

**Implemented as `SPACING_FLOORS` in `packages/core/src/tiles.ts`:** dense 0.5,
medium 0.5, sparse 1.5 km. Each sits below the measured minimum for its class,
so applying the rule to Dubai's own tiles drops none of them — asserted
directly against all 44 in `plan.test.ts`.

**Spacing is not monotonic with density, and the generator must not pretend it
is.** The tightest pair in the entire city is `media-city ↔ internet-city` at
**0.61 km, both labelled `medium`** — tighter than any dense pair. Human
judgement preserved two distinct named business districts that a monotonic rule
would have merged. Separation is therefore a floor per density class, never a
target, and disagreement with the hand labels gets **reported rather than tuned
away**.

### The validation gate

Before this ships: regenerate Dubai from OSM and diff against the hand-tuned
config. Three numbers, all published:

- **Tile recall** — fraction of the 44 hand-placed tiles with a generated tile
  within 1 km
- **Density agreement** — confusion matrix against the known 15 / 18 / 11 split
- **Cost delta** — generated `maxRequests` against the hand-tuned 3,170

If auto-tiles cost materially more credits for the same coverage, that number
goes in the README. It is the honest form of the claim, and it is the article.

### Known failure mode

OSM `place=*` node coverage is excellent in Western Europe, good in most of
Asia and Latin America, and thin in parts of the Gulf and sub-Saharan Africa.
Where candidates are too few, the generator **fails loudly** rather than
falling back to a grid — a generated grid config would be the "invented data"
ADR 0005 refused to ship, wearing a generator's credibility.

## 2. Registry shape and validation

### Flat, in `data/cities/`

No subdirectory. `loadCity` and `availableCities` keep working unchanged, and
"a city is data, not code" stays literally true: a generated Lisbon config and
a hand-written one are the same kind of object in the same place. Provenance is
a field, not a file path. At ~10 KB each, 100 configs is ~1 MB against a 2.6 MB
repo.

### Provenance as evidence

A bare `"verified": true` invites someone to flip it. The config carries what
was measured instead:

```jsonc
// generated — the honest default
"verification": {
  "status": "generated",
  "source": "openstreetmap",
  "generatedAt": "2026-09-01",
  "generator": "0.1.0"
}

// verified — someone spent credits and reported the result
"verification": {
  "status": "verified",
  "crawledAt": "2026-08-20",
  "requests": 1400,
  "uniqueBusinesses": 15246,
  "inCity": 14981
}
```

`verification` is **optional in the `CityConfig` type** — a fork must still be
able to drop in a minimal JSON file, which is ADR 0005's core promise — but
**absent means unverified**, never verified. That is the same safe-default
reasoning `dropSuppressed` already uses when a record has no `place_id`:
missing information resolves toward the cautious outcome.

What this is worth, stated plainly: these numbers are a trust-based claim with
evidence attached, like a submitted benchmark. Nothing verifies them
cryptographically. The value is that a wrong claim is _checkable_ by re-running
the crawl, and that making one costs a real crawl.

### The validation gap is real and specific

`loadCity` currently ends:

```ts
return JSON.parse(raw) as CityConfig;
```

That `as` is unchecked. Tracing a malformed config through
`packages/pipeline/src/plan.ts`:

```ts
const maxPages = PAGE_CAP[tile.density]?.[category.tier] ?? 0;
if (maxPages < 1) continue;
```

A tile with `"density": "Dense"` — one capital letter — misses `PAGE_CAP`,
yields `0`, and is **skipped with no message**. If every tile is wrong the
request count collapses to zero and someone notices. If **one tile in
forty-four** is wrong, roughly 28 requests and a neighbourhood of coverage
vanish and nothing says so.

| Bad input               | What happens today                                |
| ----------------------- | ------------------------------------------------- |
| `density` / `tier` typo | tile or category silently contributes nothing     |
| `minLat > maxLat`       | `isInCity` rejects every record → empty directory |
| wrong `countryCode`     | `isInCity` rejects every record → empty directory |
| bad `phoneRegion`       | fails at normalise, far from the cause            |
| missing `tiles`         | `TypeError: tiles is not iterable`                |

Three of five produce a plausible-looking run that is quietly wrong. That is
the class `docs/adr/0007-enforce-the-takedown-promise.md` legislated against:
_"A suppression list that quietly does nothing is worse than no list at all,
because a list implies a guarantee."_

### `parseCityConfig`

New in `packages/core/src/city.ts`, modelled directly on
`parseSuppressionList`. It **throws** rather than returning a partial config,
because a half-valid city and a valid city look identical until the credits are
gone. `loadCity` calls it instead of casting.

Checks: enum membership for `density` and `tier`; coordinates inside the WGS84
range; non-degenerate, correctly ordered bounding boxes; `zoom` an integer in
0–21; `phoneRegion` a real `CountryCode`, checked against libphonenumber itself
rather than a regex; `countryCode` a plausible ISO-3166 alpha-2; `cityNames`
non-empty; tile ids and category queries unique within the file; `tiles` and
`categories` present and non-empty.

Errors name the file, the field, and the offending value — `loadCity`'s
existing catch block already sets that tone (_"a wrong id must teach rather
than dump a stack trace"_).

**Two deliberate non-checks**, both cases where rejecting would be worse than
accepting:

- **`cityNames` case is not validated.** An earlier draft of this spec required
  lowercase. `isInCity` already lowercases both sides of the comparison, so
  `"Lisbon"` works exactly as well as `"lisbon"` — and a validator that rejects
  a config which demonstrably works is user-hostile. Consistency in the registry
  is the generator's job, not the parser's.
- **An empty `boundingBoxes` list is legal.** `isInCity` explicitly returns
  `true` when there are no boxes, treating them as a sanity check rather than a
  filter. That is a supported state, not a broken config.

**One deliberate asymmetry:** cross-checking `countryCode` against tile
coordinates is a **warning, not an error**. A city straddling a border, or a
config the generator got slightly wrong, must stay crawlable by someone who
knows better than the validator.

### What structure cannot catch

A config can pass every check above and still plan **zero jobs**: `PAGE_CAP`
gives sparse tiles zero pages for `standard` and `niche` categories, so an
all-sparse city with no `broad` categories yields an empty plan. It spends no
credits, finds no businesses, and looks like a working config until the crawl
finishes empty. That is a property of the _plan_, not the _shape_, so it is
asserted in `packages/pipeline/src/plan.test.ts` across every committed config
rather than inside `parseCityConfig`.

### The verification loop is the contribution path

An unverified config is an invitation with a defined shape: crawl it, open a PR
flipping `status` and attaching measured `requests` / `uniqueBusinesses` /
`inCity`. Every such PR required a SearchApi key, so the contribution and the
conversion are the same event. `CONTRIBUTING.md` gets this as a named workflow.

### `pnpm plan --list` at a hundred cities

Verified cities listed in full, then a one-line count of generated ones.
`--all` shows everything; `--verified` filters. Behaviour for a one-city repo
is unchanged.

## 3. Categories

### Dubai's 40 do not all generalise

Most are universal — restaurants, pharmacies, dentists, banks, bakeries. Some
are strongly regional: **`exchange houses`** is a remittance-economy category
that matters enormously in the UAE and barely exists in Manchester.
**`laundry`** and **`tailors`** are standalone high-street businesses across the
Gulf and South Asia and largely absent as search categories in Northern Europe.

Shipping Dubai's list to every city would waste credits on empty queries and
miss whatever the local equivalent is.

### Measure categories from the same free OSM pass

The Overpass data already fetched for tile density also describes what kinds of
business a city actually contains. If a city has 300 `amenity=bureau_de_change`
nodes, `exchange houses` earns a slot; if it has two, it does not.

This makes categories **measured rather than guessed**, from data already in
hand, at no extra cost. Tier assignment follows the same counts — top decile
`broad`, middle `standard`, tail `niche` — which is what the tiers already mean:
how likely an area is to hold 100+ of that kind.

### `data/category-map.json`

The one hand-maintained artefact: OSM tag → Google search term.

```jsonc
{
  "amenity=bureau_de_change": "exchange houses",
  "shop=laundry": "laundry",
  "shop=tailor": "tailors",
  "amenity=pharmacy": "pharmacies",
}
```

Finite — 60 to 80 entries covers the long tail of real business categories — and
the same shape as the existing `data/taxonomy-map.json`, so it inherits a
pattern the repo already has, including community PRs correcting it. It is
owned by the `taxonomy-curator` agent.

**Caveat:** the mapping is English-language search terms. A non-English city may
be better served by local-language queries, and this design does not solve that.
It is noted as a limitation rather than hidden.

## 4. CLI, data flow, error handling, testing

### Commands

```bash
pnpm cities generate --name "Lisbon" --budget 2000   # write data/cities/lisbon.json
pnpm cities validate                                  # validate every config in the repo
pnpm cities calibrate --against dubai                 # the validation gate of section 1
```

### Data flow

```text
Nominatim  ──▶ boundary, countryCode, names ──▶ boundingBoxes, phoneRegion
Overpass   ──▶ place=* nodes                 ──▶ candidate tile centres
Overpass   ──▶ POI counts per candidate      ──▶ density, spacing, budget fit
Overpass   ──▶ POI counts per tag, city-wide ──▶ categories + tiers
                                             ──▶ parseCityConfig ──▶ data/cities/<id>.json
```

### Politeness and caching

Nominatim requires ≤1 request/second and a real `User-Agent`. Overpass is
aggressively rate-limited and generating a hundred cities must not abuse a free
public service. Responses are cached under `data/osm-cache/`, git-ignored
alongside `data/raw/` and `data/out/`, so a re-run or a threshold retune costs
no upstream requests.

### Error handling: fail loud

ADR 0009's lesson applies directly — _"a warning in a CI log is how an empty
directory reaches a live domain."_ If Nominatim cannot resolve the city, if the
boundary is missing, or if too few candidate centres come back, the generator
prints what went wrong and exits non-zero. It never writes a degenerate config.
Every generated config is run through `parseCityConfig` before being written, so
the generator cannot emit something the loader would reject.

### Testing

- Recorded Nominatim and Overpass responses in `fixtures/osm/`, mirroring
  `fixtures/searchapi/`. Fully offline. Overpass costs no credits, but a test
  that makes a network call is still a broken test — the rule is about
  determinism as much as money.
- `parseCityConfig` gets a test per rejection case. Pure, offline, free.
- A repo invariant test runs the validator across **every** config in
  `data/cities/`, so a bad generated config fails CI rather than a user's crawl.

## 5. Scope and sequencing

**Seed registry: 50–100 cities, chosen for failure-mode coverage, not traffic.**
RTL scripts, CJK, Cyrillic, Latin-American address formats, unusual phone
regions, multi-polygon and exclave cities. The point of the seed tier is to
prove the generator survives the world's variety, not to rank for anything.

Sequencing, smallest risk first:

1. **DONE** — `parseCityConfig` + `loadCity` wiring + repo invariant test. Pure, offline,
   valuable on its own — it closes a real silent-failure hole in today's code
   whether or not the rest ships.
2. **DONE** — `verification` field, type change, `--list` grouping.
   `data/cities/dubai.json` now carries its real v0.1 numbers: 1,400 requests,
   15,246 unique, 14,981 in city, crawled 2026-08-20.
3. **PART DONE** — Tile generation. The pure half is implemented and tested in
   `packages/core/src/tiles.ts`: `distanceKm`, `classifyDensity`, `spaceOut`,
   `SPACING_FLOORS`, plus `fitToBudget` in the pipeline. The network half —
   Nominatim, Overpass, and `fixtures/osm/` — is **not started**.
   `PROVISIONAL_DENSITY_THRESHOLDS` is named that way because it is a guess:
   turning it into a measurement needs the Overpass pass that has not run.
4. The Dubai calibration gate. **Publish the three numbers before going wider.**
5. Category derivation and `data/category-map.json`.
6. Seed registry generation, reviewed city by city.

Step 1 is independently shippable and is where implementation started.

**Step 3 is the first thing here that touches the network.** Recording
Nominatim and Overpass fixtures into `fixtures/osm/` needs real requests to
capture (no credits, but real calls), and that directory does not exist yet.
That is the natural checkpoint for a human to look before going further.

## What this contradicts

ADR 0005 says: _"Coordinates for a city we have not crawled would be guesswork,
and this repository is publication material, so a documented template ships
instead of invented data."_

A generated registry is not guesswork — it is derived from a cited open source,
and the `verification` field says so on every record. But it is **unverified**,
and that is a genuine softening of the position ADR 0005 took. It needs its own
ADR saying so out loud rather than being quietly reinterpreted.

**Written as [ADR 0014](../../adr/0014-generate-the-city-registry.md) — Generate
the city registry from OpenStreetMap, and mark every unverified config as
unverified.**

Drafted here as "ADR 0012" and renumbered on discovering that 0012 carries a
standing claim from ADR 0008 — see the numbering note in
[docs/adr/README.md](../../adr/README.md). Lead-generation scoring had been
renumbered 0012 → 0013 for the same reason two days earlier.
