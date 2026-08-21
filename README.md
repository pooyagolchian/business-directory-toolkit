# Directory from Scratch

**An open-source toolkit for building a local business directory for any city, on [SearchApi](https://www.searchapi.io/)'s Google Maps engine.**

[![CI](https://github.com/pooyagolchian/directory-from-scratch/actions/workflows/ci.yml/badge.svg)](https://github.com/pooyagolchian/directory-from-scratch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Most "how to scrape Google Maps" tutorials stop at one API call and a
`console.log`. This one goes to a working product: a crawl that survives a hard
result ceiling, a deduplicated dataset, a taxonomy pass that costs nothing, real
search-demand measurement, and a search UI over ~15,000 businesses.

Point it at Dubai, Riyadh, Manchester, or anywhere else — **a city is a JSON
file, not a code change.**

Reference deployment: **[directory.pooyagolchian.com](https://directory.pooyagolchian.com)** ·
Written up at **[pooyagolchian.com](https://pooyagolchian.com)**

```bash
pnpm install
pnpm test                # the whole suite, offline — no API key, no credits
pnpm plan --city dubai   # what a crawl would cost, before spending anything
```

Both work on a fresh clone with no API key and no AWS account. Running the site
itself needs a dataset, and the dataset is deliberately not in this repo — see
[why](./docs/adr/0002-do-not-redistribute-the-dataset.md) — so bring your own
key and crawl your own city first.

---

## What the crawl actually measured

Every number here came from running it, not from estimating. Several contradict
what the documentation would lead you to expect.

| Finding                      | Measured                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hard ceiling per query**   | **~200 results.** `page=11` returns zero. Tiling is mandatory, not an optimisation.                                                                                        |
| **Tiles are disjoint**       | **0 overlap** between adjacent neighbourhood tiles. The strategy works.                                                                                                    |
| **Unique yield per request** | **10.9** over a full crawl — the in-query figure of ~17.5 **overestimates by 38%**, because cross-category overlap (~45%) dominates once you crawl more than one category. |
| **`types[]` ordering**       | **Alphabetical, not ranked.** 85% of tails sorted. It carries no relevance signal, so taking the first match gives arbitrary results.                                      |
| **Category saturation**      | 15,246 businesses → **1,788 distinct categories**. Marginal discovery fell from 76 to 4.3 new categories per 100 businesses.                                               |
| **Provenance ≠ location**    | **52% of businesses** sat in a different tile than the query that found them. Google returns results from a _radius_.                                                      |
| **Phone coverage**           | **92.2%**, and that is a ceiling — the detail endpoint recovered 1 phone in 15, and that one was foreign.                                                                  |

v0.1 crawl: **1,400 requests → 15,246 unique businesses → 14,981 in Dubai, zero errors.**

## Three ideas worth stealing

### 1. Classify categories, not businesses

The obvious way to clean Google's category strings is to send every business to
an LLM. That scales linearly with your dataset, forever.

But category vocabulary **saturates** while business count does not: 15,246
businesses contain only 1,788 distinct category strings — **8.5× fewer items.**

Better still, the distribution is Zipf: **the top 100 categories cover 87% of
businesses.** So the head does not need a model at all. `pnpm seed-taxonomy`
classifies it with ordered keyword rules — deterministic, free, reviewable — and
reaches **95.8% coverage with zero API calls.** A model's real job is the tail
no human would hand-map.

### 2. Let demand decide which pages to build

The crawl measures **supply** — how many spas exist. It says nothing about
**demand** — how many people look for one.

`pnpm demand` asks Google's autocomplete, which is ordered by real query
popularity. The two disagree sharply:

| Category    | Businesses | Neighbourhoods people search |
| ----------- | ---------: | ---------------------------: |
| Restaurants |      1,172 |                            4 |
| Nurseries   |        216 |                        **7** |
| Nail Salons |         18 |                            4 |

Generating every possible page and hoping is the default approach to
programmatic SEO. Selecting pages from measured demand is cheaper and far more
likely to rank — and it tells you what to **crawl** next, too.

### 3. Archive raw responses before parsing

Every response is written to storage untouched before anything reads it. That
one habit means normalisation, taxonomy, and loading can all be re-run for
**zero credits** — `pnpm load --from-archive` rebuilds the whole dataset from
disk. It is also how the app was developed against a crawl that was still
running.

## Add your own city

```jsonc
// data/cities/manchester.json
{
  "id": "manchester",
  "countryCode": "GB",
  "phoneRegion": "GB",
  "cityNames": ["manchester"],
  "boundingBoxes": [
    { "minLat": 53.35, "maxLat": 53.55, "minLng": -2.35, "maxLng": -2.15 },
  ],
  "tiles": [/* neighbourhood centres — see _template.json */],
  "categories": [/* seed queries */],
}
```

```bash
pnpm plan  --list                       # cities in this repo
pnpm plan  --city manchester            # free: request count and credit cost
pnpm crawl --city manchester --dry-run  # still free
pnpm crawl --city manchester --yes      # ⚠️ spends SearchApi credits
```

`--dry-run` prints the exact cost before you spend anything, and `--yes` is
required on every command that spends. Start with
[`data/cities/_template.json`](./data/cities/_template.json), which documents
what actually matters — tiles are the part worth thinking about.

## Pipeline

```text
plan → fetch → normalise → classify → load
                  ↓
        raw archive (re-runnable, free)
```

| Command              | Does                                | Costs             |
| -------------------- | ----------------------------------- | ----------------- |
| `pnpm plan`          | Build the crawl plan                | nothing           |
| `pnpm crawl`         | Fetch and archive                   | 1 credit/request  |
| `pnpm seed-taxonomy` | Classify the category head by rules | nothing           |
| `pnpm demand`        | Measure real search demand          | 1 credit/category |
| `pnpm reviews`       | Derive review signals               | 1 credit/business |
| `pnpm load`          | Normalise, gate, load               | nothing           |

## About the data

**This repository does not redistribute any crawled dataset.** Listings come
from Google Maps via SearchApi and are subject to their terms. What ships is the
machine: the pipeline, the crawl plans, the taxonomy map, and small test
fixtures. You crawl your own city with your own key, and the data is yours to
export.

**Business listings only. No residential numbers, no personal data.** Reviews
are used as a _source_, never as content — reviewer identity is stripped at the
boundary and review text is analysed then discarded, so what is stored is a
derived summary rather than a copy of someone else's corpus. Removal requests
are honoured: see **[TAKEDOWN.md](./TAKEDOWN.md)**.

## Contributing

The easiest high-value contribution is fixing a wrong category in
[`data/taxonomy-map.json`](./data/taxonomy-map.json) — a one-line pull request
that improves every business carrying it, and no API key required. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

Decisions are recorded in [`docs/adr/`](./docs/adr/), including the ones that
went wrong.

## License

[MIT](./LICENSE) for the code. See the licence note on data scope.

---

Built as part of the **SearchApi Developer Ambassador Program** by
[Pooya Golchian](https://pooyagolchian.com) ·
[GitHub](https://github.com/pooyagolchian) ·
[LinkedIn](https://linkedin.com/in/pooyagolchian)
