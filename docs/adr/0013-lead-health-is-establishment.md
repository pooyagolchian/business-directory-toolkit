# ADR 0013 — Lead health is establishment, not rating

- **Status:** Accepted
- **Date:** 2026-08-22
- **Builds on:** [ADR 0010](./0010-credibility-weighted-ranking.md), which
  introduced `rankScore` and is still correct for the directory
- **Supersedes:** the scoring formula in
  `docs/superpowers/specs/2026-08-22-lead-generation-design.md`

## Context

`pnpm leads` scores businesses that carry a fixable gap — no website, weak
reputation, low visibility, no opening hours — so an agency can work the list
top-down. The product claim is that **the best lead is a successful business
with a fixable gap**: a 4.8-rated restaurant with 500 reviews and no website is
worth more than a 3.1-rated one with 20.

The approved spec expressed that as `leadScore = signalStrength × businessHealth`
with `businessHealth = rankScore`, the credibility-weighted rating from ADR 0010.
The reasoning was that a lone 5-star review must not float a barely-reviewed
prospect to the top of a call list. That reasoning is sound. The conclusion was
wrong, and it was wrong in a way no test could see.

`rankScore` is a shrunk **rating**: `(v/(v+m))·R + (m/(v+m))·C`, pulling a
business toward the corpus mean `C` by how little evidence `v` it has. Every
`weak-reputation` lead sits below that mean by definition — the signal fires at
rating < 3.8, and the Dubai corpus prior is `{mean: 4.4857, weight: 76}`. A
business below the mean is pulled **up** toward it, and the more reviews it has
the less it is pulled. So `rankScore` **falls** as a business becomes more
established, and multiplying by it demoted exactly the businesses the feature
exists to surface.

Measured over the 641 real `weak-reputation` leads from the v0.1 crawl:

|                                                                                    |          Before |     After |
| ---------------------------------------------------------------------------------- | --------------: | --------: |
| `corr(score, reviews)`                                                             |       **−0.28** | **+0.08** |
| Rank of the most-reviewed lead (Mediclinic Parkview Hospital, 3.6★, 5,562 reviews) | **#522 of 641** |  **#271** |

At all 18 distinct rating values present in the corpus, the most-reviewed
business ranked **below** the least-reviewed business carrying the identical
rating. Eighteen buckets, eighteen inversions. The call sheet was topped by bank
ATMs with 23–37 reviews — businesses that cannot buy reputation management.

**The whole test suite passed throughout — 323 tests.** The implementation was a
faithful rendering of the spec; the defect was in the spec. It became visible
only by running the tool across 14,981 real businesses and correlating the
output against review count. That is the transferable part of this record: a
ranking function cannot be validated by unit tests, because unit tests check
that it computes what you said, and the failure here was that what you said was
backwards.

## Decision

**Define the health term as _establishment_ — evidence of real trade — rather
than as a rating.**

```text
establishment = reviews / (reviews + m)          // m = the prior's weight
leadScore     = signalStrength × establishment
leadScore     = signalStrength                   // low-visibility only
```

The rating belongs inside the **signal**, where it describes the gap. Putting it
in the health term as well double-counts the very deficiency being sold against.
Stated as a rule, because it is easy to break twice:

> **The health term must never be a function of the quantity the signal
> measures.**

That rule is also why `low-visibility` is an exception rather than an oversight.
Its gap **is** the review count, so `establishment` — built from review count —
would double-count it in precisely the way `rankScore` did for
`weak-reputation`: the same error rotated onto the other axis. When the uniform
formula was applied there, the product of the two terms peaked at exactly 5
reviews (the entire top 40 had 5) and pushed the 481 businesses with no reviews
at all to positions 1,778–2,258 of 2,259 — the clearest instances of the gap,
ranked last. That signal therefore drops the multiplier and ranks by severity.

Ties break by rating descending (a business with no rating sorts last — unrated
is not better than well-rated), then by `placeId`, giving a total order that is
identical on every run rather than an artefact of crawl order.

## Consequences

**Good:**

- Review volume stopped counting against a prospect. `corr(score, reviews)` on
  `weak-reputation` moved from −0.28 to +0.08.
- The top of every list changed to a business worth calling:
  `no-website` from a barbershop (5.0★, 2,164 reviews) to Angelina Paris Tearoom
  (4.8★, 11,832); `no-hours` from Rove Downtown (4.9★, 27,029) to Atlantis The
  Palm (4.7★, 102,494).
- `low-visibility` now leads with the 481 businesses that have no reviews at all,
  at ranks 1–481 of 2,259, exactly reversed from where the uniform formula put
  them.
- The ordering is now a total order, reproducible across runs and machines.
- The rule generalises to any future signal, and names the test to apply when
  adding one.

**Bad:**

- **Rating plays no part in the `no-website` and `no-hours` scores at all.**
  Their `signalStrength` is the constant 1.0, so the score reduces to
  `establishment` — pure review volume. The observed
  `corr(score, rating) = 0.282` on `no-website` is incidental, arising because
  larger businesses in this corpus happen to be better rated, not because the
  formula consults rating. Nothing structurally prevents a poorly-rated business
  with heavy review volume from topping that list. It has not bitten on this
  crawl — the lowest-rated member of the current top 50 is a 3.6★ hotel at rank
  46 — but the guard does not exist.
- **The top 481 `low-visibility` leads are tied and fall through to `placeId`
  order.** They are correctly at the top, but their order relative to each other
  is arbitrary and must be read as a set, not a queue. In this crawl no business
  has an explicit zero review count alongside a real rating, so the rating
  tie-break has nothing to discriminate on within that band.
- **Two formulas to explain instead of one.** The `low-visibility` exception is
  a genuine asymmetry, and every description of the scoring has to carry it or
  be wrong.
- `establishment` treats an absent review count as zero, so a business the crawl
  returned incomplete data for scores 0 on the three multiplied signals and is
  effectively unreachable at the top of those lists.

**Revisit if:** a signal is added whose gap is neither rating nor review count,
in which case the health term for it needs choosing afresh under the rule above;
or if tie-breaking the zero-review band by other evidence of trading — a
website, a phone, opening hours — proves worth the complexity. That refinement
was deliberately not made here.

## Alternatives considered

- **Keep `rankScore` and drop the "successful businesses first" claim.**
  Rejected. It is the cheapest fix and makes the tool markedly less useful: a
  1.0-rated ATM with 36 reviews cannot buy reputation management, and a list
  that puts it first is not a lead list. Changing the claim to match a bad
  ranking, rather than the ranking to match a true claim, is the failure ADR
  0003 documents in this repository's own history.
- **A per-signal health term — `rankScore` where rating is not the gap,
  `establishment` where it is.** Deferred rather than rejected. Measurement
  showed `establishment` improves `no-website` and `no-hours` too, so the extra
  formula bought nothing on this corpus. It becomes the right answer if the Bad
  entry above ever bites — a heavily-reviewed, badly-rated business topping a
  `no-website` list — since `rankScore` would suppress exactly that case.
- **Rank `low-visibility` by the uniform formula anyway,** on the argument that
  a business with zero reviews may never have traded. Rejected on the
  measurement: it put the 481 clearest instances of the gap last, and "no
  reviews at all" is the strongest pitch a review-generation service has.
- **Raw star rating as the health term.** Rejected for the reason ADR 0010
  exists: a lone 5-star review would dominate. That objection was always
  correct; the error was answering it with a shrunk rating instead of asking
  whether rating belonged in the term at all.
