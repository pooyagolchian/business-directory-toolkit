# ADR 0011 — Assign a business to an area by its coordinates, not by the query that found it

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The crawl is tiled: each `data/cities/<id>.json` tile is a lat/lng point that a
set of category queries is fired at. Dubai has 44 of them. The first
implementation carried the tile that produced a result through the pipeline and
used it as the business's neighbourhood — `_source.tileId` in, `area` out. It
was free, it required no extra field, and it looked obviously correct.

It is not correct, because a tile is a **query point, not a boundary**. Google
returns results from a radius around the point it is given, and that radius does
not stop where the next tile begins. A query centred on DIFC returns hotels in
Jumeirah. The listing that made this visible was **"Rove La Mer Beach,
Jumeirah"** — a hotel with the neighbourhood in its own name — rendered on the
DIFC browse page.

Two things made the defect easy to miss.

**Nothing looked broken.** Area is not displayed as a claim about provenance; it
is the `<h1>`, the breadcrumb, the canonical URL and the GSI2 partition key of
every browse page. A page with the wrong businesses on it renders exactly as
well as a page with the right ones. No test failed, and no unit test could have
failed, because the inputs were internally consistent — the pipeline faithfully
recorded which query had found what.

**The one measurement that existed was misread.** `data/cities/dubai.json`
records zero measured overlap between the Downtown and Deira tiles, and that was
taken as evidence that tiles partition cleanly. It is not evidence of that. Zero
overlap means the two queries returned no business in common; it says nothing
about whether a business returned by one query is nearer the other's centre.
Both facts are true at once, and only the second one bears on filing.

When the app was first run against real crawl output, **58% of businesses**
(4,176 of 7,245, commit `11f10e6`) sat in a different tile than the query that
found them. Re-measured over the completed v0.1 crawl the figure settled at
**52%**. The earlier number was not wrong so much as partial — it was taken
mid-crawl, when the dense central tiles that sit within a few kilometres of one
another were over-represented and the sparse outer tiles had barely run. The
direction was right; the magnitude moved six points once the whole city was in.

Either way, the majority of the SEO surface was being built on a field that was
wrong more often than it was right.

## Decision

**A business is assigned to the tile whose centre it is geographically closest
to. Provenance is a fallback, not an input.**

The resolution order in `packages/pipeline/src/cli/load.ts` is a strict
ordering, not a blend:

```ts
const geographic = gps
  ? nearestTile(gps.latitude, gps.longitude, city.tiles)
  : null;
const area = geographic ?? provenance ?? city.id;
```

Coordinates decide. A listing with no `gps_coordinates` falls back to the tile
that found it. A city with no tiles at all falls back to the city id, so the
field is never empty.

`nearestTile(lat, lng, tiles)` lives in `packages/core/src/nearest.ts` — pure,
no I/O, TDD'd — and makes three deliberate choices:

- **Equirectangular approximation, not haversine.** At city scale the error is
  metres. The cost difference is not: haversine is six trigonometric operations
  per tile, equirectangular is a single `Math.cos()` for the whole call. Filing
  15,246 businesses against 44 tiles is 670,824 comparisons, so the constant
  factor is the entire runtime.
- **Longitude scaled by `cos(lat)`.** A degree of longitude is roughly 11%
  shorter than a degree of latitude at Dubai's 25°N. Treating a degree as square
  misassigns precisely the businesses sitting between two tiles — which are the
  only businesses this decision exists to get right, since the ones deep inside
  a tile were never in doubt. There is a test for exactly this: two tiles
  equidistant in raw degrees, where the true nearest is the eastern one.
- **Squared distance is compared, never distance.** Ordering is preserved under
  squaring, so there is no `Math.sqrt` in the inner loop.

Ties are broken by config order — the comparison is strictly `<`, so the first
tile listed wins — and there is a test asserting that this is at least stable.

**The reassignment count is printed on every run.** `load.ts` counts the cases
where geography and provenance disagree and the load report prints:

```text
Area reassigned     {n}  (found by one tile's query, actually located in another)
```

That line exists so the 52% stays a number somebody looks at rather than an
assumption that quietly rots. If a future city config produces 5% or 95%, the
operator sees it before the pages ship.

### The consequence for tiling

