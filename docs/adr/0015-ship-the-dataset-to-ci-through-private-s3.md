# ADR 0015 — Ship the dataset to CI through a private S3 bucket, never through git

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

Two accepted decisions, each correct on its own, together made production
undeployable through the repository's own deploy pipeline.

[ADR 0002](./0002-do-not-redistribute-the-dataset.md) forbids committing the
crawl output: the promise in `TAKEDOWN.md` is unenforceable once records are in
public git history. [ADR 0009](./0009-bundle-the-dataset-into-the-lambda.md)
requires `data/out/businesses.json` to be present at **build** time, because the
site bundles it into the server function, and
`packages/web/scripts/bundle-data.mjs` exits 1 rather than deploying an empty
directory to a live domain.

A fresh CI checkout therefore has the requirement and not the file. Measured on
2026-08-23:

- `git ls-files data/out/` → **0 files**; `.gitignore:32` ignores the directory.
- `.github/workflows/deploy.yml` contained **no step** that produced or fetched
  it.
- So `npx sst deploy --stage production` from CI fails inside `pnpm build`,
  every time, by design.

The gap was invisible because every deploy so far ran from a laptop that
happened to have `data/out/` sitting in it. The deploy workflow — which exists
precisely so that deploys use short-lived OIDC credentials, run typecheck, lint
and test first, and hold a concurrency lock — has never been the path anyone
actually used.

**Rebuilding the dataset in CI is not an option either.** `pnpm load
--from-archive` can reconstruct `businesses.json` from raw responses without
spending credits, which is the property ADR 0001 was designed for. But the
archive it would read lives in S3 only when the Lambda fetcher writes it, and
the v0.1 crawl was run locally through `pnpm crawl`, which archives to
`data/raw/` on disk. Both `RawArchive` buckets contain **0 objects**. There is
nothing in the cloud to rebuild from.

## Decision

**The built dataset travels from the operator's machine to CI through a private,
versioned S3 bucket in the same AWS account the stack deploys into. It is never
committed, never public, and is verified before anything consumes it.**

```bash
pnpm dataset:push    # after pnpm load, from a machine that has the data
pnpm dataset:pull    # in CI, after assuming the deploy role, before the build
```

Both live in `scripts/dataset.mjs` and read `DATASET_S3_URI`, which in CI comes
from a repository variable. The bucket is created once, outside SST, with all
four public-access blocks on, SSE-AES256, and **versioning enabled** so a bad
push does not destroy the last good copy.

`deploy.yml` gains two steps. A configuration check runs **before** anything
billable and fails naming the missing repository variable, because an unset
variable expands to an empty string and would otherwise surface as
"Could not assume role" or a bare aws-cli error — neither of which names the
cause. Then `pnpm dataset:pull` runs after the OIDC step, so the dataset is
fetched with the same short-lived credentials the deploy uses, and no long-lived
key is involved anywhere.

### Verification is the point, not the transport

`aws s3 cp` would have been three lines. The script exists for what it refuses:

| input                         | outcome                                               |
| ----------------------------- | ----------------------------------------------------- |
| truncated JSON                | rejected, byte count and parse position named         |
| `[]`                          | rejected — "would publish an empty directory"         |
| `[{"nope":1}]`                | rejected — expected records with a `placeId`          |
| array where an object belongs | rejected — `review-signals.json` is keyed by place_id |

That last row is a real defect this caught: the first version of the script
assumed every file was an array and rejected `review-signals.json`, which is
legitimately an object. The fix made the shape a per-file property.

**Everything is verified before anything is uploaded.** The first version
uploaded as it went, so a rejected second file left S3 holding a fresh
`businesses.json` beside a stale `review-signals.json` — a half-published
dataset that the next deploy would consume without noticing. Re-tested after the
fix: four rejected pushes left the bucket's timestamps untouched.

### Measured end to end

With `data/out/` moved aside to simulate a fresh checkout: `pnpm dataset:pull`
restored 14,981 businesses and 999 review signals byte-identically, and
`pnpm --filter @directory/web build` then exited **0**.

## Consequences

**Good:**

- The deploy workflow becomes usable for the first time, which means production
  deploys can go through OIDC, the concurrency lock, and the typecheck/lint/test
  gates instead of someone's shell.
- ADR 0002 holds unchanged. The dataset is not in git, and the bucket blocks
  public access at all four levels.
- A wrong or empty dataset is now rejected _before_ it becomes a live site,
  rather than discovered by a reader. That is a guarantee ADR 0009's
  build-time check only gave for a file that was entirely absent.
- No long-lived credential is introduced: CI fetches with the OIDC session it
  already has.

**Bad:**

- **The dataset now exists in one more place, and `TAKEDOWN.md` has one more
  copy to honour.** Applying a suppression and re-running `pnpm load` fixes the
  local copy and the next deploy; it does **nothing** to the object already in
  S3 until someone remembers to push again. Versioning makes that worse before
  it makes it better — old versions retain removed records until they are
  expired deliberately. There is no lifecycle rule doing that yet.
- **It is a manual step with no enforcement.** Nothing links `pnpm load` to
  `pnpm dataset:push`, so CI can keep deploying a months-old dataset
  indefinitely and every run will look green. The object carries no timestamp
  the build checks.
- **The bucket is unmanaged infrastructure.** It is created by hand rather than
  in `sst.config.ts`, so `sst remove` will not clean it up, nothing recreates it
  in a fresh account, and its name lives in a repository variable rather than in
  code. That is deliberate — the dataset outlives any one stage and is shared by
  `dev` and `production`, so tying it to a stack's lifecycle would be wrong —
  but it is real drift between what the repository describes and what exists.
- **This is a stopgap on top of a stopgap.** ADR 0009 called bundling the
  dataset a stopgap for Milestone 1; this makes that stopgap deployable rather
  than removing it. Milestone 2's DynamoDB deletes both, and until then the
  16.2 MB file is copied twice on every deploy.

## Alternatives considered

- **Commit the dataset.** Rejected outright by ADR 0002. It is also 16.2 MB
  against a repository of 1.3 MB.
- **Rebuild it in CI with `pnpm load --from-archive`.** Rejected on measurement,
  not on principle — this is the option the architecture was designed for, and
  it would remove the manual push entirely. Both `RawArchive` buckets hold 0
  objects, because the v0.1 crawl ran through `pnpm crawl` locally and archived
  to `data/raw/`. It becomes the right answer the moment a crawl runs through
  the Lambda fetcher, and it should be revisited then.
- **A GitHub Actions artifact.** Rejected: artifacts expire, and there is no way
  for an operator to upload one from their machine without inventing a second
  workflow to receive it.
- **A GitHub release asset.** Rejected on ADR 0002 — the repository is intended
  to be public, and a release asset on a public repository is publication of the
  dataset in the most literal sense available.
- **`aws s3 cp` inline in the workflow, with no script.** Rejected: it moves the
  file without checking it, and the four rejections in the table above are the
  reason this decision is worth writing down at all.
- **Put the bucket in `sst.config.ts`.** Deferred. SST generates the bucket
  name, and the name is needed _before_ `sst deploy` runs because the build
  happens inside it — a chicken-and-egg the repository variable sidesteps.
