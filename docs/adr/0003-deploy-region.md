# ADR 0003 — Deploy to `us-east-1`, and design around the distance

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** the original `me-central-1` choice

## Context

This is a Dubai directory, so the instinct is to deploy in the UAE.
`me-central-1` exists, is opted-in on the account, and offers Lambda, DynamoDB,
and SQS. Dubai-to-Dubai is roughly 5 ms versus ~250 ms to Virginia.

In practice `me-central-1` did not work out for this project, so the stack moves
to `us-east-1`.

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
- Every service available immediately, including Lambda@Edge for typeahead
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

## Runtime note

Lambda runs **`nodejs24.x`** (Node 24 "Krypton", the current LTS). `nodejs20.x`
reached end of support on 30 April 2026 and must not be used. `nodejs24.x` is
supported until April 2028 and is available in all regions, including
Lambda@Edge — which matters for mitigation 2 above.
