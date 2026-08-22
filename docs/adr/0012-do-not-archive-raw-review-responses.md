# ADR 0012 — Do not archive raw review responses, unlike every other stage

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Every stage of this pipeline archives what it fetches. Stage 1 writes each raw
engine response to `data/raw/${runId}/` before anything parses it
(`packages/pipeline/src/cli/crawl.ts:107`), and that archive is load-bearing:
ADR 0002 names it as the mitigation for upstream drift, `pnpm load
--from-archive` replays it without spending a credit, and ADR 0006's saturation
measurement cost zero credits precisely because the corpus was already sitting
on disk.

**Stage 5 does not.** `pnpm reviews` writes exactly one file —
`data/out/review-signals.json` (`packages/pipeline/src/cli/reviews.ts:161`) —
and it holds no review text and no reviewer. The raw responses are read into
memory, analysed, and dropped when the process exits.

Read against the rest of the pipeline that looks like a stage somebody forgot to
finish. It is not. It is the one place where the archive-everything default was
deliberately refused, and ADR 0008 already cites this number for it:

> …the reviews stage's deliberate refusal to archive raw responses (ADR 0012),
> taken because archiving them would mean writing reviewer identity to disk…

That citation has pointed at nothing since 2026-08-21. This file is written on
2026-08-22 and dated to the day the decision was taken, the same way ADR 0001
was — the number was reserved rather than reassigned, and lead-generation
scoring was renumbered 0012 → 0013 to keep it free.

### What the raw response actually contains

The engine returns, per review: a rating, the text, an ISO date, a like count —
and a reviewer **name, contributor id, profile link and photograph**. A reviewer
is a private individual. Hard rule 5 of `CLAUDE.md` is "business listings only.
No residential numbers, no personal data", and a contributor id resolving to a
named person with a photograph is exactly the data that rule exists to keep out.

Archiving is not a neutral act here. An archive is durable by design — that is
its entire value in Stage 1 — so archiving reviewer identity means choosing to
hold it, in `data/raw/`, in the S3 raw bucket, and in every backup either one
lands in. The takedown promise in `TAKEDOWN.md` covers business listings and
would not have covered any of it.

### The harm is not hypothetical

ADR 0009 found the concrete version of it. A `process.cwd()` fallback in
`dataFile()` defeated Next's static tracing, which gave up and wildcarded the
directory: `page.js.nft.json` listed **1,679 files, 1,400 of them raw crawl
archive, carrying 20,226 verbatim Google review snippets, some of which name
individual employees** — all of it about to ship inside a Lambda, none of it
read by any code. That was Stage 1's archive, holding search-result snippets. A
Stage 5 archive would have been the same failure with the reviewer's name,
photo and profile link attached to every line.

## Decision

**The reviews stage analyses raw responses in memory and persists only derived
signals. There is no `data/raw/` equivalent for Stage 5 and no `--from-archive`
replay for it.**

Two functions in `packages/core/src/reviews.ts` carry it:

- `stripReviewIdentity(raw)` → `AnonymousReview | null`, keeping `rating`,
  `text`, and optionally `isoDate` and `likes`.
- `deriveReviewSignals(...)` → `ReviewSignals`, which is
  `{ reviewsAnalysed, averageRating, themes }` and contains no review text and
  no reviewer.

`AnonymousReview` is documented in the type itself as **"Never persisted"**, and
the module header states the constraint before any code: _"Reviews are used as a
SOURCE, never as content."_

The decisions inside that are the ADR:

**Identity is stripped at the boundary, not before storage.** `stripReviewIdentity`
runs on the response as it arrives, so no later code path can be the one that
forgets. A strip-before-write design would leave the unstripped object alive in
memory for the rest of the stage and would make every future writer a place the
rule could be broken.

**The anonymous shape is built by allow-list, never by deleting keys.** The
comment on that line says why: _"a new field in the API response must not
silently become a new field in our store."_ A `delete record.author` approach
holds only until the engine adds `author_v2`. An allow-list fails closed — a new
identity field is simply not copied, and nobody has to notice it shipped.

