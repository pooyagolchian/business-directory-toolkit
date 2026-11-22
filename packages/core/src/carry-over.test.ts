import { describe, expect, test } from "vitest";
import {
  DEFAULT_MAX_UNSEEN_DAYS,
  mergeCarryOver,
  parseCarryOver,
} from "./carry-over";
import type { Business } from "./types";

/**
 * A re-crawl is a sample of Google, not a census. The live directory held
 * 14,980 businesses when the next crawl's dry run estimated ~13,600, and every
 * business a crawl happens not to return would otherwise lose an indexed page.
 * Carry-over keeps a missing business for a bounded grace period instead, and
 * these tests pin the three ways it could go wrong: keeping forever, dropping
 * immediately, and bringing back a takedown.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-23T00:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function biz(placeId: string, extra: Partial<Business> = {}): Business {
  return {
    placeId,
    slug: `slug-${placeId.toLowerCase()}`,
    title: `Business ${placeId}`,
    area: "downtown",
    types: ["Cafe"],
    ...extra,
  };
}

const none = new Set<string>();
const ids = (list: readonly Business[]) => list.map((b) => b.placeId).sort();

describe("mergeCarryOver — identity and freshness", () => {
  test("a business in both sets is taken from the fresh crawl", () => {
    const previous = [biz("A", { title: "Old name", reviews: 10 })];
    const fresh = [biz("A", { title: "New name", reviews: 12 })];
    const out = mergeCarryOver(previous, fresh, { now: NOW, suppressed: none });
    expect(out.businesses).toHaveLength(1);
    expect(out.businesses[0]?.title).toBe("New name");
    expect(out.businesses[0]?.reviews).toBe(12);
  });

  test("every fresh record is stamped lastSeenAt = now", () => {
    const fresh = [biz("A"), biz("B", { lastSeenAt: ago(30 * DAY) })];
    const out = mergeCarryOver([], fresh, { now: NOW, suppressed: none });
    expect(out.businesses).toHaveLength(2);
    for (const b of out.businesses) {
      expect(b.lastSeenAt).toBe(NOW.toISOString());
    }
  });

  test("an overlapping id is counted as fresh, never as carried", () => {
    const out = mergeCarryOver([biz("A")], [biz("A")], {
      now: NOW,
      suppressed: none,
    });
    expect(out.counts).toEqual({
      fresh: 1,
      carried: 0,
      retired: 0,
      suppressed: 0,
    });
  });
});

describe("mergeCarryOver — the grace period", () => {
  test("the default grace period is eight weeks", () => {
    expect(DEFAULT_MAX_UNSEEN_DAYS).toBe(56);
  });

  test("a previous-only record seen recently is carried with its OLD timestamp", () => {
    // Re-stamping a carried record would restart its clock every run, and
    // nothing would ever retire.
    const seen = ago(7 * DAY);
    const out = mergeCarryOver([biz("A", { lastSeenAt: seen })], [biz("B")], {
      now: NOW,
      suppressed: none,
    });
    expect(ids(out.businesses)).toEqual(["A", "B"]);
    expect(out.businesses.find((b) => b.placeId === "A")?.lastSeenAt).toBe(
      seen,
    );
    expect(out.counts.carried).toBe(1);
  });

  test("exactly maxUnseenDays old is still carried", () => {
    const out = mergeCarryOver([biz("A", { lastSeenAt: ago(56 * DAY) })], [], {
      now: NOW,
      suppressed: none,
    });
    expect(out.counts).toMatchObject({ carried: 1, retired: 0 });
  });

  test("one millisecond past maxUnseenDays is retired", () => {
    const out = mergeCarryOver(
      [biz("A", { lastSeenAt: ago(56 * DAY + 1) })],
      [],
      { now: NOW, suppressed: none },
    );
    expect(out.businesses).toEqual([]);
    expect(out.counts).toMatchObject({ carried: 0, retired: 1 });
  });

  test("maxUnseenDays is configurable", () => {
    const previous = [biz("A", { lastSeenAt: ago(8 * DAY) })];
    const tight = mergeCarryOver(previous, [], {
      now: NOW,
      maxUnseenDays: 7,
      suppressed: none,
    });
    expect(tight.counts.retired).toBe(1);
    const zero = mergeCarryOver(
      [biz("A", { lastSeenAt: NOW.toISOString() })],
      [],
      {
        now: NOW,
        maxUnseenDays: 0,
        suppressed: none,
      },
    );
    expect(zero.counts.carried).toBe(1);
  });

  test("a record with no lastSeenAt is adopted and stamped now", () => {
    // The whole dataset that predates carry-over has no lastSeenAt, and there
    // is no honest older date to invent for it.
    const out = mergeCarryOver([biz("A")], [], { now: NOW, suppressed: none });
    expect(out.counts.carried).toBe(1);
    expect(out.businesses[0]?.lastSeenAt).toBe(NOW.toISOString());
  });

  test("an adopted record still retires once the grace period runs out", () => {
    // Two runs end to end: adoption starts the clock, it does not stop it.
    const first = mergeCarryOver([biz("A")], [biz("B")], {
      now: NOW,
      suppressed: none,
    });
    const later = new Date(NOW.getTime() + 57 * DAY);
    const second = mergeCarryOver(first.businesses, [biz("B")], {
      now: later,
      suppressed: none,
    });
    expect(ids(second.businesses)).toEqual(["B"]);
    expect(second.counts).toEqual({
      fresh: 1,
      carried: 0,
      retired: 1,
      suppressed: 0,
    });
  });

  test("rejects a negative or non-finite maxUnseenDays", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        mergeCarryOver([], [], {
          now: NOW,
          maxUnseenDays: bad,
          suppressed: none,
        }),
      ).toThrow(/maxUnseenDays/);
    }
  });

  test("rejects an invalid now", () => {
    expect(() =>
      mergeCarryOver([], [], { now: new Date("nope"), suppressed: none }),
    ).toThrow(/now/);
  });

  test("rejects an unparseable lastSeenAt rather than guessing", () => {
    // NaN arithmetic would quietly either retire or keep the record forever.
    expect(() =>
      mergeCarryOver([biz("A", { lastSeenAt: "last tuesday" })], [], {
        now: NOW,
        suppressed: none,
      }),
    ).toThrow(/lastSeenAt/);
  });
});

/**
 * ADR 0007: a removed business stays removed. Carry-over is a new way back in
 * — the previous dataset was built before today's takedown — so suppression
 * has to run on the carried set too, not only on the crawl.
 */
