# ADR 0009 — Bundle the dataset into the Lambda for v0.1, and say plainly that it is a stopgap

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Deploying the site as it stood would have published an **empty directory to a
live domain**.

`packages/web/lib/data.ts` read the crawl output from the repository root. That
works in local development and does not exist inside a Lambda: `data/out/` is
git-ignored and sits outside `packages/web`, so nothing bundled it. Every page
would have rendered the "No data yet" empty state (`packages/web/app/page.tsx`)
at `directory.pooyagolchian.com`, and it would have done so silently — the code
catches the failed read on purpose, because an un-crawled repository is a valid
state.

The comment in that same file said the read was a development convenience and
that DynamoDB backed it in production. **That was aspirational, not true.**
`packages/web` has no DynamoDB client at all, in any dependency, on any page.
The claim survived inside the file it was wrong about until a deploy attempt
exposed it, and the same claim still stands uncorrected in two other places —
see "What this contradicts in the repository" below.

### What was tried first, and why it failed

The obvious fix is one function that resolves the dataset from a bundled copy
if there is one and from the repository root otherwise, so the same code works
in both places. That was written, and it was worse than the bug.

Next traces the files a route needs by **reading the source**. A path it cannot
resolve statically makes it give up on the analysis and wildcard the directory
instead. With a `process.cwd()/../..` fallback in `dataFile()`, tracing did
exactly that: `page.js.nft.json` listed **1,679 files, 1,400 of them raw crawl
archive**, carrying **20,226 verbatim Google review snippets**, some of which
name individual employees.

None of it was read by any code. All of it would have shipped inside the
Lambda. Republishing verbatim review text is precisely what
`packages/core/src/reviews.ts` refuses to do on purpose — "Reviews are used as a
SOURCE, never as content", on the same reasoning that produced ADR 0002. A
convenience fallback was a privacy incident sitting inside a build artefact.

## Decision

**For v0.1 the dataset is copied into the web package at build time and
bundled into the server function. Milestone 2 replaces this with DynamoDB. It
is a stopgap and is written down as one.**

The mechanism, in three files:

- `packages/web/scripts/bundle-data.mjs` copies `data/out/businesses.json`,
  `data/out/review-signals.json`, `data/demand.json` and
  `data/cities/${DIRECTORY_CITY ?? "dubai"}.json` into `packages/web/.data`,
  the last one renamed to `city.json` so the app never has to know which city
  it serves (ADR 0005).
- `packages/web/package.json` runs it at both `prebuild` **and** `predev`, so
  local development exercises the same read path as the Lambda rather than a
  second one that only works on a laptop.
- `outputFileTracingIncludes: { "/**": [".data/**"] }` in
  `packages/web/next.config.ts` puts the result inside the server function.

**The loud failure is the actual fix.** Bundling is only the mechanism. When a
required file is missing the script prints what to run and calls
`process.exit(1)`:

```
  Missing data/out/businesses.json
  Run `pnpm crawl` then `pnpm load` before building for deployment.
  Building without it would deploy an empty directory.
```

`businesses.json` and the city config are required; `review-signals.json` and
`demand.json` are optional and only warn, because the site degrades honestly
without them. A build can never again silently produce an empty site — which
was the whole defect, not the missing path.

**There is deliberately no fallback path, and the single static path is the
whole point.** `dataFile()` returns exactly `join(process.cwd(), ".data",
bundled)` and nothing else. `packages/web/lib/demand.ts` carries the same
constraint with a comment pointing at `lib/data.ts` for the reason, so the rule
is a property of the package rather than a quirk of one file. It is a privacy
control, not a style preference: the static path is what keeps `data/raw/` out
of the bundle by construction rather than by vigilance.

**ADR 0002 holds without compromise.** `packages/web/.data/` is git-ignored
alongside `data/raw/` and `data/out/`. It is a build artefact. The dataset is
still never committed, and the takedown promise in `TAKEDOWN.md` is still
enforceable.

### Milestone 2 is a client, not a migration

The signatures in `lib/data.ts` are index-shaped on purpose, and every one of
them already has a table index waiting for it, written today by
`packages/pipeline/src/items.ts`:

| `lib/data.ts`                                            | Item shape                  |
| -------------------------------------------------------- | --------------------------- |
| `getBySlug` / `byArea` / `byCategory` / `byAreaCategory` | GSI2 `CAT#{l2}#AREA#{area}` |
| `byPhone`                                                | GSI1 `PH#{e164}`            |
| `typeahead`                                              | `PFX#{prefix}` partitions   |

That is why the stopgap is affordable: swapping the backend rewrites the bodies
of those functions and not a single page. The `PFX#` partitions even carry a
denormalised `title`, `slug`, `area` and `l2` so a keystroke renders from one
`Query` with no follow-up read — work that is finished and unused.

**The DynamoDB write path is not dead code.** `pnpm load --yes` still shapes
every business into its items, still resubmits `UnprocessedItems` with
exponential backoff and jitter up to `MAX_WRITE_ATTEMPTS = 8`, and still fails
loudly rather than reporting a total it never wrote. The table is real and
populated. Only the read side is missing.

## What this contradicts in the repository

This ADR contradicts the project's own front matter in three places. Either it
corrects them or it is contradicted on the day it is written.

