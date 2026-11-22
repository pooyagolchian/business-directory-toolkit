# Decisions and project status

Where the project stands, and an index of the decisions recorded in `docs/adr/`.

> **Where this actually is.** **v0.1 (pipeline) is done and measured** — 1,400
> requests, 15,246 unique businesses, zero errors. **v0.2 (search) is written but
> not served**: `pnpm load --yes` fills DynamoDB and nothing on any page reads it
> yet, and **no latency, Core Web Vitals or ranking numbers are published,
> because none have been taken.** Longer version
> below.

## Decisions

Recorded when they are made, **including when they turn out to be wrong** — and
the wrong part stays in the file. Index and dependency graph:
[`docs/adr/`](./adr/README.md).

| #                                                           | Decision                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [0001](./adr/0001-tile-the-crawl.md)                        | Tile the crawl geographically, because one query is capped at ~200 results      |
| [0002](./adr/0002-do-not-redistribute-the-dataset.md)       | Ship the pipeline, not the dataset                                              |
| [0003](./adr/0003-deploy-region.md)                         | Deploy to `us-east-1`, and design around the distance                           |
| [0004](./adr/0004-design-system.md)                         | Monochrome design system on Tailwind v4 + shadcn/ui                             |
| [0005](./adr/0005-toolkit-not-directory.md)                 | Ship a toolkit for any city, not a Dubai directory                              |
| [0006](./adr/0006-category-saturation.md)                   | Category saturation is real, and it is now measured                             |
| [0007](./adr/0007-enforce-the-takedown-promise.md)          | Enforce the takedown promise with a committed suppression list                  |
| [0008](./adr/0008-themes-must-generalise-and-be-topical.md) | Review themes must generalise, and must be topical                              |
| [0009](./adr/0009-bundle-the-dataset-into-the-lambda.md)    | Bundle the dataset into the Lambda for v0.1, and say plainly it is a stopgap    |
| [0010](./adr/0010-credibility-weighted-ranking.md)          | Rank by a credibility-weighted mean, not a raw star average                     |
| [0011](./adr/0011-area-from-coordinates-not-provenance.md)  | Assign a business to an area by its coordinates, not by the query that found it |

Where the project stands: **v0.1 (pipeline) is done and its numbers are
published rather than promised.** v1.0 (programmatic SEO) is substantially built
and is _ahead_ of v0.2 (search) — the DynamoDB storage half is written and
loaded, the serving half is not. Review signals are produced by `pnpm reviews`
and bundled into the site's data directory, but nothing on any page reads them
yet. No latency, Core Web Vitals or ranking measurements are published, because
none have been taken.