**A review with no text is dropped rather than kept.** `stripReviewIdentity`
returns `null` for a bare star rating, because it carries nothing the business's
own aggregate rating does not already have. Keeping it would mean holding a
record whose only content is derived from a person's activity.

**The refusal is about the archive, not about the fetch.** Nothing here reduces
what the engine sends. The decision is only that what it sends does not become a
file, which is the part this repository controls.

## Consequences

**Good:**

- Reviewer identity never reaches disk, S3, git history, or a Lambda bundle.
  There is no artefact to leak, subpoena, or forget to delete, because the
  durable thing was never created.
- What ships is genuinely original work. `themes` is derived, not quoted, so it
  cannot be reassembled into a copy of Google's review corpus — the same
  reasoning that produced ADR 0002, applied to text instead of records.
- It removes a whole class of takedown problem. `TAKEDOWN.md` and ADR 0007
  enforce removal for businesses via `place_id`; there is no equivalent
  mechanism for a reviewer, and this decision means none is needed.
- The allow-list keeps working without maintenance. An engine that starts
  returning a new identity field does not silently widen what is stored.

**Bad:**

- **Re-analysis costs credits again.** This is the real price, and it is the
  exact benefit Stage 1's archive exists to provide. Change a stopword, a theme
  gate, or a scoring constant, and there is no corpus to re-run against — the
  requests must be re-issued and re-paid for. ADR 0008 escaped that only by
  luck of shape: both of its gates operate on already-derived themes rather than
  on text, which is why that fix "did not make this fix expensive". A change
  that needed the text would have.
- **The guarantee is stage-local, and the repository is not review-free.**
  Stage 1's archive already holds verbatim review snippets — ADR 0009 counted
  20,226 of them — so "this project does not keep review text on disk" is false
  as stated about the repository and true only about Stage 5. This decision
  stops the exposure multiplying with a reviewer's name attached; it does not
  retroactively clean `data/raw/`.
- **Nothing enforces the absence.** Five tests cover what `stripReviewIdentity`
  keeps and drops — including one for reviewer photos "which can contain
  identifiable people" — and `deriveReviewSignals` has a test asserting it
  "never returns the review text itself". None of them assert that Stage 5
  writes exactly one file, so a future contributor adding a debug dump of raw
  responses would break this decision without failing the suite. That is the
  same shape of gap ADR 0007 was written to close for takedowns, still open
  here.
- Debugging a bad theme means re-fetching to see the input that produced it.

## Alternatives considered

- **Archive the raw responses and strip identity on read.** Rejected: the
  archive _is_ the exposure. Stripping on read protects the derived output and
  leaves names, contributor ids and photographs sitting in `data/raw/` and S3
  indefinitely, which is the durable artefact this decision exists to prevent.
- **Archive the stripped `AnonymousReview[]` instead.** Rejected, and this is
  the closest call. It would restore cheap re-analysis with no reviewer
  attached. It loses because the text is itself the liability: it is Google's
  users' content, republication is what ADR 0002 forbids, and a stored corpus of
  review text is one careless `outputFileTracingIncludes` away from the ADR 0009
  incident all over again. **Deferred rather than closed** — if theme tuning
  becomes credit-expensive enough to matter, a stripped, short-lived, explicitly
  non-shipped cache is the version to revisit, and it needs its own ADR.
- **Archive to S3 with a lifecycle expiry rather than to disk.** Rejected: it
  weakens the claim without changing its kind. "We hold reviewer identity for
  thirty days" is still holding it, and it would have to be disclosed as such.
- **Skip reviews entirely and use only the aggregate rating.** Rejected on what
  it costs: `ReviewSignals.themes` is the one piece of page content in this
  project that is neither Google's data nor boilerplate, and ADR 0010's ranking
  and ADR 0013's lead health both need review volume to mean something.
