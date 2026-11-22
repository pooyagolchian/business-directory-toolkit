# Adding a city

A city is a JSON file in `data/cities/`; this page covers what goes in it and what still says Dubai when you port the site.

## Add your own city

`data/cities/<id>.json` is the whole extension point. `availableCities()` just
reads the directory and skips `_`-prefixed files, so a new city needs **no code
change anywhere** in the pipeline.

```bash
cp data/cities/_template.json data/cities/manchester.json
$EDITOR data/cities/manchester.json

pnpm plan  --list                       # cities in this repo
pnpm plan  --city manchester            # free: request count and credit cost
pnpm crawl --city manchester --dry-run  # still free
pnpm crawl --city manchester --yes      # ⚠ spends SearchApi credits
```

Start from [`_template.json`](../data/cities/_template.json) rather than a
hand-written stub. Its `_readme` array is 27 lines of guidance before a line of
config,
it is valid JSON, and it carries every required field — including `name`, which
`CityConfig` requires and `loadCity()` does not validate, so omitting it fails
late with a `TypeError` rather than a teaching message.

**Only `tiles` and `categories` need thought.** Everything else is lookup:

- **Tiles are real neighbourhood centres, not an even grid.** Business density
  follows neighbourhoods; a grid buys desert, water and airports at full price.
- **`density` and `tier` are the cost lever**, and they are judgement calls, not
  measurements. Nothing checks that a tile marked `dense` is dense, and a wrong
  label silently over-spends or under-collects with no signal either way. That
  is the honest limitation, recorded in
  [ADR 0001](./adr/0001-tile-the-crawl.md).
- Only Dubai's tiling has ever been verified, which is why the template ships
  documented guidance rather than invented coordinates —
  [ADR 0001's Bad list](./adr/0001-tile-the-crawl.md) is where that
  limitation is recorded in full.

## Porting the site

**The crawl is city-agnostic.** Tiles, categories, bounding boxes, country code
and phone region all live in [`data/cities/<id>.json`](../data/cities), and
nothing in the pipeline hard-codes a city. Porting the _crawl_ is a JSON file;
porting the _site_ is still a small patch — page titles, the JSON-LD
`addressRegion`, [`lib/data.ts`](../packages/web/lib/data.ts)'s phone parser and
the classifier prompt in
[`classify.ts`](../packages/pipeline/src/classify.ts) all still say Dubai.
