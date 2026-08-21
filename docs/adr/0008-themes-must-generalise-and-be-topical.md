# ADR 0008 — Review themes must generalise, and must be topical

- **Status:** Accepted · amended 2026-08-22
- **Date:** 2026-08-21 (topicality gate added 2026-08-22)

## Context

Stage 5 fetches a business's reviews, strips reviewer identity at the boundary
with `stripReviewIdentity`, scores the remaining words in memory with
`deriveReviewSignals`, and discards the text. What is written is three fields:
`reviewsAnalysed`, `averageRating`, and at most `MAX_THEMES` — six terms that
distinguish this business from every other one in the corpus. No reviewer name,
contributor id, profile link or photograph reaches disk, and no review text is
republished, which is what ADR 0002
(`0002-do-not-redistribute-the-dataset.md`) requires.

Protecting the reviewer turned out not to protect anybody else.

TF-IDF rewards precisely the shape of a staff name: a term frequent for one
business and rare everywhere else. Reviewers thank individual employees by
name, and — this is the part that defeated the existing guard — several
reviewers thank the same employee, so `MIN_REVIEWS_MENTIONING = 2`, which
exists to stop one reviewer's idiosyncratic vocabulary becoming a theme, passed
those names straight through.

The first live run published a luxury hotel's themes as three of its employees'
first names, and a hospital's as two first names plus a medical procedure
inferred from its reviews. That is the personal data this project promises
never to collect, arriving through the door nobody guarded: the reviewer was
protected and the subject was not. The hospital case is the worse of the two,
because a procedure attached to a named place implies something about the
people who went there.

The names are in commit `1dedb82`, which fixed the defect. This document
reproduces the shape and not the names — there is no reason to widen the
exposure a second time.

### The first fix, and why it was not enough

The property that separates a theme from a name is generalisation. A real theme
recurs across many businesses; a person's name belongs to one. Measured on the
live corpus, **72% of theme terms appeared for exactly one business** — staff
names, brand names and noise — while genuine themes recurred: **"shisha" across
18 businesses, "seafood" across 10**.

The threshold was chosen by measurement, not by feel:

| Minimum businesses | Result on the live corpus                                 |
| -----------------: | --------------------------------------------------------- |
|                  2 | "abdul" and "sandeep" still get through                   |
|                  3 | "abdul" still gets through                                |
|              **5** | no known staff name survives; 142 themes / 560 businesses |
|                  8 | 30 themes left — over-filtered                            |

That shipped as `MIN_BUSINESSES_PER_THEME = 5`, and it was insufficient in a way
that matters more than the original defect, because the failure mode gets worse
as the corpus grows.

A _common_ name recurs on its own. Enough businesses employ a Neha or an Abdul
that the name clears a recurrence bar without any help. On the live corpus
**"neha" cleared it at exactly 5 businesses and was published as the only theme
of two medical facilities** — the same defect as before, one threshold further
out.

Raising the count fails in the wrong direction. Common names recur _more_ as
the crawl grows, so a count calibrated on 999 businesses lets every name
through at 11,890, while genuine mid-tier themes are dropped first. Any
count-based control decays with coverage. The replacement had to be
scale-invariant.

## Decision

**Two gates, in series, as a second pass over the whole corpus.** Both live in
`packages/core/src/generalise.ts`; `packages/pipeline/src/cli/reviews.ts`
applies them after every business's candidate themes are in hand, because each
needs the whole corpus and neither can run inside the fetch loop.

**Gate 1 — recurrence.** `keepGeneralisableThemes(signals,
MIN_BUSINESSES_PER_THEME)` counts, over a `Set` per business, how many distinct
businesses each term was a theme for, and drops a term seen at fewer than
`MIN_BUSINESSES_PER_THEME = 5`.

**Gate 2 — topicality.** `keepTopicalThemes(signals, businesses,
MIN_CATEGORY_CONCENTRATION)` publishes a term only if it is either

- **(a) a word the business already uses about itself** — its `title`, `l1`,
  `l2`, `l3` or `types[]`, folded by `foldWords` with exactly the review
  tokeniser's normalisation (NFKD, combining marks stripped, split on
  non-`\p{L}\p{N}`, which is what keeps it working on Arabic titles). This is
  how "sheraton" stays on the Sheraton and is dropped everywhere else; or
- **(b) concentrated in a single top-level category** at or above
  `MIN_CATEGORY_CONCENTRATION = 0.75` — the largest number of the term's
  businesses sharing one `l1`, over the number of businesses the term was a
  theme for.

Being a ratio, (b) does not decay as coverage grows, which is the property the
count did not have. A real theme belongs to a kind of business — "biryani" is
about food wherever it appears — while a name is not about anything, so it
scatters across unrelated verticals: a hospital receptionist and a hotel
concierge who happen to share a name.

**0.75 is a plateau, not a knife-edge.** Sorted by concentration, the surviving
terms leave a gap: "fountain" at 0.70, then nothing until "terrace" at 0.80. Any
threshold inside that gap behaves identically — 0.75 and 0.80 drop exactly the
same eight terms. "neha" sits at 0.60, well clear of it.

