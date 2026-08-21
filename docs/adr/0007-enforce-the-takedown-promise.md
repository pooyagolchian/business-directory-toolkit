# ADR 0007 — Enforce the takedown promise with a committed suppression list

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

`TAKEDOWN.md` makes a business owner a specific, unqualified promise:

> Suppressed records are added to `data/suppression-list.json`, which the
> pipeline reads on **every** run. This means a removed business **stays**
> removed — it will not reappear after the next crawl.

The site footer repeats the commitment in a shorter form — "Business listings
only. Takedown requests honoured." — on every page.

**Nothing enforced any of that.** A crawl is a pure function of what Google
returns. Delete a business from DynamoDB by hand and the next `pnpm load` puts
it straight back, because the record was never removed from the input, only
from the output. The file `TAKEDOWN.md` named as the mechanism did not exist.

The timing is the uncomfortable part. `TAKEDOWN.md` shipped in the very first
commit — d2922af, 2026-08-20 — because the ambassador proposal asks for it in
the first commit. The mechanism landed in 4cd189e on 2026-08-22. For two days
the repository published a guarantee it could only have kept by accident: no
takedown request arrived in that window, which is luck, not design.

### Where ADR 0002 stopped short

ADR 0002 (`0002-do-not-redistribute-the-dataset.md`) lists among its benefits:

> Makes takedown meaningful. A removed business can actually stay removed,
> which is impossible once records are in public git history

That was half the mechanism, and the half it covered was correct. Not
committing the dataset removes the _permanence_ problem — you cannot un-publish
a record that lives in a public git object. It does nothing about the
_recurrence_ problem, which is the one an owner actually experiences: the
listing goes away, and three weeks later a re-crawl brings it back. ADR 0002
claimed the promise was enforceable; it had only made it possible.

## Decision

**Takedowns are enforced by a committed list of opaque `place_id` strings,
applied on the load path.**

Two functions in `packages/core/src/suppression.ts`, nine tests in
`packages/core/src/suppression.test.ts`:

- `parseSuppressionList(json)` → `Set<string>`
- `dropSuppressed(records, suppressed)` → `SuppressionResult<T>` with `kept`
  and `removed`

`packages/pipeline/src/cli/load.ts` reads `data/suppression-list.json`, then
applies the filter immediately after dedupe and before anything is normalised,
written to `data/out/businesses.json`, or put into DynamoDB:

```ts
const suppressed = parseSuppressionList(readFileSync(suppressionPath, "utf8"));
const surviving = dropSuppressed(deduped.unique, suppressed);
```

The decisions inside that are the ADR:

**It runs on the load path, not the fetch path.** Load is the single point both
a fresh crawl and `pnpm load --from-archive` must pass through. Filtering at
fetch time would leave the raw archive as a way back in — and the archive is
deliberately replayable: ADR 0002's mitigation for upstream drift is that
"every raw response is archived to S3 per run", and `--from-archive` exists so
a finished crawl can be re-normalised and re-loaded without spending a credit.
A fetch-time filter would have been bypassed by the repository's own documented
recovery path.

**`parseSuppressionList` throws on malformed input rather than returning an
empty set.** An empty set and a broken file look identical from the outside and
only one of them is safe. The file is hand-edited during a takedown request,
which is exactly when a typo is most likely and least likely to be noticed. A
suppression list that quietly does nothing is worse than no list at all,
because a list implies a guarantee. Blank and whitespace-only entries are
trimmed away; a non-array, or an array containing anything that is not a
string, is an error that stops the load.

**The file is committed, even though the dataset is not.** ADR 0002 already
names it as an exception in the list of what _is_ committed —
"`data/suppression-list.json` — opaque `place_id` values only". It is the one
artefact that has to survive a fresh clone and a different operator. A
suppression list that exists only on one laptop protects nobody, and under
ADR 0005 the operator running a crawl is frequently not the author of the
repository.

**It holds `place_id` strings and nothing else.** Storing a name or a phone
number in order to remember not to publish a name or a phone number would
defeat the purpose. `TAKEDOWN.md` states that to the requester in as many
words: "That file contains only opaque Google `place_id` values, never names,
phone numbers, or addresses."

**A record with no `place_id` is kept, not dropped.** `dedupeByPlaceId` already
removes those and counts them as `skippedNoPlaceId`. Suppression must never
become a second, silent reason a record disappears, so an unidentifiable record
falls through the filter untouched and is rejected — visibly — further down.

