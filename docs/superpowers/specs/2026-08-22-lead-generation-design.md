# Lead generation — design

- **Status:** Implemented. `packages/core/src/leads.ts` and
  `packages/pipeline/src/cli/leads.ts` ship this design and `pnpm leads` is a
  real command. Where the shipped code differs from what this document
  originally specced, the difference is called out inline below rather than
  silently edited away — this file is a record of what was decided and why,
  not just a description of the current build.
- **Date:** 2026-08-22
- **Scope:** Subsystem 1 of 3 in the growth toolkit. Market intelligence and SEO
  opportunity are deliberately out of scope and get their own specs.

## Why

The toolkit currently produces a directory. The same crawl also answers a
commercially useful question it has never been asked: **which businesses have a
fixable gap?**

Measured on the Dubai v0.1 crawl (14,981 businesses):

| Signal                               |       Count |
| ------------------------------------ | ----------: |
| No website at all                    | 4,633 (31%) |
| No website, has a phone, 20+ reviews |   **2,043** |
| Rating below 3.8 with 20+ reviews    |         673 |
| Fewer than 10 reviews                | 3,095 (21%) |

Those 2,043 are established businesses — real review volume, contactable — with
no web presence. That is a qualified prospect list for any web agency or
freelancer in Dubai, and it falls out of data already on disk.

This also answers "why is this app useful" more concretely than the directory
does. A directory competes with Google Maps. A lead list does not.

## The core idea

**The best lead is a successful business with a fixable gap.**

A 4.8-rated restaurant with 500 reviews and no website is a far better prospect
than a 3.1-rated one with 20 reviews. Both match `no-website`. Filtering alone
cannot express the difference; a score can.

```text
leadScore = signalStrength × businessHealth
```

**As built, the health term is `establishment`, not `rankScore` — and this
section records why, because the original choice was wrong and only measurement
showed it.**

```text
establishment = reviews / (reviews + m)      // m = the prior's weight
leadScore     = signalStrength × establishment
leadScore     = signalStrength               // low-visibility only
```

This spec originally proposed `businessHealth = rankScore`, the directory's
credibility-weighted rating, on the reasoning that a lone 5-star review should
not float a barely-reviewed prospect to the top. That reasoning is sound and the
conclusion was still wrong. `rankScore` is a shrunk _rating_, and every
`weak-reputation` lead sits below the corpus mean by definition — so `rankScore`
shrinks it toward that mean less as its review count grows, and therefore
_falls_ as a business becomes more established. Multiplying by it demoted
exactly the businesses this feature exists to surface.

Measured on the 641 real `weak-reputation` leads before the change:
`corr(score, reviews) = −0.28`; the list was topped by bank ATMs with 23–37
reviews; the most-reviewed business on it, a 3.6-rated hospital with 5,562
reviews, ranked #522 of 641. At all 18 distinct rating values in the corpus, the
most-reviewed business ranked below the least-reviewed one carrying the same
rating. After the change: `corr(score, reviews) = +0.08`, and that hospital
ranks #101.

It does not move to first, correctly — at 3.6 it is barely below the 3.8
threshold, so its `signalStrength` is small, and a severe problem at a mid-sized
business should outrank a mild one at a large business. The defect was never
that large businesses ranked low; it was that review volume counted _against_
them.

Every unit test passed throughout. The formula matched this spec exactly and the
implementation was faithful to it. The defect was in the design, and it was only
visible by running the tool over 14,981 real businesses and correlating the
output — which is the argument for measuring a ranking against real data before
publishing it, not merely testing it.

The rule that replaces it:

> **The health term must never be a function of the quantity the signal
> measures.** Otherwise the score double-counts the gap and inverts itself.

`weak-reputation` sells against a poor rating, so its health term must not use
rating — hence `establishment`, built from review count. `low-visibility` sells
against a low review count, so `establishment` would double-count _its_ gap in
exactly the same way; that signal alone therefore drops the health term and
ranks by severity, with ties broken by rating descending (unrated sorts last)
and then `placeId`, so the order is total and reproducible.

