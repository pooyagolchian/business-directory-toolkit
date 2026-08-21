# ADR 0005 — Ship a toolkit for any city, not a Dubai directory

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The project began as a Dubai business directory. Two problems with that framing
surfaced once the pipeline worked.

**The directory has no defensible product value.** It is derived Google Maps
data, competing with Google Maps, in a market with incumbents. ADR 0002 already
established that the dataset cannot be redistributed — so the repository ships
code that produces data the repository is not allowed to contain. As a product
that is a dead end.

**Users asked to export the data.** That request collides head-on with ADR 0002
if the data flows from _our_ crawl. It does not collide at all if the data flows
from _theirs_.

That second observation is the whole decision.

## Decision

**The deliverable is an open-source toolkit for building a local business
directory for any city. `directory.pooyagolchian.com` is its reference
deployment, not the product.**

A city becomes data rather than code. `data/cities/<id>.json` carries the tiles,
the categories, the bounding boxes, the country code, and the phone region.
Nothing downstream hard-codes a city:

- `isInCity(record, city)` replaced `isDubaiListing(record)`
- `normalizePhone(raw, region)` takes an explicit region — a defaulted `"AE"`
  would have silently mangled every number in a Manchester crawl
- `loadCity(id)` and `pnpm plan --list` make the extension point discoverable

Users bring their own SearchApi key, crawl their own city, and export their own
data in CSV or JSON.

## Consequences

**Good:**

- **Export becomes legal.** Users export data they crawled themselves under
  their own key. We redistribute nothing, so ADR 0002 holds without compromise.
- **It aligns with the metric that actually leads the report.** The proposal
  states plainly that "clicks and signups through your tracked link lead every
  monthly report", with stars and forks explicitly behind them. A toolkit that
  is useless without a SearchApi key means every serious user must create an
  account. Not shipping the dataset now _drives_ the lead metric rather than
  suppressing it.
- The addressable audience stops being "people who want Dubai listings" and
  becomes "people building a directory anywhere".
- The crawl strategy — tiling against the ~200-result ceiling, adaptive
  pagination, the taxonomy pass — becomes the product. That is defensible in a
  way a scraped dataset never was.

**Bad:**

- Every Dubai-specific assumption had to be found and parameterised. That
  refactor is done, but it is ongoing tax on new features.
- Only one city config is verified. Coordinates for a city we have not crawled
  would be guesswork, and this repository is publication material, so a
  documented template ships instead of invented data.
- "Toolkit" is a harder thing to demo in a video than a website. The reference
  deployment exists partly to solve that.

## Alternatives considered

- **Keep it a Dubai directory and refuse export.** Rejected. It leaves the
  contradiction in ADR 0002 exactly where it was — a repository shipping code
  that produces data the repository may not contain — and it competes with
  Google Maps on Google Maps' own data. The export request is a symptom of that
  framing, not a feature request that could be declined cleanly.
- **Ship a hosted API or a paid dataset instead of a toolkit.** Rejected on
  ADR 0002: we would be the redistributor, which is the one thing that decision
  forbids. It also inverts the lead metric — a hosted API means _we_ hold the
  SearchApi key, so nobody signing up through the tracked link ever needs one.
- **Classify per business rather than per category, so a city needs no taxonomy
  config at all.** Rejected on ADR 0006's measurement: 15,246 businesses against
  1,788 distinct strings, 8.5× more items in front of the model, and a cost that
  scales with every future crawl rather than saturating.
- **Parameterise only the crawl, and leave the web layer Dubai-specific.**
  Deferred, and this is what actually shipped for v0.1: page titles, the JSON-LD
  `addressRegion`, `lib/data.ts`'s phone parser and the classifier prompt all
  still say Dubai. It lost as a _decision_ because "a city is data" is not true
  if a fork is still required to publish; it survives as a state because
  finishing it was not on the v0.1 path. The root README says so in its opening
  paragraph rather than in a footnote.

## What did not change

The three monthly milestones, the measured findings, the takedown flow, and
ADR 0002 all stand. This is a reframing of what the repository _is_, not a
change to what gets built or published.
