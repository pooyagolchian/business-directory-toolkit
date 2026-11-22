# ADR 0016 — Carry businesses over between crawls, and refuse to publish a shrunken directory

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

`pnpm load` rebuilt `data/out/businesses.json` from the newest crawl and nothing
else. That was harmless while there was only ever one crawl. It stops being
harmless the moment there is a second one, and a weekly scheduled crawl is about
to be built on top of this stage.

A crawl is a sample of Google, not a census. The same tiles and categories
return a different set on every run, so a business that is still trading and
still listed can simply not come back this week. Under the old load it would
leave `businesses.json`, its page would leave the next deploy, and a URL that a
search engine has already indexed would start returning 404 — over sampling
noise, not over anything that happened to the business.

The size of that effect was visible before it happened:

- **14,980** businesses in the live set: the 14,981 in-Dubai businesses from the
  v0.1 crawl (`CLAUDE.md`, measured-facts table), less the one `place_id`
  suppressed in 07cf784.
- **~13,600** estimated by the next crawl's dry run on 2026-11-23.

That is roughly 1,380 indexed pages, about 9.2% of the directory, lost on the
first re-crawl. Nothing would have flagged it. The load report would have shown
a smaller `Businesses` line and every quality gate would still have passed: the
≥10,000 gate is the only one that measures size, and 13,600 clears it.
`pnpm dataset:push` verifies that a file is valid, non-empty pipeline output
(ADR 0015, `0015-ship-the-dataset-to-ci-through-private-s3.md`). It had no
opinion about whether that output was smaller than the live one.

## Decision

**A load merges the previous dataset into the fresh crawl. A business the crawl
did not return is kept for 56 days after the last crawl that did return it. The
push separately refuses to publish a set smaller than 95% of the published one
unless told to.**

### The merge — `packages/core/src/carry-over.ts`

`mergeCarryOver(previous, fresh, { now, maxUnseenDays, suppressed })` is keyed
by `placeId`:

- **Fresh wins.** For an id in both sets the fresh record is taken whole, and
  every fresh record is stamped `lastSeenAt = now`. `lastSeenAt` is a new
  optional ISO 8601 field on `Business` in `packages/core/src/types.ts`.
- **A previous-only record is carried** if `now − lastSeenAt ≤ maxUnseenDays`,
  with its timestamp **unchanged**. Past that it is **retired**. Re-stamping a
  carried record would restart its clock on every run, and nothing would ever
  retire. A test runs two merges end to end to pin this.
- **A previous record with no `lastSeenAt` is adopted and stamped `now`.** That
  is every record in the live dataset today. There is no honest older date to
  give it, because the v0.1 crawl left no per-record timestamp. Every candidate
  is wrong in a way that matters. The v0.1 crawl date would retire the entire
  live directory on the first run. The file's mtime records a copy, not a
  sighting. So the grace period starts at adoption.
- **Suppression is applied to both inputs, through `dropSuppressed`, before
  anything else is decided.** The previous dataset was built before today's
  takedowns, which makes carry-over a second way back in. A carried record that
  resurrected a takedown would be exactly the recurrence that ADR 0007
  (`0007-enforce-the-takedown-promise.md`) exists to stop. A test covers a
  suppressed id present only in `previous`. A suppressed record that is also
  stale is counted as suppressed, because the takedown is why it is gone.
- **Output order is most-reviewed first, ties broken by `placeId`.** That is
  the order load always wrote. The tiebreak is new: ties previously fell in tile
  iteration order.
- `DEFAULT_MAX_UNSEEN_DAYS = 56`, which is eight weekly crawls.

`parseCarryOver(json)` throws on anything that is not a previous
`businesses.json`:

- invalid JSON, a non-array, or `[]`
- a record without `placeId`, `slug`, `title`, `area` or `types`
- an unreadable `lastSeenAt`
- a duplicate `placeId`

It throws for the reason `parseSuppressionList` does. "Nothing to carry" and
"broken file" look identical downstream, and treating a truncated download as
the first would switch the protection off on the run that needed it. The merge
itself also throws on an unreadable `lastSeenAt` rather than doing NaN
arithmetic, which would silently either retire the record or keep it forever.

### The load — `packages/pipeline/src/cli/load.ts`

```bash
pnpm load --files-only --carry-over <previous businesses.json> [--max-unseen-days 56]
```

- The carry-over file is read and validated at startup, before the archive walk.
  A bad path fails in the first second. The natural CI invocation also points
  `--carry-over` at the `data/out/businesses.json` that `pnpm dataset:pull` just
  wrote and that this run is about to overwrite.