That exception has a knock-on worth recording: 481 businesses in the Dubai crawl
have no reviews at all, so they tie at the maximum score and fall through to
`placeId` order. They lead the `low-visibility` list correctly — they are the
strongest instance of the gap — but their order among themselves is arbitrary
and should be presented as a set rather than a ranking. Tie-breaking that band
by other evidence of trading (a website, hours, a phone) is a plausible future
refinement and was deliberately not done here.

Scores are only ever compared **within** a signal. Ranking a `no-website` lead
against a `weak-reputation` lead would be comparing different products being
sold to different buyers, so the CLI refuses to mix signals in one ranked list.

## Components

### `packages/core/src/leads.ts` — pure, TDD'd

**Signals.** Each is a need somebody sells against:

| Signal            | Condition                      | Who buys                     |
| ----------------- | ------------------------------ | ---------------------------- |
| `no-website`      | No `website` field             | Web design, agencies         |
| `weak-reputation` | Rating < 3.8 with ≥ 20 reviews | Reputation management        |
| `low-visibility`  | < 10 reviews                   | Local SEO, review generation |
| `no-hours`        | No `openHours`                 | Listing-management services  |

Signals are additive: a business can carry several, and each produces its own
scored entry rather than one merged row. An agency selling websites and an
agency selling reputation work want different lists.