describe("mergeCarryOver — suppression", () => {
  test("a suppressed id present ONLY in previous is not carried", () => {
    const out = mergeCarryOver(
      [biz("GONE", { lastSeenAt: ago(DAY) }), biz("KEEP")],
      [biz("FRESH")],
      { now: NOW, suppressed: new Set(["GONE"]) },
    );
    expect(ids(out.businesses)).toEqual(["FRESH", "KEEP"]);
    expect(out.counts).toEqual({
      fresh: 1,
      carried: 1,
      retired: 0,
      suppressed: 1,
    });
  });

  test("a suppressed id in the fresh set is dropped too", () => {
    const out = mergeCarryOver([], [biz("GONE"), biz("KEEP")], {
      now: NOW,
      suppressed: new Set(["GONE"]),
    });
    expect(ids(out.businesses)).toEqual(["KEEP"]);
    expect(out.counts).toMatchObject({ fresh: 1, suppressed: 1 });
  });

  test("a suppressed id in both sets is dropped and counted once", () => {
    const out = mergeCarryOver([biz("GONE")], [biz("GONE")], {
      now: NOW,
      suppressed: new Set(["GONE"]),
    });
    expect(out.businesses).toEqual([]);
    expect(out.counts).toEqual({
      fresh: 0,
      carried: 0,
      retired: 0,
      suppressed: 1,
    });
  });

  test("a suppressed record that is also stale counts as suppressed, not retired", () => {
    // The takedown is the reason it is gone; the report should say so.
    const out = mergeCarryOver(
      [biz("GONE", { lastSeenAt: ago(365 * DAY) })],
      [],
      { now: NOW, suppressed: new Set(["GONE"]) },
    );
    expect(out.counts).toEqual({
      fresh: 0,
      carried: 0,
      retired: 0,
      suppressed: 1,
    });
  });
});

