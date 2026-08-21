# Lead Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing crawl into ranked, exportable prospect lists — businesses with a fixable commercial gap.

**Architecture:** Pure signal-detection and scoring functions in `packages/core`, consumed by one CLI in `packages/pipeline`. Scoring multiplies how badly a business has a problem by how healthy the business is, reusing the existing `rankScore` so a lone 5-star review cannot inflate a prospect. No new crawl, no network, no credits.

**Tech Stack:** TypeScript strict + ESM, Vitest, tsx. Existing modules reused: `rank.ts`, `suppression.ts`, the CSV writer extracted from `export.ts`.

**Spec:** `docs/superpowers/specs/2026-08-22-lead-generation-design.md`

## Global Constraints

- **TDD is mandatory** in `packages/core`. Write the test, run it, watch it fail for the right reason, then implement.
- **Tests never touch the network.** No API calls, no credits, in tests or CI.
- **Business listings only.** No personal names, no residential numbers in any output.
- **Suppressed businesses must never appear in output.** A `place_id` on the suppression list is excluded before scoring.
- `packages/core` stays pure — no `node:fs`, no AWS SDK, no `fetch`. I/O lives in `packages/pipeline`.
- Scores are comparable **only within one signal**. The CLI accepts exactly one `--signal`.
- Every gate must pass before each commit: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`.

---

### Task 1: Make `Business` satisfy `Identifiable`

The suppression module keys on `place_id` (the raw engine shape) but `Business`
carries `placeId`. Without this, `dropSuppressed(businesses, ids)` does not
compile, and the spec's load-bearing suppression constraint cannot be honoured.

**Files:**

- Modify: `packages/core/src/suppression.ts`
- Test: `packages/core/src/suppression.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `Identifiable` now accepts either key, so `dropSuppressed<Business>` compiles.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/suppression.test.ts`:

```ts
test("accepts the normalised camelCase shape as well as the raw one", () => {
  // Raw engine records carry place_id; normalised Business records carry
  // placeId. Suppression has to work on both, or it silently protects only
  // half the pipeline.
  const ids = new Set(["SUPPRESSED"]);
  const result = dropSuppressed(
    [{ placeId: "SUPPRESSED" }, { placeId: "KEPT" }],
    ids,
  );
  expect(result.removed).toBe(1);
  expect(result.kept).toEqual([{ placeId: "KEPT" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/suppression.test.ts`
Expected: FAIL — either a TypeScript error on the `placeId` object, or `removed` is `0` because nothing matched.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/suppression.ts`, replace the `Identifiable` interface and the id lookup inside `dropSuppressed`:

```ts
/**
 * Either spelling of the identifier.
 *
 * Raw engine records use `place_id`; normalised Business records use
 * `placeId`. Suppression must apply to both — a filter that only understands
 * one shape protects only half the pipeline, and the half it misses is the one
 * that reaches users.
 */
export interface Identifiable {
  place_id?: string | undefined;
  placeId?: string | undefined;
}

function identifierOf(item: Identifiable): string | undefined {
  return item.place_id ?? item.placeId;
}
```

Then inside `dropSuppressed`, use `identifierOf(item)` wherever `item.place_id` was read.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/suppression.test.ts`
Expected: PASS, including the pre-existing `place_id` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/suppression.ts packages/core/src/suppression.test.ts
git commit -m "fix: suppression must match both place_id and placeId

Raw engine records carry place_id; normalised Business records carry placeId.
dropSuppressed only understood the raw shape, so it protected the pipeline
before normalisation and not after — and after is the half that reaches users."
```

---

### Task 2: Extract the CSV writer so leads can reuse it

`csvCell` and the column list live inside `packages/pipeline/src/cli/export.ts`
as private functions. The leads CLI needs the same RFC 4180 quoting and UTF-8
BOM, and copying them would mean two implementations drifting apart.

**Files:**

- Create: `packages/pipeline/src/csv.ts`
- Create: `packages/pipeline/src/csv.test.ts`
- Modify: `packages/pipeline/src/cli/export.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `csvCell(value: unknown): string`, `csvRow(values: unknown[]): string`, `CSV_BOM: string`, `BUSINESS_COLUMNS: readonly string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/src/csv.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { csvCell, csvRow, CSV_BOM, BUSINESS_COLUMNS } from "./csv";

describe("csvCell", () => {
  test("passes a plain value through unquoted", () => {
    expect(csvCell("Cafe")).toBe("Cafe");
  });

  test("quotes a value containing a comma", () => {
    // Dubai addresses are full of commas; unquoted they shift every later
    // column and the file opens misaligned.
    expect(csvCell("Shop 2, Marina Walk")).toBe('"Shop 2, Marina Walk"');
  });

  test("doubles an embedded quote, per RFC 4180", () => {
    expect(csvCell('The "Best" Cafe')).toBe('"The ""Best"" Cafe"');
  });

  test("quotes a value containing a newline", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  test("renders an array as a semicolon list", () => {
    expect(csvCell(["a", "b"])).toBe("a; b");
  });

  test("renders undefined and null as empty", () => {
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null)).toBe("");
  });
});

describe("csvRow", () => {
  test("joins cells with commas and ends the line", () => {
    expect(csvRow(["a", "b,c"])).toBe('a,"b,c"\n');
  });
});

describe("CSV_BOM", () => {
  test("is the UTF-8 byte order mark", () => {
    // Without it, Arabic business names open as mojibake in Excel.
    expect(CSV_BOM).toBe("﻿");
  });
});

describe("BUSINESS_COLUMNS", () => {
  test("includes the fields an outreach list actually needs", () => {
    for (const column of ["title", "phoneE164", "website", "l2", "area"]) {
      expect(BUSINESS_COLUMNS).toContain(column);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/pipeline/src/csv.test.ts`
Expected: FAIL with "Failed to load url ./csv".

- [ ] **Step 3: Write minimal implementation**

Create `packages/pipeline/src/csv.ts`:

```ts
/**
 * CSV writing, shared by the export and leads CLIs.
 *
 * Extracted rather than duplicated: two copies of quoting rules drift, and the
 * failure mode is a file that opens misaligned in Excel — which is where these
 * files get used.
 */

/**
 * UTF-8 byte order mark.
 *
 * Excel on a default Windows install does not detect UTF-8 without it, so every
 * Arabic business name renders as mojibake.
 */
export const CSV_BOM = "﻿";

export const BUSINESS_COLUMNS = [
  "placeId",
  "title",
  "l1",
  "l2",
  "l3",
  "area",
  "address",
  "phoneE164",
  "phoneRaw",
  "phoneType",
  "website",
  "domain",
  "rating",
  "reviews",
  "lat",
  "lng",
  "accessibility",
  "payments",
  "services",
] as const;

/** RFC 4180 quoting. Required: addresses contain commas, titles contain quotes. */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/pipeline/src/csv.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Rewire `export.ts` to use the shared module**

In `packages/pipeline/src/cli/export.ts`: delete the local `csvCell` function and the local `COLUMNS` array, add `import { BUSINESS_COLUMNS, CSV_BOM, csvCell, csvRow } from "../csv";`, replace `COLUMNS` with `BUSINESS_COLUMNS`, replace the manual BOM string with `CSV_BOM`, and replace the manual `.join(",") + "\n"` calls with `csvRow(...)`.

- [ ] **Step 6: Verify export still works**

Run: `npx tsx packages/pipeline/src/cli/export.ts --format csv --category Pharmacies --area deira | head -2`
Expected: BOM + header row, then a data row with the address correctly quoted.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline/src/csv.ts packages/pipeline/src/csv.test.ts packages/pipeline/src/cli/export.ts
git commit -m "refactor: extract the CSV writer for reuse by the leads CLI

Two copies of RFC 4180 quoting drift apart, and the failure mode is a file that
opens misaligned in Excel — which is where these files get used."
```

---

### Task 3: Signal detection

**Files:**

- Create: `packages/core/src/leads.ts`
- Create: `packages/core/src/leads.test.ts`

**Interfaces:**

- Consumes: `Business` from `./types`.
- Produces: `LeadSignal`, `LEAD_SIGNALS`, `detectSignals(business: Business): LeadSignal[]`, `isContactable(business: Business): boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/leads.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { detectSignals, isContactable, LEAD_SIGNALS } from "./leads";
import type { Business } from "./types";

const base: Business = {
  placeId: "X",
  slug: "x",
  title: "X",
  area: "deira",
  types: [],
  phoneE164: "+97141234567",
  website: "https://example.invalid",
  rating: 4.5,
  reviews: 200,
  openHours: { monday: "9 AM–6 PM" },
};

describe("detectSignals", () => {
  test("finds no signal on a business with no gaps", () => {
    expect(detectSignals(base)).toEqual([]);
  });

  test("flags a business with no website", () => {
    const { website, ...noSite } = base;
    void website;
    expect(detectSignals(noSite as Business)).toContain("no-website");
  });

  test("flags weak reputation only when there are enough reviews to mean it", () => {
    // 2.0 from 3 reviews is noise, not a reputation problem to sell against.
    expect(detectSignals({ ...base, rating: 2.0, reviews: 200 })).toContain(
      "weak-reputation",
    );
    expect(detectSignals({ ...base, rating: 2.0, reviews: 3 })).not.toContain(
      "weak-reputation",
    );
  });

  test("flags low visibility below ten reviews", () => {
    expect(detectSignals({ ...base, reviews: 4 })).toContain("low-visibility");
    expect(detectSignals({ ...base, reviews: 40 })).not.toContain(
      "low-visibility",
    );
  });

  test("flags a business with no opening hours", () => {
    const { openHours, ...noHours } = base;
    void openHours;
    expect(detectSignals(noHours as Business)).toContain("no-hours");
  });

  test("returns several signals when a business has several gaps", () => {
    const { website, openHours, ...gappy } = base;
    void website;
    void openHours;
    const signals = detectSignals({ ...gappy, reviews: 2 } as Business);
    expect(signals).toContain("no-website");
    expect(signals).toContain("no-hours");
    expect(signals).toContain("low-visibility");
  });

  test("only ever returns known signals", () => {
    for (const signal of detectSignals({ ...base, website: undefined })) {
      expect(LEAD_SIGNALS).toContain(signal);
    }
  });
});

describe("isContactable", () => {
  test("requires a phone number", () => {
    // A lead you cannot ring is not a lead, whatever else is wrong with it.
    const { phoneE164, ...noPhone } = base;
    void phoneE164;
    expect(isContactable(noPhone as Business)).toBe(false);
    expect(isContactable(base)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/leads.test.ts`
Expected: FAIL with "Failed to load url ./leads".

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/leads.ts`:

```ts
import type { Business } from "./types";

/**
 * A lead is a business with a gap somebody sells against.
 *
 * Each signal maps to a real service: no website to web design, weak reputation
 * to reputation management, low visibility to local SEO, no hours to listing
 * management.
 */
export const LEAD_SIGNALS = [
  "no-website",
  "weak-reputation",
  "low-visibility",
  "no-hours",
] as const;

export type LeadSignal = (typeof LEAD_SIGNALS)[number];

/** Below this rating, with enough reviews to mean it, is a reputation problem. */
const WEAK_RATING = 3.8;
/** Fewer reviews than this and a rating is noise rather than a signal. */
const MIN_REVIEWS_FOR_REPUTATION = 20;
/** Below this review count, the business is invisible rather than disliked. */
const LOW_VISIBILITY_REVIEWS = 10;

/**
 * A lead you cannot contact is not a lead.
 *
 * This disqualifies rather than scores: no amount of business health makes an
 * unreachable prospect worth a place on a call list.
 */
export function isContactable(business: Business): boolean {
  return Boolean(business.phoneE164);
}

export function detectSignals(business: Business): LeadSignal[] {
  const signals: LeadSignal[] = [];

  if (!business.website) signals.push("no-website");

  if (
    business.rating !== undefined &&
    business.rating < WEAK_RATING &&
    (business.reviews ?? 0) >= MIN_REVIEWS_FOR_REPUTATION
  ) {
    signals.push("weak-reputation");
  }

  if ((business.reviews ?? 0) < LOW_VISIBILITY_REVIEWS) {
    signals.push("low-visibility");
  }

  if (!business.openHours || Object.keys(business.openHours).length === 0) {
    signals.push("no-hours");
  }

  return signals;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/leads.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/leads.ts packages/core/src/leads.test.ts
git commit -m "feat: lead signal detection

Each signal maps to a service somebody sells. Weak reputation requires 20+
reviews, because 2.0 from three reviews is noise rather than a reputation
problem. No phone disqualifies rather than scores — a lead you cannot ring is
not a lead."
```

---

### Task 4: Lead scoring

**Files:**

- Modify: `packages/core/src/leads.ts`
- Modify: `packages/core/src/leads.test.ts`

**Interfaces:**

- Consumes: `rankScore`, `RankPrior` from `./rank`; `detectSignals` from Task 3.
- Produces: `signalStrength(business: Business, signal: LeadSignal): number`, `leadScore(business: Business, signal: LeadSignal, prior: RankPrior): number`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/leads.test.ts` (add `leadScore, signalStrength` to the import from `./leads`, and `import type { RankPrior } from "./rank";`):

```ts
describe("leadScore", () => {
  const prior: RankPrior = { mean: 4.5, weight: 76 };

  test("ranks a thriving business above a struggling one with the same gap", () => {
    // The core idea: the best lead is a SUCCESSFUL business with a fixable
    // gap. Both lack a website; only one is worth calling first.
    const thriving = { ...base, website: undefined, rating: 4.8, reviews: 500 };
    const struggling = {
      ...base,
      website: undefined,
      rating: 3.1,
      reviews: 20,
    };
    expect(
      leadScore(thriving as Business, "no-website", prior),
    ).toBeGreaterThan(leadScore(struggling as Business, "no-website", prior));
  });

  test("scores a worse rating as a stronger reputation signal", () => {
    const bad = { ...base, rating: 2.0, reviews: 300 };
    const borderline = { ...base, rating: 3.7, reviews: 300 };
    expect(signalStrength(bad as Business, "weak-reputation")).toBeGreaterThan(
      signalStrength(borderline as Business, "weak-reputation"),
    );
  });

  test("scores fewer reviews as a stronger visibility signal", () => {
    expect(
      signalStrength({ ...base, reviews: 0 } as Business, "low-visibility"),
    ).toBeGreaterThan(
      signalStrength({ ...base, reviews: 9 } as Business, "low-visibility"),
    );
  });

  test("treats a binary gap as full strength", () => {
    expect(
      signalStrength({ ...base, website: undefined } as Business, "no-website"),
    ).toBe(1);
  });

  test("keeps strength within 0 and 1 for every signal", () => {
    for (const signal of LEAD_SIGNALS) {
      const strength = signalStrength(
        { ...base, rating: 1, reviews: 0, website: undefined } as Business,
        signal,
      );
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(1);
    }
  });

  test("never returns NaN on missing fields", () => {
    const sparse = {
      placeId: "S",
      slug: "s",
      title: "S",
      area: "a",
      types: [],
    } as Business;
    for (const signal of LEAD_SIGNALS) {
      expect(Number.isFinite(leadScore(sparse, signal, prior))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/leads.test.ts`
Expected: FAIL — `leadScore` and `signalStrength` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/leads.ts` (add `import { rankScore, type RankPrior } from "./rank";` at the top):

```ts
/**
 * How badly this business has the problem, normalised to 0–1.
 *
 * Normalising keeps strengths comparable within a signal. They are never
 * compared ACROSS signals — see leadScore.
 */
export function signalStrength(business: Business, signal: LeadSignal): number {
  switch (signal) {
    // Binary: a business either has one or it does not.
    case "no-website":
    case "no-hours":
      return 1;

    // How far below the threshold, over the range down to 1.0.
    case "weak-reputation": {
      const rating = business.rating ?? WEAK_RATING;
      const below = Math.max(0, WEAK_RATING - rating);
      return Math.min(1, below / (WEAK_RATING - 1));
    }

    // How far below the visibility floor. Zero reviews is full strength.
    case "low-visibility": {
      const reviews = Math.max(0, business.reviews ?? 0);
      return Math.min(
        1,
        Math.max(
          0,
          (LOW_VISIBILITY_REVIEWS - reviews) / LOW_VISIBILITY_REVIEWS,
        ),
      );
    }
  }
}

/**
 * The best lead is a successful business with a fixable gap.
 *
 * Multiplying signal strength by business health is what separates a 4.8-rated
 * restaurant with 500 reviews and no website from a 3.1-rated one with 20.
 * Both match the filter; only one is worth calling first.
 *
 * businessHealth uses rankScore rather than the raw star average, so a lone
 * 5-star review cannot push a prospect to the top of a call list.
 *
 * Scores are comparable only WITHIN a signal — a no-website score and a
 * weak-reputation score describe different products sold to different buyers.
 */
export function leadScore(
  business: Business,
  signal: LeadSignal,
  prior: RankPrior,
): number {
  const health = rankScore(business.rating, business.reviews, prior);
  return signalStrength(business, signal) * health;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/leads.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/leads.ts packages/core/src/leads.test.ts
git commit -m "feat: lead scoring — signal strength times business health

The best lead is a successful business with a fixable gap. A 4.8-rated
restaurant with 500 reviews and no website beats a 3.1-rated one with 20; both
match the filter and only a score separates them. Health uses rankScore, so a
lone 5-star review cannot inflate a prospect."
```

---

### Task 5: `findLeads` — filters, suppression, ranking

**Files:**

- Modify: `packages/core/src/leads.ts`
- Modify: `packages/core/src/leads.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `dropSuppressed` from `./suppression` (widened in Task 1); `detectSignals`, `leadScore` from Tasks 3–4.
- Produces: `Lead`, `LeadOptions`, `LeadResult`, `findLeads(businesses: Business[], options: LeadOptions): LeadResult`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/leads.test.ts` (add `findLeads` to the import):

```ts
describe("findLeads", () => {
  const prior: RankPrior = { mean: 4.5, weight: 76 };
  const opts = { signal: "no-website" as const, prior };

  const corpus: Business[] = [
    {
      ...base,
      placeId: "A",
      title: "A",
      website: undefined,
      rating: 4.8,
      reviews: 500,
    },
    {
      ...base,
      placeId: "B",
      title: "B",
      website: undefined,
      rating: 3.1,
      reviews: 30,
    },
    { ...base, placeId: "C", title: "C" },
    {
      ...base,
      placeId: "D",
      title: "D",
      website: undefined,
      phoneE164: undefined,
    },
  ] as Business[];

  test("returns only businesses carrying the requested signal", () => {
    const { leads } = findLeads(corpus, opts);
    expect(leads.map((l) => l.business.placeId)).not.toContain("C");
  });

  test("excludes businesses with no phone, however good the signal", () => {
    const { leads } = findLeads(corpus, opts);
    expect(leads.map((l) => l.business.placeId)).not.toContain("D");
  });

  test("ranks the healthier prospect first", () => {
    const { leads } = findLeads(corpus, opts);
    expect(leads[0]?.business.placeId).toBe("A");
  });

  test("never returns a suppressed business", () => {
    // A business that asked to be removed must not resurface on a call list.
    const { leads, suppressed } = findLeads(corpus, {
      ...opts,
      suppressed: new Set(["A"]),
    });
    expect(leads.map((l) => l.business.placeId)).not.toContain("A");
    expect(suppressed).toBe(1);
  });

  test("reports zero suppressed when the list is empty", () => {
    expect(findLeads(corpus, opts).suppressed).toBe(0);
  });

  test("filters by category", () => {
    const { leads } = findLeads(
      [
        { ...corpus[0], l2: "Restaurants" },
        { ...corpus[1], l2: "Salons" },
      ] as Business[],
      { ...opts, category: "Restaurants" },
    );
    expect(leads).toHaveLength(1);
    expect(leads[0]?.business.l2).toBe("Restaurants");
  });

  test("filters by area", () => {
    const { leads } = findLeads(
      [
        { ...corpus[0], area: "marina" },
        { ...corpus[1], area: "deira" },
      ] as Business[],
      { ...opts, area: "marina" },
    );
    expect(leads).toHaveLength(1);
  });

  test("filters by minimum review count", () => {
    const { leads } = findLeads(corpus, { ...opts, minReviews: 100 });
    expect(leads.every((l) => (l.business.reviews ?? 0) >= 100)).toBe(true);
  });

  test("respects the limit", () => {
    expect(findLeads(corpus, { ...opts, limit: 1 }).leads).toHaveLength(1);
  });

  test("attaches a human-readable reason to every lead", () => {
    // The list has to be auditable — a score with no explanation is a number
    // someone will either trust blindly or ignore.
    for (const lead of findLeads(corpus, opts).leads) {
      expect(lead.reason.length).toBeGreaterThan(0);
    }
  });

  test("returns an empty result rather than throwing on an empty corpus", () => {
    expect(findLeads([], opts)).toEqual({
      leads: [],
      suppressed: 0,
      considered: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/leads.test.ts`
Expected: FAIL — `findLeads` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/leads.ts` (add `import { dropSuppressed } from "./suppression";`):

```ts
export interface Lead {
  business: Business;
  signal: LeadSignal;
  score: number;
  /** Why it scored as it did, so the list can be audited rather than trusted. */
  reason: string;
}

export interface LeadOptions {
  /** Exactly one. Scores are not comparable across signals. */
  signal: LeadSignal;
  /** Built once from the whole corpus, never from the filtered subset. */
  prior: RankPrior;
  /** place_ids that must never appear — takedown requests. */
  suppressed?: Set<string> | undefined;
  category?: string | undefined;
  area?: string | undefined;
  minReviews?: number | undefined;
  minRating?: number | undefined;
  limit?: number | undefined;
}

export interface LeadResult {
  leads: Lead[];
  /** How many were withheld by the suppression list, so the filter is visible. */
  suppressed: number;
  /** How many were examined after filters, before signal matching. */
  considered: number;
}

function reasonFor(business: Business, signal: LeadSignal): string {
  const reviews = business.reviews ?? 0;
  switch (signal) {
    case "no-website":
      return `No website listed; ${reviews.toLocaleString()} reviews suggest an established business`;
    case "weak-reputation":
      return `Rated ${(business.rating ?? 0).toFixed(1)} across ${reviews.toLocaleString()} reviews`;
    case "low-visibility":
      return `Only ${reviews.toLocaleString()} reviews`;
    case "no-hours":
      return `No opening hours listed`;
  }
}

export function findLeads(
  businesses: Business[],
  options: LeadOptions,
): LeadResult {
  // Suppression first, before any scoring. A business that asked to be removed
  // must not resurface on a cold-call list, which would make the takedown
  // promise worse than meaningless.
  const { kept, removed } = dropSuppressed(
    businesses,
    options.suppressed ?? new Set<string>(),
  );

  const filtered = kept.filter((b) => {
    if (!isContactable(b)) return false;
    if (
      options.category &&
      b.l2 !== options.category &&
      b.l3 !== options.category
    )
      return false;
    if (options.area && b.area !== options.area) return false;
    if (
      options.minReviews !== undefined &&
      (b.reviews ?? 0) < options.minReviews
    )
      return false;
    if (options.minRating !== undefined && (b.rating ?? 0) < options.minRating)
      return false;
    return true;
  });

  const leads: Lead[] = filtered
    .filter((b) => detectSignals(b).includes(options.signal))
    .map((business) => ({
      business,
      signal: options.signal,
      score: leadScore(business, options.signal, options.prior),
      reason: reasonFor(business, options.signal),
    }))
    .sort((a, b) => b.score - a.score);

  return {
    leads: options.limit ? leads.slice(0, options.limit) : leads,
    suppressed: removed,
    considered: filtered.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/leads.test.ts`
Expected: PASS (25 tests).

- [ ] **Step 5: Export from core**

In `packages/core/src/index.ts`, add:

```ts
export {
  detectSignals,
  findLeads,
  isContactable,
  leadScore,
  LEAD_SIGNALS,
  signalStrength,
} from "./leads";
export type { Lead, LeadOptions, LeadResult, LeadSignal } from "./leads";
```

- [ ] **Step 6: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/leads.ts packages/core/src/leads.test.ts packages/core/src/index.ts
git commit -m "feat: findLeads with filters, suppression and ranking

Suppression is applied BEFORE scoring: a business that asked to be removed must
never resurface on a cold-call list, which would make the takedown promise
worse than meaningless. The count of withheld records is returned so the filter
is visibly working rather than silently trusted.

Every lead carries a reason. A score with no explanation is a number someone
will either trust blindly or ignore."
```

---

### Task 6: The `pnpm leads` CLI

**Files:**

- Create: `packages/pipeline/src/cli/leads.ts`
- Modify: `package.json` (add the `leads` script)

**Interfaces:**

- Consumes: `findLeads`, `corpusPrior`, `LEAD_SIGNALS`, `parseSuppressionList` from `@directory/core`; `BUSINESS_COLUMNS`, `CSV_BOM`, `csvRow` from `../csv`.
- Produces: the `pnpm leads` command. Nothing imports from it.

- [ ] **Step 1: Write the CLI**

Create `packages/pipeline/src/cli/leads.ts`:

```ts
/**
 * Find and rank prospects from your own crawl.
 *
 *   pnpm leads --list-signals
 *   pnpm leads --signal no-website --category Restaurants --min-reviews 20
 *   pnpm leads --signal weak-reputation --format csv --out leads.csv
 *
 * Reads data/out/businesses.json. No network, no credits.
 *
 * Exactly one --signal is accepted. Scores are comparable only within a
 * signal: a no-website score and a weak-reputation score describe different
 * products sold to different buyers, so ranking them together is meaningless.
 */
import { readFileSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  corpusPrior,
  findLeads,
  parseSuppressionList,
  LEAD_SIGNALS,
  type Business,
  type LeadSignal,
} from "@directory/core";
import { BUSINESS_COLUMNS, CSV_BOM, csvRow } from "../csv";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

if (argv.includes("--list-signals")) {
  console.log(`\nAvailable signals:\n`);
  console.log(`  no-website        No website listed — web design, agencies`);
  console.log(
    `  weak-reputation   Rated under 3.8 with 20+ reviews — reputation management`,
  );
  console.log(
    `  low-visibility    Fewer than 10 reviews — local SEO, review generation`,
  );
  console.log(
    `  no-hours          No opening hours listed — listing management\n`,
  );
  process.exit(0);
}

const signal = flag("--signal") as LeadSignal | undefined;
if (!signal || !LEAD_SIGNALS.includes(signal)) {
  console.error(
    `\n--signal is required and must be one of: ${LEAD_SIGNALS.join(", ")}\n` +
      `Run \`pnpm leads --list-signals\` for what each one means.\n`,
  );
  process.exit(1);
}

const root = new URL("../../../../", import.meta.url);

let businesses: Business[];
try {
  businesses = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("data/out/businesses.json", root)),
      "utf8",
    ),
  ) as Business[];
} catch {
  console.error(
    "No data/out/businesses.json. Run `pnpm crawl --yes` then `pnpm load`,\n" +
      "or `pnpm load --from-archive` to rebuild from responses already fetched.\n",
  );
  process.exit(1);
}

// Suppression is not optional. A missing list is an empty list, never a reason
// to skip the check.
let suppressed = new Set<string>();
try {
  suppressed = parseSuppressionList(
    readFileSync(
      fileURLToPath(new URL("data/suppression-list.json", root)),
      "utf8",
    ),
  );
} catch {
  suppressed = new Set<string>();
}

const result = findLeads(businesses, {
  signal,
  // Built from the WHOLE corpus, not the filtered subset: a prior that
  // rescales per query makes scores incomparable between runs.
  prior: corpusPrior(businesses),
  suppressed,
  ...(flag("--category") ? { category: flag("--category") } : {}),
  ...(flag("--area") ? { area: flag("--area") } : {}),
  ...(flag("--min-reviews")
    ? { minReviews: Number(flag("--min-reviews")) }
    : {}),
  ...(flag("--min-rating") ? { minRating: Number(flag("--min-rating")) } : {}),
  ...(flag("--limit") ? { limit: Number(flag("--limit")) } : {}),
});

const format = (flag("--format") ?? "table").toLowerCase();
const out = flag("--out");
const stream = out ? createWriteStream(out) : process.stdout;

if (format === "csv") {
  stream.write(CSV_BOM);
  stream.write(csvRow([...BUSINESS_COLUMNS, "signal", "score", "reason"]));
  for (const lead of result.leads) {
    stream.write(
      csvRow([
        ...BUSINESS_COLUMNS.map((c) => lead.business[c as keyof Business]),
        lead.signal,
        lead.score.toFixed(3),
        lead.reason,
      ]),
    );
  }
} else if (format === "json") {
  stream.write(JSON.stringify(result.leads, null, 2) + "\n");
} else {
  for (const lead of result.leads.slice(0, 40)) {
    stream.write(
      `${lead.score.toFixed(2).padStart(5)}  ${(lead.business.phoneRaw ?? "no phone").padEnd(16)} ` +
        `${(lead.business.title ?? "").slice(0, 44).padEnd(46)} ${lead.reason}\n`,
    );
  }
}

if (out) stream.end();

// Everything below goes to stderr so `pnpm leads --format csv > file.csv` stays clean.
console.error(`
${result.leads.length.toLocaleString()} leads · signal "${signal}" · ${result.considered.toLocaleString()} businesses considered${
  result.suppressed > 0
    ? `\n${result.suppressed} withheld by the suppression list (takedown requests).`
    : ""
}

These are business listings, not permission to contact. Unsolicited commercial
messaging is regulated in the UAE — check the rules that apply before you use
this list.
`);
```

- [ ] **Step 2: Add the script**

In `package.json`, add to `scripts`: `"leads": "tsx packages/pipeline/src/cli/leads.ts"`

- [ ] **Step 3: Verify `--list-signals` works**

Run: `npx tsx packages/pipeline/src/cli/leads.ts --list-signals`
Expected: four signals listed, exit 0.

- [ ] **Step 4: Verify a real query works**

Run: `npx tsx packages/pipeline/src/cli/leads.ts --signal no-website --category Restaurants --min-reviews 20 --limit 10`
Expected: ten ranked rows, highest score first, each with a phone number and a reason. The stderr footer reports the counts and the consent notice.

- [ ] **Step 5: Verify a missing signal is rejected**

Run: `npx tsx packages/pipeline/src/cli/leads.ts --signal nonsense`
Expected: the error listing valid signals, exit 1.

- [ ] **Step 6: Verify CSV output is clean**

Run: `npx tsx packages/pipeline/src/cli/leads.ts --signal no-website --format csv --limit 5 2>/dev/null | head -2`
Expected: BOM + header ending in `signal,score,reason`, then a data row. Nothing from the footer appears in stdout.

- [ ] **Step 7: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/pipeline/src/cli/leads.ts package.json
git commit -m "feat: pnpm leads — ranked prospect lists from your own crawl

Exactly one --signal is accepted, because scores are comparable only within a
signal: no-website and weak-reputation describe different products sold to
different buyers.

The prior is built from the whole corpus rather than the filtered subset, so
--category Restaurants and --category Salons produce comparable scores.

Suppression is applied and the withheld count reported. Counts and the consent
notice go to stderr, so \`--format csv > file.csv\` stays clean."
```

---

### Task 7: Document it

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md` (commands table)

**Interfaces:**

- Consumes: the CLI from Task 6.
- Produces: nothing.

- [ ] **Step 1: Add a README section**

Insert after the "Pipeline" section in `README.md`:

````markdown
## Find leads in your own crawl

The same crawl that builds a directory also answers a commercially useful
question: **which businesses have a fixable gap?**

```bash
pnpm leads --list-signals
pnpm leads --signal no-website --category Restaurants --min-reviews 20
pnpm leads --signal weak-reputation --format csv --out leads.csv
```

Leads are ranked, not just filtered. The best prospect is a **successful**
business with a gap — a 4.8-rated restaurant with 500 reviews and no website is
worth calling before a 3.1-rated one with 20. Both match the filter; only a
score separates them.

Businesses on `data/suppression-list.json` are excluded before scoring, so a
takedown request keeps someone off a call list too.

These are business listings, not permission to contact. Unsolicited commercial
messaging is regulated in the UAE and elsewhere — check what applies to you.
````

- [ ] **Step 2: Add the command to the CLAUDE.md table**

Add to the commands table in `CLAUDE.md`:

```
pnpm leads --list-signals    # prospect signals, no API calls
```

- [ ] **Step 3: Run format check**

Run: `pnpm format:check`
Expected: exit 0. If it fails, run `pnpm prettier --write README.md CLAUDE.md`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document the leads CLI

Includes the consent notice and the suppression guarantee, because a
cold-outreach tool documented without either is careless."
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: signals and exclusions →
Task 3; `signalStrength` and `leadScore` → Task 4; `LeadOptions`, filters,
suppression, ranking → Task 5; CLI, flags, CSV reuse, consent notice → Task 6;
docs → Task 7. Tasks 1 and 2 are prerequisites the spec implied but did not
name — the `place_id`/`placeId` mismatch and the un-exported CSV writer. Both
would have blocked implementation.

**Placeholder scan.** No TBD, TODO, "similar to Task N", or prose-only code
steps. Every code step carries the actual code.

**Type consistency.** `LeadSignal`, `Lead`, `LeadOptions`, `LeadResult`,
`detectSignals`, `signalStrength`, `leadScore`, `findLeads`, `isContactable`
are spelled identically in every task. `LeadResult` adds `considered` beyond
the spec's `Lead[]` return, because the CLI needs to report how many businesses
were examined — noted here rather than left as a silent divergence.

**One deviation from the spec, flagged rather than hidden.** The spec's
`findLeads` signature returns `Lead[]`; this plan returns `LeadResult` so the
suppression count can surface in the CLI. The spec requires that count be
reported, so the richer return type is what makes the spec's own constraint
achievable.
