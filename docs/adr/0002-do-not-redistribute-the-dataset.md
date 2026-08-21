# ADR 0002 — Ship the pipeline, not the dataset

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

This project is MIT-licensed and built in public. The obvious instinct is to
commit the resulting dataset of ~10,000 Dubai businesses so readers can use it
immediately, and so the repo has obvious standalone value.

But the data does not originate with us. It comes from Google Maps, retrieved
through SearchApi's Google Maps engine. Google's terms restrict redistribution
of Maps content, and SearchApi's terms govern what may be republished from
results delivered through their API. The ambassador proposal this project was
written against explicitly scopes the crawl to "whatever your terms permit for
republication."

Committing 10,000 business records to a public GitHub repository is
redistribution, at scale, in a form trivially scraped by others. Git history
also makes it effectively permanent: deleting the file later does not remove it
from the repository.

## Decision

**The crawled dataset is not committed to this repository.**

What _is_ committed:

- The complete pipeline source
- `data/cities/*.json` — the crawl plan for each city (see ADR 0005)
- `data/taxonomy-map.json` — the category mapping (our own derived work)
- `fixtures/` — a small number of recorded API responses for offline tests
- `data/suppression-list.json` — opaque `place_id` values only

`data/raw/` and `data/out/` are git-ignored.

## Consequences

**Good:**

- Removes the redistribution risk entirely, rather than managing it
- Makes takedown meaningful. A removed business can actually stay removed,
  which is impossible once records are in public git history
- Produces a better open-source artifact. "Here is a reproducible machine, bring
  your own key" is more useful and more honest than a stale CSV
- Keeps the repository small and reviewable

**Bad:**

- A reader cannot get the data without their own SearchApi key and spending
  credits. This raises the bar for casual use
- The repo is less immediately impressive to someone who wanted a free dataset
- Reproducibility now depends on Google Maps results being reasonably stable
  over time, which they are not exactly. Two runs months apart will differ

**Mitigation for the last point:** the crawl plan is committed and deterministic,
and every raw response is archived to S3 per run, so any individual run remains
internally reproducible and auditable even though the upstream data drifts.

## Alternatives considered

- **Commit the full dataset.** Rejected: redistribution risk, and it makes the
  takedown promise in `TAKEDOWN.md` unenforceable.
- **Commit a derived subset** (names and categories only, no phones or
  addresses). Rejected: still redistribution, and the phone data is the
  interesting part of Milestone 2 — a subset without it has little value.
- **Publish the dataset separately under a data licence.** Deferred. This may be
  revisited if SearchApi confirms in writing what republication their terms
  permit, per the month-one scope email.