- The merge runs **after normalisation and before anything is written**. That
  way `businesses.json`, the DynamoDB items and the typeahead prefixes all come
  from the merged set.
- A carried record's `area` is re-derived from its coordinates with
  `nearestTile`, the rule ADR 0011 (`0011-area-from-coordinates-not-provenance.md`)
  applies to fresh records, so a change to the tile set does not strand carried
  businesses on areas that no longer exist.
- The taxonomy gate now counts unmapped records in the merged set. Its
  denominator already did.
- Every run prints where every record went, including `--dry-run` and runs
  without `--carry-over`:

```text
Suppressed          0  (takedown requests honoured, from data/suppression-list.json)
Carry-over from     data/out/previous-businesses.json
Fresh               36  (returned by this crawl, stamped lastSeenAt 2026-11-22T21:14:35.233Z)
Carried             2  (not returned this time, seen within 56 days — kept)
Retired             1  (not returned for more than 56 days — dropped)
Suppressed on merge 1  (takedowns re-applied to the merged set; non-zero means the previous dataset still held one)
Businesses          38  (fresh + carried)
```

That is the fixture smoke run, three recorded SearchApi pages plus a synthetic
five-record previous set, with the carry-over path shortened to the one CI
would pass. When the flag is absent the second line
reads `NONE (--carry-over not given: the previous dataset was not consulted, so
anything this crawl missed is gone)`. A scheduled job that forgets the flag says
so in its own log. In the same spirit as the "Suppressed" line in ADR 0007, a
carried record and a retired one are both labelled lines in the report, never
an unexplained difference in the total.

**`--files-only`** writes `data/out/` and exits 0 without needing
`DIRECTORY_TABLE` or touching DynamoDB. That is what a CI job with S3
credentials and no table needs. `--dry-run` writes the same file today, as a
side effect of serving the web app in local development, and its closing line
now says so instead of "nothing was written". A job built on that side effect
would break the day someone made dry runs truly dry. When it broke, it would
re-push the dataset it had just pulled as if it were new, and the push would
look green. `--files-only` cannot be combined with `--yes` or `--dry-run`.

### The push — `scripts/dataset.mjs` and `scripts/shrink-guard.mjs`

Before uploading anything, `pnpm dataset:push` downloads the published
`businesses.json` to a temporary file, counts its records, deletes the copy and
asks `shrinkVerdict({ remote, next, allowShrink })`:

| published               | new is…                      | outcome                                            |
| ----------------------- | ---------------------------- | -------------------------------------------------- |
| absent (S3 404)         | anything                     | allowed — first push                               |
| N                       | ≥ 95% of N                   | allowed, both counts printed                       |
| N                       | < 95% of N                   | **refused**, naming both counts and the percentage |
| N                       | < 95% of N, `--allow-shrink` | allowed, printed as a deliberate shrink            |
| 403, network, expired   | —                            | **refused**: nothing was uploaded                  |
| not JSON / not an array | —                            | refused unless `--allow-shrink`                    |

The comparison is `next * 100 < remote * 95`, in integers, so exactly 95% is
allowed and the boundary needs no argument about rounding. Only a 404 counts as "nothing published". S3 answers 403
for a missing key when the caller lacks `ListBucket`, so reading a 403 as a
first push would turn the guard off whenever credentials are wrong. The guard
runs after every local file is verified and before the first `s3 cp`, which
keeps ADR 0015's property that a refused push leaves the bucket untouched.

The ~13,600 estimate is 90.8% of 14,980, so a push without carry-over would
now be refused with exactly that number in the message.

## Consequences

**Good:**

- A re-crawl can no longer shrink the directory by sampling noise. A business
  has to be missed by every crawl for eight weeks before its page goes.
- The two defences are independent. The merge protects the directory when the
  load is run correctly. The push guard catches a load that was not run
  correctly: flag forgotten, wrong file, broken crawl.
- Takedowns survive the new path. A suppressed id present only in the previous
  dataset is dropped and reported on its own line.
- Every disappearance now has a reason in the load report: duplicate, no
  `place_id`, non-AE, suppressed, suppressed on merge, retired.
- The output order of `businesses.json` is now deterministic, so two loads of
  the same inputs produce the same file.

**Bad:**

- **A business that has closed lingers for up to 56 days** after the last crawl
  that returned it, along with its phone number, hours and rating. A reader can
  ring a closed shop for two months. That is the price of not 404ing a live
  business over one bad sample, and the trade is deliberate, but it is a worse
  experience than the one it replaces for exactly those businesses.