**Exclusions, not signals.** `no-phone` disqualifies rather than scores — a
lead you cannot contact is not a lead (`isContactable`, below). The original
draft of this section also named `not-in-city` as a second exclusion;
`findLeads` does not check it, deliberately. `data/out/businesses.json` is
already city-filtered before this code ever sees it — `load.ts`'s own
acceptance gate rejects every row outside the crawl's `countryCode` at load
time (see the README's crawl-pipeline section) — so a second in-`findLeads`
check would be dead code checking a condition that can no longer occur.

**API** (matches `packages/core/src/index.ts` and `packages/core/src/leads.ts`
as of this revision)

```ts
export const LEAD_SIGNALS: readonly [
  "no-website",
  "weak-reputation",
  "low-visibility",
  "no-hours",
];
export type LeadSignal = (typeof LEAD_SIGNALS)[number];

/** A lead you cannot contact is not a lead — checked before anything scores. */
export function isContactable(business: Business): boolean;

export function detectSignals(business: Business): LeadSignal[];

export function leadScore(
  business: Business,
  signal: LeadSignal,
  prior: RankPrior,
): number;

export interface Lead {
  business: Business;
  signal: LeadSignal;
  score: number;
  /** Why this scored as it did — shown in output so the list is auditable. */
  reason: string;
}

export interface LeadOptions {
  /** Exactly one. Scores are not comparable across signals. */
  signal: LeadSignal;
  /** Corpus prior for businessHealth; built once from the whole dataset. */
  prior: RankPrior;
  /** place_ids that must never appear — takedown requests. Applied inside findLeads, before filtering or scoring. */
  suppressed?: Set<string>;
  category?: string;
  area?: string;
  minReviews?: number;
  minRating?: number;
  limit?: number;
}

export interface LeadResult {
  leads: Lead[];
  /** How many were withheld by the suppression list, so the filter stays visible. */
  suppressed: number;
  /** How many businesses were examined after filters, before signal matching. */
  considered: number;
}

export function findLeads(
  businesses: Business[],
  options: LeadOptions,
): LeadResult;
```

Two things here differ from the original design above, both deliberately:

- **`findLeads` returns `LeadResult`, not a bare `Lead[]`.** The Hard
  Constraints section below already required every run to report how many
  leads were withheld by suppression, including "0 withheld" — a bare array
  has nowhere to carry that count. `considered` exists for the same reason:
  "3,820 no-website leads" means nothing without a denominator, and the CLI
  needs one to print (see the README's per-signal table).
- **`LeadOptions` carries `suppressed` directly**, and `findLeads` runs
  `dropSuppressed` on it internally, before any filter or score is applied.
  The original wording ("Leads pass through `dropSuppressed` ... before they
  are ever scored") was ambiguous about whether the caller or `findLeads`
  itself was responsible for that step; making it part of `findLeads`'s own
  contract closes the gap where a caller could forget to call it first.

`signalStrength`, `establishment` and `leadScore` are all exported from
`packages/core/src/index.ts` as well, so the scoring can be unit-tested and
reused independently of the CLI.

`findLeads` takes the prior as a parameter rather than computing it internally,
for the same reason the web app does: a prior built from the filtered subset
would rescale with every query, so `--category Restaurants` and
`--category Salons` would produce scores that cannot be compared. It is built
once from the whole corpus and passed in.

### `packages/pipeline/src/cli/leads.ts`

```bash
pnpm leads --signal no-website --category Restaurants --area dubai-marina --min-reviews 20
pnpm leads --signal weak-reputation --format csv --out data/out/reputation-leads.csv
pnpm leads --list-signals
```

The first example originally read `--area marina`. Run against the real
Dubai crawl, that returned 0 businesses considered: `area` values are the
same slugs `data/cities/<id>.json` defines for its tiles (`dubai-marina`,
`downtown`, `deira`, …), not a shorthand. `--area dubai-marina` is the
corrected value — verified 2026-08-22 against `data/out/businesses.json`.

The second example's `--out` path was changed from a repo-root `reputation-
leads.csv` to `data/out/reputation-leads.csv`. `--out` writes real crawled
business records — name, address, phone, coordinates — and a repo-root path
is not covered by `.gitignore`'s dataset rules; `data/out/` already is. Writing
into it means the documented happy path cannot produce an accidentally
committed export.

Reuses the CSV writer from the export CLI, so RFC 4180 quoting and the UTF-8
BOM come free — the file has to open correctly in Excel, which is where these
lists get used.

Output columns: the export columns plus `signal`, `score`, `reason`.

## Hard constraints

**Suppression applies to lead exports.** A business that requested removal under
`TAKEDOWN.md` must never resurface on a cold-call list — that would make the
takedown promise worse than meaningless. Leads pass through `dropSuppressed`
(`packages/core/src/suppression.ts`) before scoring, and the CLI reports how
many were withheld so the filter is visibly working rather than silently
trusted.

**Business listings only.** No personal names in output, no residential
numbers. The export carries the business phone the crawl already holds and
nothing more.

**Consent notice.** The CLI prints a notice on every run that produces a list:
these are business listings, not permission to contact, and unsolicited
commercial messaging is regulated wherever the businesses operate — worded
that way rather than naming the UAE specifically, because the crawl itself is
city-agnostic (a city is data, not code) and the same CLI runs against
whatever `data/cities/<id>.json` a user brings. This is a notice, not a
compliance feature — it exists because shipping a cold-outreach tool with no
mention of that would be careless.

**No new crawl.** Everything scores from `data/out/businesses.json`. Zero
credits.

## Testing

Signal detection and scoring are pure functions tested against fixtures —
offline, no credits, consistent with the existing suite. Specifically:

- Each signal fires on the condition and only that condition
- A healthy business outscores an unhealthy one carrying the same signal
- `no-phone` disqualifies regardless of other signals
- A suppressed `place_id` never appears in output
- Ranking is stable and never `NaN` on missing fields

The CLI gets a smoke test asserting the header row and that `--list-signals`
exits 0.

## Explicitly out of scope

- Outreach tracking, contacted-lists, CRM state. That turns the repo into a
  SaaS and is a different product.
- Email discovery or contact enrichment. It invites scraping personal data,
  which hard rule 5 forbids.
- Market intelligence and SEO opportunity — separate specs.

## Follow-on: MCP server

Once the CLI exists, the same query surface gets exposed as an MCP server so a
user can point Claude at their own crawl and ask in natural language. The CLI
is the product; the MCP layer is the demonstration. It is deliberately second:
building it first would make Claude a hard dependency of a repo that currently
needs none, and would be harder to test offline.
