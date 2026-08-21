# ADR 0003 — Deploy to `us-east-1`, and design around the distance

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** the original `me-central-1` choice

## Context

This is a Dubai directory, so the instinct is to deploy in the UAE.
`me-central-1` exists, is opted-in on the account, and offers Lambda, DynamoDB,
and SQS. Dubai-to-Dubai is roughly 5 ms versus ~250 ms to Virginia.

In practice `me-central-1` did not work out for this project, so the stack moves
to `us-east-1`. **The specific failure was not recorded at the time, and that is
a gap in this record.** The only surviving account of it is commit `e54629f`,
which says `me-central-1` "proved unworkable in practice" and nothing more —
which is exactly the kind of sentence this directory exists to make impossible.
Every other ADR here names its defect: 0009 names 20,226 review snippets in a
trace file, 0011 names Rove La Mer Beach, 0008 names the commit. This one names
nothing, because nobody wrote it down while it was still true. It is left
standing rather than backfilled with a plausible reason, since a reconstructed
cause would read exactly like a measured one.

`us-east-1` also removes a standing annoyance: CloudFront's ACM certificate must
live in `us-east-1` regardless of where the rest of the stack runs. Deploying
there makes the certificate same-region rather than a cross-region special case.

## Decision

**Deploy everything to `us-east-1`.** Treat the ~250 ms origin distance as a
design constraint to engineer around rather than a number to apologise for.

Three mitigations carry the load:

1. **CloudFront absorbs the page traffic.** Milestone 3's ~10,000 programmatic
   SEO pages are the actual product, and they are ISR-cached at the Dubai edge
   POP. A cache hit never touches Virginia, so origin distance affects only cold
   renders and revalidation — not what users or Googlebot typically experience.
2. **Typeahead must not round-trip to the origin.** Per-keystroke requests at
   250 ms would feel broken. This is the real casualty of the move and it
   changes Milestone 2's design: the prefix index should be served from the edge
   or shipped to the client, not queried from an SSR Lambda in Virginia.
3. **The pipeline does not care.** Crawling is asynchronous batch work. Latency
   to SearchApi is irrelevant to a queue-driven job, and `us-east-1` is closer to
   most upstream APIs anyway.

## Consequences

**Good:**

- Cheapest AWS pricing tier; `us-east-1` is the reference region for cost tables
- Every service available immediately, with no opt-in step
- ACM certificate is same-region
- The Milestone 2 article gets a **more broadly useful** question. "UAE region
  vs Frankfurt" would have been a niche comparison; "how to serve a Gulf audience
  from `us-east-1` without it feeling slow" is a problem most readers actually
  have, since most readers deploy to `us-east-1`.

**Bad:**

- Uncached origin requests from Dubai cost ~250 ms round trip
- Typeahead needs genuine engineering rather than a naive DynamoDB query — this
  is real added scope for Milestone 2
- The "local infrastructure for a local product" story is lost

**Revisit if:** typeahead cannot be made to feel instant from the edge, or a
future milestone adds write-heavy user features where origin latency compounds.
A DynamoDB Global Table replica in `me-central-1` is the escape hatch, and it
does not require moving the rest of the stack.

## Alternatives considered

- **Stay in `me-central-1` (UAE).** Rejected on the unrecorded operational
  failure described in Context. On latency alone it wins outright — roughly 5 ms
  to a Dubai audience against ~250 ms — so it lost on something other than the
  thing it was chosen for, and this record cannot say what.
- **`eu-central-1` (Frankfurt) as a middle ground.** Deferred. It cuts the
  round trip roughly in half without an opt-in region, but it keeps the ACM
  cross-region special case, gives up the `us-east-1` reference pricing every
  cost table in this repository is quoted against, and turns the Milestone 2
  article into "UAE region vs Frankfurt" — a comparison almost no reader is
  actually making. Half the latency was not worth all three.
- **A DynamoDB Global Table replica in `me-central-1`, stack unmoved.** Deferred
  rather than rejected: this is the right long-term answer if read latency ever
  becomes the binding constraint, and it is named as the escape hatch above. It
  is not done now because nothing reads DynamoDB yet
  ([ADR 0009](./0009-bundle-the-dataset-into-the-lambda.md)), so a replica would
  add per-region write cost and a second consistency story to solve a problem
  that has not been measured.
- **Lambda@Edge or CloudFront Functions for typeahead.** Deferred, and see the
  section below — it was written into this document as though it had been
  chosen. Nothing of the sort is declared in `sst.config.ts`.

## What this contradicts in the repository

This ADR described a typeahead design that does not exist, and it did so in the
present tense, which is how the repository ends up believing it.

1. **Mitigation 2 above** says the prefix index "should be served from the edge
   or shipped to the client, not queried from an SSR Lambda in Virginia". As of
   2026-08-22 `packages/web/app/api/typeahead/route.ts` is an App Router handler
   running on the same `us-east-1` server function as every page, marked
   `dynamic = "force-dynamic"` and cached with
   `cache-control: public, max-age=3600, s-maxage=86400`. Twenty-four hours of
   CloudFront caching hides the origin distance from the second visitor for a
   given prefix and does nothing at all for the first. It is a stopgap against
   mitigation 2, not an implementation of it.
2. **The Good list** claimed "Lambda@Edge for typeahead" as a benefit already
   banked. No `Lambda@Edge` or `CloudFront Function` is declared anywhere in
   `sst.config.ts`; the phrase has been removed. The Runtime note below is still
   correct that `nodejs24.x` is available on Lambda@Edge — that is a fact about
   the runtime, not a claim about this stack.
3. **`CLAUDE.md`'s package table** lists a `packages/search` row — "One hot-path
   Lambda for typeahead". There is no `packages/search` directory. The route
   handler above is the whole of typeahead.

ADR 0009 states the general form of this failure: documentation that states
intent as fact is how it happens. This is the same failure, in the document
0009 cites.

## Runtime note

Lambda runs **`nodejs24.x`** (Node 24 "Krypton", the current LTS). `nodejs20.x`
reached end of support on 30 April 2026 and must not be used. `nodejs24.x` is
supported until April 2028 and is available in all regions, including
Lambda@Edge — which matters for mitigation 2 above.
