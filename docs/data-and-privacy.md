# Data and privacy

What this repository does and does not ship, how review data is handled, and how removal requests are enforced.

## Data, privacy and takedown

**This repository does not redistribute any crawled dataset.** Listings come from
Google Maps via SearchApi and are subject to their terms. What ships is the
machine: the pipeline, the crawl plans, the taxonomy map, the suppression list,
and a handful of test fixtures. You crawl your own city with your own key, and
`pnpm export` hands you your own data as CSV, JSON or NDJSON. This is enforced
rather than intended — the guard step is in
[Development](./development.md#development).

**Business listings only. No residential numbers, no personal data.** Reviews are
used as a _source_, never as content.

```mermaid
flowchart TD
  fetchr["google_maps_reviews<br/>1 credit per business, only those with 10 or more reviews"]
  strip["stripReviewIdentity<br/>rebuilds the record from an allow-list,<br/>rather than deleting keys off the original"]
  anon["rating + text, in memory only"]
  score["deriveReviewSignals<br/>scored against the whole corpus, so<br/>good, place and dubai score nothing"]
  g1{"Term appears in 2 or more<br/>of this business's reviews?"}
  g2{"Term is a theme for<br/>5 or more businesses?"}
  g3{"Term is one of the business's own words,<br/>or 75% concentrated in one l1?"}
  keep["ReviewSignals — reviews analysed, mean rating,<br/>up to 6 themes. This is all that is ever written."]

  gone1(["Reviewer name, contributor id, profile link, photo<br/>— destroyed at the boundary"])
  gone2(["Review text — analysed, then out of scope.<br/>Never written anywhere."])
  d1(["Dropped — one reviewer's vocabulary is not a theme"])
  d2(["Dropped — 72% of terms named exactly one business.<br/>That is where staff names live."])
  d3(["Dropped — a name is about nothing, so it scatters.<br/>neha cleared the count gate at exactly 5 businesses."])

  fetchr --> strip
  strip --> gone1
  strip --> anon
  anon --> score
  score -.->|"after analysis"| gone2
  score --> g1
  g1 -->|"no"| d1
  g1 -->|"yes"| g2
  g2 -->|"no"| d2
  g2 -->|"yes"| g3
  g3 -->|"no"| d3
  g3 -->|"yes — 917 theme instances became 830"| keep
```

**Removal requests are honoured: see [TAKEDOWN.md](../TAKEDOWN.md).** Suppression
runs on the **load** path, not the fetch path, so a removed `place_id` stays
removed even when the dataset is rebuilt from the raw archive — filtering at
fetch time would leave the archive as a way back in.
[`data/suppression-list.json`](../data/suppression-list.json) is committed rather
than local, because a suppression list that only exists on one laptop protects
nobody, and it holds opaque `place_id` values only — never a name, a phone number
or an address. ([ADR 0007](./adr/0007-enforce-the-takedown-promise.md))

Security policy and private disclosure: **[SECURITY.md](../SECURITY.md)**.