This is what allows the tiling of ADR 0001 to be **soft-edged**. Tiles only have
to be good enough to _find_ businesses; they do not have to be good enough to
_file_ them, because filing happens afterwards, from coordinates. That removes
the requirement that tile radii tessellate — which was never achievable anyway,
since the radius is Google's and is not disclosed.

### The dual role, which is the thing worth recording

A tile is now two things at once:

1. a **query point** for the crawl, chosen for yield against the ~200-result
   ceiling, and
2. a **browse facet** for the site — `areas()` and `areaLabel()` in
   `packages/web/lib/data.ts` read tile `id` and `name` straight out of the
   committed city config, so `/area/dubai-marina` is a tile id and "Dubai
   Marina" is a tile name.

Those two jobs pull in different directions, and nothing in the codebase
separates them. Editing a city config to improve the crawl silently rewrites
indexed URLs. That is the trap this ADR is really here to document.

## Consequences

**Good:**

- The browse surface is correct. `/area/{area}`, `/area/{area}/{l2}`, the GSI2
  partition `CAT#{l2}#AREA#{area}` and the `/area/` entries in `sitemap.ts` all
  describe where businesses actually are.
- The error is measured and reported on every load, not assumed.
- Tiles can be tuned for crawl efficiency without corrupting the site.
- `nearestTile` is pure and city-agnostic, so it works for any city config
  under ADR 0005 without a line of Dubai in it.
- Fixing it cost zero API credits. The correction was applied by re-running
  `pnpm load --from-archive` over responses already on disk.

**Bad:**

- **Nearest-centre is a Voronoi partition, not a neighbourhood.** A business on
  the far edge of a large sparse tile is assigned to a centre it has nothing to
  do with, and nothing detects or reports that. There is no distance ceiling —
  the nearest tile always wins, however far away it is.
- **Tiles chosen for crawl efficiency make uneven browse facets.** Fifteen dense
  tiles sit within a few kilometres of one another in the centre while Hatta, a
  mountain town roughly 130km east, is one tile. The site presents them as peers
  in the same `/areas` grid.
- **A listing with no GPS falls back to provenance, which is known to be wrong
  52% of the time.** The fallback is knowingly bad and used anyway, because
  dropping the listing entirely would be worse — and there is no third source to
  fall back to.
- **Changing a city's tiles retroactively changes every `/area/` URL for that
  city.** Those URLs are submitted in `sitemap.ts` and end up in Google's index.
  Nothing warns about it and there is no redirect mechanism.
- **Area is derived at load time and baked into the record**, both as
  `business.area` and inside the GSI2 key, so a correction is a reload rather
  than a query change. Under ADR 0009 the site reads a bundled snapshot, so that
  means a full rebuild and redeploy, not a data patch.

## Alternatives considered

- **Keep provenance.** Rejected: wrong for 52% of businesses, and wrong in the
  one field that backs every indexed URL.
- **Blend the two — prefer provenance unless the geographic tile is more than
  _n_ metres closer.** Rejected: _n_ is a number nobody can source, and a
  threshold that cannot be justified is worse than an ordering that can be
  stated in one sentence.
- **Haversine.** Rejected: six trigonometric operations per tile buys accuracy
  measured in metres at a scale where tile centres are kilometres apart.
- **Reverse-geocode every business to a real neighbourhood name.** Rejected: a
  per-business API call for something the coordinates already answer, and the
  project's rule is not to spend credits re-deriving what it already has.
- **Parse the neighbourhood out of the formatted address.** Rejected: free-text,
  frequently bilingual, and with no controlled vocabulary there is nothing to
  join a browse facet to.
- **Real neighbourhood polygons instead of nearest-centre.** Deferred, and it is
  the right long-term answer. It needs a boundary set with an MIT-compatible
  licence, per city, which collides with ADR 0005's premise that a city is one
  committed JSON file.
- **Store both the geographic area and the provenance tile and decide at query
  time.** Rejected for now: `area` is part of the GSI2 partition key, so it must
  be resolved before the write. Worth revisiting if a second area scheme is ever
  needed.
- **Publish the tile-to-business assignment so readers can check it.** Rejected:
  that is the dataset, and ADR 0002 does not permit committing it. The
  reassignment count in the load report is what gets published instead.
