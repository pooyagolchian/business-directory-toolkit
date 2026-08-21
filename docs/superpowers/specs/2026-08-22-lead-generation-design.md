# Lead generation — design

- **Status:** Approved, not yet implemented
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

```
leadScore = signalStrength × businessHealth
```

`businessHealth` reuses the existing `rankScore` (credibility-weighted rating,
`packages/core/src/rank.ts`) rather than raw stars, so a lone 5-star review
cannot inflate a prospect to the top of a call list.

`signalStrength` is how badly this business has the problem, normalised to
0–1 so signals stay comparable:

| Signal            | Strength                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `no-website`      | Constant `1.0`. A business either has one or does not; there is no partial.                                             |
| `weak-reputation` | How far below the 3.8 threshold, scaled over the range down to 1.0 — a 2.0-rated business scores higher than a 3.7 one. |
| `low-visibility`  | How far below 10 reviews — 0 reviews scores 1.0, 9 reviews scores 0.1.                                                  |
| `no-hours`        | Constant `1.0`, same reasoning as `no-website`.                                                                         |

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

**Exclusions, not signals.** `no-phone` and `not-in-city` disqualify rather than
score — a lead you cannot contact is not a lead.

**API**

```ts
export type LeadSignal =
  "no-website" | "weak-reputation" | "low-visibility" | "no-hours";

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
  category?: string;
  area?: string;
  minReviews?: number;
  minRating?: number;
  limit?: number;
}

export function detectSignals(business: Business): LeadSignal[];
export function leadScore(
  business: Business,
  signal: LeadSignal,
  prior: RankPrior,
): number;
export function findLeads(businesses: Business[], options: LeadOptions): Lead[];
```

`findLeads` takes the prior as a parameter rather than computing it internally,
for the same reason the web app does: a prior built from the filtered subset
would rescale with every query, so `--category Restaurants` and
`--category Salons` would produce scores that cannot be compared. It is built
once from the whole corpus and passed in.

### `packages/pipeline/src/cli/leads.ts`

```bash
pnpm leads --signal no-website --category Restaurants --area marina --min-reviews 20
pnpm leads --signal weak-reputation --format csv --out reputation-leads.csv
pnpm leads --list-signals
```

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

**Consent notice.** The CLI prints one line: unsolicited commercial contact is
regulated in the UAE, and a list of numbers is not permission to use them. This
is a notice, not a compliance feature — it exists because shipping a
cold-outreach tool with no mention of that would be careless.

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