- **The carry-over list is only as fresh as the previous dataset.** A carried
  record is frozen at its last sighting: its rating, review count, hours and
  phone do not update until a crawl returns it again. Its taxonomy is frozen
  too. A correction to `data/taxonomy-map.json` re-categorises fresh records
  but leaves carried ones under the old category until they are seen again.
- **The clock is wall time, not crawl count.** If the weekly schedule stops for
  nine weeks, the first run after it resumes retires every business that run
  happens to miss, all at once. The push guard should catch a drop that large.
  The merge itself has no idea a gap happened.
- **Adoption gives every current record the same stamp.** The 14,980 live
  businesses all get `lastSeenAt` of the first carry-over load. None of them
  can retire before that date plus 56 days, whatever happened to them before
  adoption.
- **The quality gates now measure the published set, not the crawl.** A crawl
  that returned half the city still passes `unique place_ids >= 10,000` for
  eight weeks, because carried records fill the gap. The `Fresh` line is the
  only signal, and nothing fails on it.
- **Retired businesses stay in DynamoDB.** `pnpm load --yes` only issues
  `PutRequest`s, so a retired business leaves `businesses.json` and the bundled
  site but its items, typeahead prefixes included, stay in the table. That was
  already true of any business a crawl dropped. Carry-over makes it the
  documented path rather than an accident, and Milestone 2 reads from that
  table.
- **A carry-over file from another city is not detected.** `Business` keeps no
  country or city string, so `isInCity` cannot be re-applied to carried
  records. `nearestTile` has no distance cap, so they would be spread across
  today's tiles. Only the operator's choice of file, or the push guard noticing
  a strange count, stands between a wrong `--carry-over` and a mixed directory.
- **Seen-but-rejected is treated as unseen.** `fresh` is the normalised output,
  so a business the crawl DID return but normalise rejected counts as missing.
  If its city or country string changed, or it now falls outside the bounding
  box, it is carried for 56 days with its old data instead of leaving at once.
  The `Rejected non-Dubai` line counts it; nothing links that line to `Carried`.
- **95% is a judgement, not a measurement.** No second crawl has been loaded
  yet, so week-to-week variance under carry-over is unknown. The floor may turn
  out too tight, forcing routine `--allow-shrink`, or too loose to catch a
  partial failure. A mistyped `DATASET_S3_URI` prefix inside a real bucket also
  returns 404, and the guard reads that as a first push.
- **The guard downloads the full dataset on every push.** That is ~16 MB to a
  temporary file. It is deleted before the script acts on the result, including
  on every error path. A version that died before deleting it left a copy of
  the dataset in the system temp directory, and that was caught in the smoke
  test, not by a unit test.

## Alternatives considered

- **Union forever: never retire.** Rejected. The directory becomes monotonic,
  and a business that closed in 2026 is still listed in 2030. Carry-over exists
  to absorb noise, not to keep dead listings.
- **Retire after N consecutive missed crawls, not N days.** Deferred. It fixes
  the schedule-gap problem in the Bad list, but it needs a per-record miss
  counter that every load must increment correctly, and a wall-clock timestamp
  is far easier to audit by eye in a JSON file. It is the right answer if the
  schedule turns out to be irregular.
- **Confirm each missing business with a `google_maps_place` lookup.** Rejected
  on cost. At the estimated gap of ~1,380 businesses per crawl, that is roughly
  1,380 extra requests a week against a 100k-credit budget. It would also
  confirm only that a place still exists on Google, not that the next list
  query will return it.
- **Use DynamoDB as the previous set.** Rejected. The deployed site is built
  from the S3 dataset (ADR 0009, `0009-bundle-the-dataset-into-the-lambda.md`;
  ADR 0015), so that file is what "previously published" means. A CI job that
  rebuilds `data/out/` should not need table credentials to do it.
- **The push guard alone, with no merge.** Rejected. It would stop the shrink
  but leave no way to publish the next crawl short of `--allow-shrink`, which is
  the shrink.
- **The merge alone, with no push guard.** Rejected. Every failure the guard
  catches is a load that did not merge correctly, and those are precisely the
  loads whose own report cannot be trusted to flag it.
- **Serve 410 Gone or redirect retired pages instead of 404.** Deferred to
  Milestone 3, where URL lifecycle is part of programmatic SEO. It changes what
  a retirement looks like to a crawler, not whether one happens over noise.