**The suppressed count prints on every run**, including `--dry-run`:

```text
Suppressed          0  (takedown requests honoured, from data/suppression-list.json)
```

An honoured takedown is a line in the load report rather than a slightly
smaller total that nobody can account for. This matters more here than it
sounds: the v0.1 crawl produced 15,246 unique businesses and the report already
lists four other reasons a record can be removed — duplicates, no `place_id` at
dedupe, non-AE at normalise, no `place_id` at normalise — so an unlabelled
difference of one would be invisible.

**`dropSuppressed` short-circuits on an empty set.** It returns a copy
immediately when `suppressed.size === 0`, so the common case — and today,
`data/suppression-list.json` is `[]` — costs one branch rather than 15,246
set lookups on every load.

## Consequences

**Good:**

- The promise in `TAKEDOWN.md` is now code with tests, not prose. The sentence
  "it will not reappear after the next crawl" is true because a function makes
  it true
- It survives the recovery path. `--from-archive` cannot resurrect a suppressed
  business, which is the failure mode a fetch-time filter would have shipped
  with
- A takedown costs one line in a JSON file and a re-run. Nothing about it needs
  the author, an AWS console, or knowledge of DynamoDB
- It is legible to an outsider. Anyone auditing the repository can read a
  two-function file and the load report and see exactly what the guarantee is
  worth
- The list is the only piece of business-derived state the repository keeps, and
  it keeps the least possible: an opaque id, no name, no phone

**Bad:**

- **Suppression is only as good as the operator.** Nothing automates the
  email-to-`place_id` lookup. A request is honoured by finding the id by hand,
  editing a JSON file, and re-running the load. The "within 7 business days"
  row in `TAKEDOWN.md` is a human promise, not an enforced one, and no timer
  anywhere fires if it slips
- **The list is public and append-only.** Every entry is a permanent, published
  record that some business asked to be removed. The id is opaque to a reader
  but it resolves back to a named business against Google's own API, so
  removal from this directory is not private. That is a real cost of committing
  the file and it should not be dressed up as anonymity
- **It suppresses on the publish path only.** A copy of `data/raw/` still
  contains the record. The promise covers what is published, not what an
  operator holds on disk, and that is the honest boundary of the guarantee
- **The end-to-end promise is unverified.** The nine tests prove the filter
  filters. No test asserts that the live site lacks a suppressed listing, and
  with the list currently empty there is nothing to assert it against
- **The list is global, not per city.** `load.ts` reads one
  `data/suppression-list.json` regardless of `--city`, so an id suppressed for
  one deployment is suppressed for every city config in the repository. That is
  right for this repository — a takedown is about a business, not about a
  crawl — and wrong for a fork that inherits the file without noticing it is
  there

## Alternatives considered

- **Filter at fetch time, before archiving.** Rejected: it would leave
  `pnpm load --from-archive` as a documented way back in, and the archive is
  deliberately replayable per ADR 0002.
- **Filter at read time in the web layer.** Rejected: the record would still be
  in DynamoDB, in `data/out/businesses.json`, and in the typeahead items — a
  removed business would remain one query away from being served.
- **Delete the DynamoDB item by hand.** Rejected: this is exactly the behaviour
  the ADR exists to fix. The next load restores it.
- **Store the business name and phone alongside the id**, so a takedown is
  auditable by a human reading the file. Rejected: it would republish the
  personal-scale data the takedown removed, and contradict a sentence already
  printed in `TAKEDOWN.md`.
- **Keep the list out of git and hold it in DynamoDB or S3.** Rejected: it
  would then exist in one operator's account, which under ADR 0005 is not where
  most crawls run. Committing it is the only way a fork inherits the promise.
- **Return an empty set on a malformed list and warn.** Rejected: a warning in
  a several-thousand-line load log is not a control. Failing the load is.
- **Per-city suppression lists.** Deferred until a second city is actually
  crawled. A global list is stricter, and the failure mode of the stricter
  choice is a business missing from a directory rather than present in one it
  asked to leave.
- **Automate the email-to-`place_id` lookup.** Deferred: it needs a lookup
  against Google for a name and phone number supplied over email, which spends
  credits on an unauthenticated request and is a plausible way to get an
  operator to suppress a competitor's listing. The manual step is also the
  identity check.