1. **`sst.config.ts:112`** — "The site. Server Components read DynamoDB
   directly — there is no API service in between". The second half is true and
   worth keeping. The first half is false today: Server Components read a
   bundled JSON file.
2. **`CLAUDE.md:124`** — the package table's "`packages/web` — Next.js. Reads
   DynamoDB directly from Server Components." Should read: reads the bundled
   crawl output for v0.1; DynamoDB in Milestone 2 (ADR 0009).
3. **`CLAUDE.md:126-127`** — "**There is deliberately no separate API service.**
   Next.js Server Components query DynamoDB directly". The _no separate API
   service_ reasoning is correct and must survive: inserting API Gateway would
   add a second cold start straight into the latency numbers Milestone 2 exists
   to publish, and `us-east-1` already spends ~250ms of distance on a Dubai
   audience (ADR 0003). It is the DynamoDB half of the sentence that is
   currently false.

The `sst.aws.Nextjs("Web")` component is still declared `link: [table]`, so the
web function holds permission to read a table it never queries. The link stays,
deliberately, so Milestone 2's first query is a code change rather than a code
change plus an infrastructure change — but an unused grant nobody has written
down is exactly the class of thing that let the DynamoDB claim survive in the
first place, so it is written down here.

## Consequences

**Good:**

- A build cannot silently deploy an empty directory. The failure mode that
  prompted this ADR is now a non-zero exit with the two commands that fix it
- No new infrastructure, no client, no credentials, no permissions to reason
  about. v0.1 deploys with what already exists
- Development and production read through the same function, because `predev`
  and `prebuild` both populate `.data`. There is no second code path that only
  works locally
- The raw archive cannot reach the Lambda by accident. One static path per read
  is a structural guarantee, not a review checklist
- ADR 0002 is untouched: `.data/` is a build artefact and git-ignored
- Milestone 2 becomes a client swap. The indexes, the sort keys and the
  typeahead partitions are already written by the loader
- Works for any city (ADR 0005) — `DIRECTORY_CITY` selects which config is
  copied in, and the app only ever sees `city.json`

**Bad:**

- **Every lookup is a linear scan of 14,981 records.** `getBySlug`, `byPhone`,
  `byArea`, `byCategory`, `byAreaCategory`, `search` and `typeahead` all walk
  `allBusinesses()`, and the facet builders — `categories()`, `areas()`,
  `categoriesInArea()`, `areasInCategory()` — walk it again on every call
- **The whole dataset is parsed and held in memory per container.** Cold starts
  pay the parse; every warm container pays the footprint for as long as it
  lives. That cost is permanent, not amortised
- **13.5MB inside a server function is acceptable, not good**, and the bundle
  grows with the city. It works at Dubai's scale. Nothing here establishes
  where it stops working, and the failure would arrive as a deploy-time
  surprise rather than a gradual degradation
- **Data is only as fresh as the last deploy.** Correcting one wrong phone
  number means rebuilding and redeploying the entire site
- **The site cannot be built without a crawl.** A contributor with no SearchApi
  key cannot produce a deployable build at all, because the script exits 1 by
  design. That is the barrier ADR 0002 accepted for the data, now extended to
  the build itself
- `byRank()` in `packages/web/lib/rows.ts` calls `corpusPrior(allBusinesses())`
  on every invocation while a memoised `getPrior()` sits directly above it, so
  every sorted list scans the corpus twice over for the same numbers. Same
  result, wasted work — worth fixing before this layer is quoted as designed
- **The wrong claim about DynamoDB lived inside `lib/data.ts`'s own comment
  until a deploy failed.** Documentation that states intent as fact is how this
  happened, and two files listed above still do it. Treat that as the real
  lesson of this ADR rather than the bundling trick

## Alternatives considered

- **Do Milestone 2 now — point `lib/data.ts` at DynamoDB.** Deferred. It is the
  right answer and it is a milestone, not an afternoon: a client, an item →
  `Business` mapper, and per-page query rewrites. Doing it under deploy pressure
  would produce the code without the latency measurement that is the reason
  Milestone 2 exists.
- **Keep the repo-root read with a `process.cwd()/../..` fallback.** Rejected on
  measurement: it made Next's tracer wildcard the directory and pulled 1,679
  files — 1,400 of them raw archive, 20,226 verbatim review snippets — towards
  the Lambda.
- **Commit `data/out/businesses.json` so the build always has it.** Rejected
  outright by ADR 0002. This is the option the whole project is organised
  against.
- **Ship a small sample dataset for contributors to build against.** Rejected:
  it is the dataset by another name, at a size chosen for convenience rather
  than principle. `fixtures/` already covers what tests need, offline and for
  free.
- **Download the dataset from S3 at cold start.** Rejected for v0.1: it puts a
  network round trip in front of the first render and a runtime dependency in a
  path that currently has none, for a stopgap DynamoDB is about to replace.
- **Static export, no server function at all.** Rejected: `/search` and
  `/api/typeahead` read a query at request time, and phone lookup depends on it.
- **Warn instead of exiting when the dataset is missing.** Rejected: a warning
  in a CI log is how an empty directory reaches a live domain. The exit code
  _is_ the fix.