describe("mergeCarryOver — accounting and order", () => {
  test("every input record is accounted for exactly once", () => {
    const previous = [
      biz("OVERLAP"),
      biz("CARRIED", { lastSeenAt: ago(DAY) }),
      biz("ADOPTED"),
      biz("RETIRED", { lastSeenAt: ago(100 * DAY) }),
      biz("TAKEDOWN"),
    ];
    const fresh = [biz("OVERLAP"), biz("NEW1"), biz("NEW2")];
    const out = mergeCarryOver(previous, fresh, {
      now: NOW,
      suppressed: new Set(["TAKEDOWN"]),
    });
    const { counts } = out;
    expect(counts).toEqual({ fresh: 3, carried: 2, retired: 1, suppressed: 1 });
    expect(out.businesses).toHaveLength(counts.fresh + counts.carried);
    const overlap = 1;
    expect(previous.length).toBe(
      overlap + counts.carried + counts.retired + counts.suppressed,
    );
  });

  test("output is most-reviewed first, ties broken by placeId", () => {
    const out = mergeCarryOver(
      [biz("C", { reviews: 5 }), biz("Z")],
      [biz("B", { reviews: 5 }), biz("A", { reviews: 900 }), biz("Y")],
      { now: NOW, suppressed: none },
    );
    expect(out.businesses.map((b) => b.placeId)).toEqual([
      "A",
      "B",
      "C",
      "Y",
      "Z",
    ]);
  });

  test("the same inputs in a different order give identical output", () => {
    const previous = [biz("P1", { reviews: 3 }), biz("P2", { reviews: 3 })];
    const fresh = [
      biz("F1", { reviews: 3 }),
      biz("F2"),
      biz("F3", { reviews: 9 }),
    ];
    const a = mergeCarryOver(previous, fresh, { now: NOW, suppressed: none });
    const b = mergeCarryOver([...previous].reverse(), [...fresh].reverse(), {
      now: NOW,
      suppressed: none,
    });
    expect(a.businesses).toHaveLength(5);
    expect(b.businesses).toEqual(a.businesses);
  });

  test("does not mutate its inputs", () => {
    const previous = [biz("A")];
    const fresh = [biz("B")];
    const before = structuredClone({ previous, fresh });
    mergeCarryOver(previous, fresh, { now: NOW, suppressed: none });
    expect({ previous, fresh }).toEqual(before);
  });

  test("an empty previous set is just the fresh crawl", () => {
    const out = mergeCarryOver([], [biz("A"), biz("B")], {
      now: NOW,
      suppressed: none,
    });
    expect(out.counts).toEqual({
      fresh: 2,
      carried: 0,
      retired: 0,
      suppressed: 0,
    });
  });

  test("rejects a duplicate placeId within one input", () => {
    // Keyed by placeId; a duplicate means something upstream is broken, and
    // picking one silently would hide it.
    expect(() =>
      mergeCarryOver([biz("A"), biz("A")], [], { now: NOW, suppressed: none }),
    ).toThrow(/duplicate/i);
    expect(() =>
      mergeCarryOver([], [biz("A"), biz("A")], { now: NOW, suppressed: none }),
    ).toThrow(/duplicate/i);
  });
});

/**
 * The carry-over file is the previous businesses.json. A missing, truncated
 * or empty one must stop the load: treating it as "nothing to carry" would
 * quietly turn the shrink protection off, which is the failure this exists
 * to prevent.
 */
describe("parseCarryOver", () => {
  const good = [biz("A"), biz("B", { lastSeenAt: ago(DAY), reviews: 4 })];

  test("reads an array of businesses", () => {
    expect(parseCarryOver(JSON.stringify(good))).toEqual(good);
  });

  test("rejects invalid JSON", () => {
    expect(() => parseCarryOver('[{"placeId":')).toThrow();
  });

  test("rejects anything that is not an array", () => {
    expect(() => parseCarryOver('{"placeId":"A"}')).toThrow(/array/);
  });

  test("rejects an empty array", () => {
    expect(() => parseCarryOver("[]")).toThrow(/empty/);
  });

  test("rejects a record missing a required field", () => {
    for (const field of ["placeId", "slug", "title", "area", "types"]) {
      const broken: Record<string, unknown> = { ...biz("A") };
      delete broken[field];
      expect(() => parseCarryOver(JSON.stringify([broken]))).toThrow(
        new RegExp(field),
      );
    }
  });

  test("rejects a non-object entry", () => {
    expect(() => parseCarryOver("[null]")).toThrow();
    expect(() => parseCarryOver('["A"]')).toThrow();
  });

  test("rejects an unparseable lastSeenAt", () => {
    expect(() =>
      parseCarryOver(JSON.stringify([biz("A", { lastSeenAt: "soon" })])),
    ).toThrow(/lastSeenAt/);
  });

  test("rejects a duplicate placeId", () => {
    expect(() => parseCarryOver(JSON.stringify([biz("A"), biz("A")]))).toThrow(
      /duplicate/i,
    );
  });

  test("names the offending record's position", () => {
    const broken = [biz("A"), { ...biz("B"), slug: 7 }];
    expect(() => parseCarryOver(JSON.stringify(broken))).toThrow(/1/);
  });
});
