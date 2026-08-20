# Directory from Scratch

**An open-source Dubai business search engine, built in public on [SearchApi](https://www.searchapi.io/)'s Google Maps engine.**

[![CI](https://github.com/pooyagolchian/directory-from-scratch/actions/workflows/ci.yml/badge.svg)](https://github.com/pooyagolchian/directory-from-scratch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Most "how to scrape Google Maps" tutorials stop at a single API call and a
`console.log`. This one goes all the way to a live product: a crawl that respects
a hard result ceiling, a deduplicated dataset, an LLM taxonomy pass that costs
cents instead of dollars, phone search over E.164-normalised UAE numbers, and
thousands of programmatic SEO pages on serverless Next.js — with the AWS bill
published at the end.

Live at **[directory.pooyagolchian.com](https://directory.pooyagolchian.com)** ·
Written up at **[pooyagolchian.com](https://pooyagolchian.com)**

> **Status: Milestone 1 in progress (v0.1).** The pipeline is being built now.
> See [Roadmap](#roadmap) for what is and isn't done.

---

## What I measured before writing any code

Every design decision below came from probing the live API first. These numbers
are reproducible — run `pnpm crawl --probe` to re-derive them.

| Finding                                      | Evidence                                                                                                                                             | Why it matters                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **~200 results is a hard ceiling per query** | `page=11` returns zero results; pages 1–10 return 20 each                                                                                            | A single "restaurants in Dubai" query can _never_ return more than ~200 businesses. Geographic tiling is mandatory, not an optimisation. |
| **Tiles are cleanly disjoint**               | Downtown vs Deira: **0 overlap** across 20 results each                                                                                              | The tiling strategy actually works. Geography partitions the city without redundant spend.                                               |
| **~12% duplicate rate within a query**       | 80 results fetched → 70 unique                                                                                                                       | Budget **~17.5 unique businesses per request**, not 20.                                                                                  |
| **Phones come back local-format**            | `04 577 6680`, `052 253 3290`                                                                                                                        | Not E.164. Normalisation is real work, not a formality.                                                                                  |
| **One business, nine categories**            | `Restaurant, Bar & grill, Brunch restaurant, Cocktail bar, Live music bar, Live music venue, Oyster bar restaurant, Seafood restaurant, Steak house` | Google's category strings are unusable as-is. Hence the taxonomy pass.                                                                   |
| **Titles are bilingual**                     | `Shamiat Restaurant مطعم شاميات - Dubai`                                                                                                             | Slugs and the typeahead index must handle Latin _and_ Arabic tokens.                                                                     |

## The one idea worth stealing from this repo

**Don't classify businesses. Classify categories.**

The obvious way to clean Google's category strings is to send all 10,000
businesses to an LLM. That costs real money and scales linearly forever.

But 10,000 businesses only contain **~1,200 distinct category strings**. So:

1. Extract the distinct set of category strings across the whole corpus
2. Classify those ~1,200 strings **once** into a three-level taxonomy
3. Apply the result to every business by **deterministic lookup** — zero LLM calls
4. Commit the mapping as [`data/taxonomy-map.json`](./data/taxonomy-map.json)

The mapping is a reviewable artifact, so a wrong category is fixable by pull
request rather than by re-running a model. And because the map amortises, the
**marginal cost of the next 1,000 businesses approaches zero.**

Measured costs get published in the Milestone 1 write-up.

## Architecture

```
 SearchApi Google Maps engine
            │
     ┌──────▼───────┐   one SQS message per (tile, category, page)
     │  Stage 1     │   adaptive pagination: stop early on thin/duplicate pages
     │  fetch       │──────────────► S3  raw/{runId}/…  ← re-runnable without re-spending credits
     └──────┬───────┘
     ┌──────▼───────┐   dedup on place_id · E.164 phones · Dubai bounding box
     │  Stage 2     │   Arabic-aware slugs
     │  normalise   │
     └──────┬───────┘
     ┌──────▼───────┐   distinct categories → Claude Haiku 4.5 (Batch API) → taxonomy-map.json
     │  Stage 3     │   then pure lookup for every business
     │  classify    │
     └──────┬───────┘
     ┌──────▼───────┐
     │  Stage 4     │──────────────► DynamoDB single table
     │  load        │                 + phone GSI + browse GSI + typeahead prefix items
     └──────────────┘
                                     Next.js on Lambda ──► directory.pooyagolchian.com
```

Everything runs in **`me-central-1` (UAE)** — roughly 5 ms from Dubai versus
~120 ms from Frankfurt. Milestone 2 publishes the measured difference.

## Roadmap

| Milestone | Scope                                                                     | Status         |
| --------- | ------------------------------------------------------------------------- | -------------- |
| **v0.1**  | Crawl → dedup → LLM taxonomy → ~10,000 categorised Dubai businesses       | 🚧 in progress |
| **v0.2**  | Phone search over +971 E.164, search-as-you-type, measured latency        | planned        |
| **v1.0**  | Programmatic SEO toward 10,000 pages, Search Console retro, full AWS bill | planned        |

Each milestone ships a tagged release, a written article, and a video.

## Run it yourself

You need your own SearchApi key — this repo ships the machine, not the data.

```bash
git clone https://github.com/pooyagolchian/directory-from-scratch.git
cd directory-from-scratch
pnpm install
cp .env.example .env      # add SEARCH_API_KEY and ANTHROPIC_API_KEY

pnpm test                 # runs fully offline against recorded fixtures — costs nothing

pnpm plan                 # build the crawl plan (no API calls)
pnpm crawl --dry-run      # show exactly what would be requested, and the credit cost
pnpm crawl                # ⚠️ spends SearchApi credits
```

`pnpm crawl --dry-run` prints the exact request count before you spend anything.
Read it before the real run.

To deploy your own copy:

```bash
npx sst secret set SearchApiKey    "…"
npx sst secret set AnthropicApiKey "…"
npx sst deploy --stage dev
```

## About the data

**This repository does not redistribute the crawled dataset.** Business listings
originate from Google Maps via SearchApi and are subject to their terms. What is
committed here is the pipeline, the crawl plan, the taxonomy map, and small test
fixtures — enough to reproduce the result with your own key.

Business listings only. No residential numbers, no personal data.
Removal requests are honoured — see **[TAKEDOWN.md](./TAKEDOWN.md)**.

## Contributing

Issues and pull requests welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).
The easiest high-value contribution is fixing a wrong category mapping in
[`data/taxonomy-map.json`](./data/taxonomy-map.json).

## License

[MIT](./LICENSE) for the code. See the license note about data scope.

---

Built as part of the **SearchApi Developer Ambassador Program** by
[Pooya Golchian](https://pooyagolchian.com) ·
[GitHub](https://github.com/pooyagolchian) ·
[LinkedIn](https://linkedin.com/in/pooyagolchian)