**Both gates fail closed.** A business with no `l1` still counts in the
denominator but can never form the majority, because an unclassified business is
not evidence that a term is topical. A signal whose business is absent from the
corpus keeps its rating and count and publishes no themes at all.

**`MIN_BUSINESSES_PER_THEME` is redefined, not retired.** It is now a floor for
statistical meaningfulness rather than the privacy control: a term seen at one
business has a concentration of 1.0 by arithmetic rather than by topicality, so
the ratio only means anything once there are a few businesses to spread across.
`keepTopicalThemes` is what actually stops a name. Both constants are pinned by
assertions in `generalise.test.ts`, because they are the privacy policy and
nothing would otherwise fail if someone edited them.

**Both gates keep the business and drop only its themes.** The review count and
the mean rating are still worth having.

**The cost, stated rather than hidden:** 917 theme instances become 830, and
eight terms disappear entirely — "neha" plus "fountain", "brunch", "iftar" and
four subjective adjectives that were poor themes anyway.

Neither gate required re-fetching. Both operate on derived themes rather than on
text, so they were applied to already-fetched signals — which is also why the
reviews stage's deliberate refusal to archive raw responses (ADR 0012), taken
because archiving them would mean writing reviewer identity to disk, did not
make this fix expensive.

## Consequences

**Good:**

- The fix is a property, not a blocklist. It needs no name list, works in any
  language or script, cannot be defeated by an unusual name, and removes one-off
  brand and place tokens for free. A blocklist manages none of that and fails on
  the first name it has never seen
- The control is scale-invariant where it matters. A ratio does not weaken as
  the crawl grows, so a bigger corpus does not quietly reopen the defect the way
  a count would
- Both thresholds are calibrated against measured output rather than intuition,
  and both are pinned by tests, so changing the privacy policy now requires
  editing a test that says so
- The gates are pure functions over derived signals, so they cost nothing to
  re-run and no API credits to correct
- Suppressing themes does not suppress the business, so a page keeps its rating
  and review count even when every candidate theme fails

**Bad:**

- **A name that is common within a single vertical still gets through.** It
  recurs, and it concentrates in one `l1`, so it satisfies both gates. Catching
  it would need the review text, which this pipeline deliberately does not
  keep — the privacy control and the detection capability are the same thing,
  and we chose the control. This is a residual, not a solved problem
- The topicality gate drops genuine themes to buy that safety. "brunch" and
  "iftar" are real Dubai concepts and are gone. Precision was traded for a
  guarantee, knowingly
- Both thresholds are calibrated against one city's corpus, and nothing
  revalidates them on a new city. A directory whose `l1` vocabulary is coarser
  would concentrate everything and let more through — the gate is weakest
  exactly where the taxonomy is weakest, which for a toolkit other people run
  (ADR 0005, `0005-toolkit-not-directory.md`) is the wrong place to be weak
- The defect was found by reading live output, not by a test. The suite was
  green throughout, before and after. The standing check is therefore a human
  reading published themes after every reviews run — a process control, not an
  engineering one
- The employees' names are permanently in git history, in the commit that fixed
  the defect. The fix removes them from the site, not from the record of the
  mistake. That is the price of documenting it credibly
- Themes are the only genuinely unique content a business page has. Two gates in
  series remove a large share of them, so the pages that most need
  differentiating content have the least of it

## Alternatives considered

- **A blocklist of given names.** Rejected: it fails on the first name it has
  never seen, and this corpus is bilingual and multi-script, so the list would
  need to be complete in every language a reviewer might write in.
- **Raise `MIN_BUSINESSES_PER_THEME` instead of adding a second gate.**
  Rejected: it fails in the wrong direction. Common names recur more as the
  crawl grows, and genuine mid-tier themes are dropped before the names are.
- **Named-entity recognition, or an LLM pass, over the review text.** Rejected:
  it requires keeping the text, which is the thing ADR 0002 and the reviews
  stage exist to avoid — and a per-business model call is exactly the cost shape
  ADR 0006 (`0006-category-saturation.md`) was written to escape.
- **A capitalisation heuristic — names are capitalised in review text.**
  Rejected: the tokeniser lowercases before scoring, review capitalisation is
  unreliable, and the heuristic would again need the text kept.
- **A manual suppression list of offending terms.** Rejected: that is the
  blocklist again, only maintained by hand and per city. The existing
  `data/suppression-list.json` suppresses opaque `place_id` values for takedown
  (ADR 0002), which is a different job.
- **Delete a business's signals entirely when its themes all fail.** Rejected:
  the review count and mean rating are independent of the theme problem and are
  still worth publishing.
- **Drop themes from the product altogether.** Rejected: they are the only
  original derived content on a business page, and ADR 0002 rules out
  republishing review text, so removing them leaves the page with nothing of our
  own on it.
- **Revalidate both thresholds against a second city's corpus.** Deferred until
  a second city is crawled. Until then the calibration is honestly single-city,
  and that is stated above rather than assumed away.
