import { describe, expect, test } from "vitest";
import {
  MEASURED_DENSITY_THRESHOLDS,
  assignDensityByRank,
  SPACING_FLOORS,
  classifyDensity,
  distanceKm,
  spaceOut,
} from "./tiles";
import type { TileCandidate } from "./tiles";

// Real coordinates from data/cities/dubai.json. The 44 tiles in that file were
// placed by hand, so they are labelled ground truth for anything that claims to
// place tiles automatically — and they are free to test against, offline.
const DIFC = { lat: 25.211, lng: 55.28 };
const SHEIKH_ZAYED_ROAD = { lat: 25.218, lng: 55.279 };
const MEDIA_CITY = { lat: 25.095, lng: 55.156 };
const INTERNET_CITY = { lat: 25.094, lng: 55.162 };
const HATTA = { lat: 24.7994, lng: 56.1213 };
const DOWNTOWN = { lat: 25.1972, lng: 55.2744 };

describe("distanceKm", () => {
  test("is zero for a point and itself", () => {
    expect(distanceKm(DIFC, DIFC)).toBe(0);
  });

  test("measures the tightest dense pair in Dubai", () => {
    // DIFC and Sheikh Zayed Road are the closest two dense tiles that were
    // deliberately kept apart, so this distance is the floor any spacing rule
    // has to stay under.
    expect(distanceKm(DIFC, SHEIKH_ZAYED_ROAD)).toBeCloseTo(0.78, 2);
  });

  test("measures the exclave, which is two orders of magnitude further", () => {
    expect(distanceKm(DOWNTOWN, HATTA)).toBeGreaterThan(70);
  });

  test("is symmetric", () => {
    expect(distanceKm(DIFC, HATTA)).toBeCloseTo(distanceKm(HATTA, DIFC), 10);
  });

  test("shrinks a degree of longitude as latitude rises", () => {
    // A degree of longitude is ~11% shorter at Dubai's 25°N than at the
    // equator. Ignoring that would overstate east-west gaps and drop tiles that
    // are genuinely far enough apart.
    const atEquator = distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const atDubai = distanceKm({ lat: 25, lng: 0 }, { lat: 25, lng: 1 });
    expect(atDubai).toBeLessThan(atEquator);
    expect(atDubai / atEquator).toBeCloseTo(Math.cos((25 * Math.PI) / 180), 2);
  });
});

describe("classifyDensity", () => {
  const t = MEASURED_DENSITY_THRESHOLDS;

  test("calls a busy centre dense", () => {
    expect(classifyDensity(t.dense + 50)).toBe("dense");
  });

  test("calls a middling centre medium", () => {
    expect(classifyDensity(t.medium + 1)).toBe("medium");
  });

  test("calls a quiet centre sparse", () => {
    expect(classifyDensity(t.medium - 1)).toBe("sparse");
  });

  test("treats both thresholds as inclusive, so a boundary lands upward", () => {
    // Density drives PAGE_CAP, which is the credit bill. A value sitting
    // exactly on a boundary should buy the deeper crawl, not the shallower
    // one — under-crawling a real centre is the more expensive mistake.
    expect(classifyDensity(t.dense)).toBe("dense");
    expect(classifyDensity(t.medium)).toBe("medium");
  });

  test("handles an empty centre", () => {
    expect(classifyDensity(0)).toBe("sparse");
  });

  test("accepts caller-supplied thresholds, since the defaults are provisional", () => {
    expect(classifyDensity(10, { dense: 8, medium: 4 })).toBe("dense");
  });
});

describe("spaceOut", () => {
  const at = (
    id: string,
    lat: number,
    lng: number,
    density: TileCandidate["density"],
    poiCount: number,
  ): TileCandidate => ({ id, name: id, lat, lng, density, poiCount });

  test("keeps a lone candidate", () => {
    expect(spaceOut([at("a", 25, 55, "dense", 100)]).map((c) => c.id)).toEqual([
      "a",
    ]);
  });

  test("drops a candidate sitting inside another's floor", () => {
    const kept = spaceOut([
      at("busy", 25, 55, "dense", 500),
      at("quiet", 25.0005, 55, "dense", 10), // ~55m away
    ]);
    expect(kept.map((c) => c.id)).toEqual(["busy"]);
  });

  test("keeps the busier of a too-close pair regardless of input order", () => {
    const pair = [
      at("quiet", 25, 55, "dense", 10),
      at("busy", 25.0005, 55, "dense", 500),
    ];
    expect(spaceOut(pair).map((c) => c.id)).toEqual(["busy"]);
    expect(spaceOut([...pair].reverse()).map((c) => c.id)).toEqual(["busy"]);
  });

  test("keeps both when they clear the floor", () => {
    const kept = spaceOut([
      at("a", 25, 55, "dense", 500),
      at("b", 25.05, 55, "dense", 400), // ~5.5km
    ]);
    expect(kept.map((c) => c.id)).toEqual(["a", "b"]);
  });

  test("makes a sparse candidate clear a wider gap than a dense one", () => {
    // A sparse tile is crawled at zoom 13 and covers far more ground than a
    // dense tile at zoom 15, so two sparse centres 1km apart are redundant
    // while two dense ones are not. Same distance, different verdict.
    const oneKmApart = (density: TileCandidate["density"]) => [
      at("a", 25, 55, density, 500),
      at("b", 25.009, 55, density, 400),
    ];
    expect(spaceOut(oneKmApart("dense")).map((c) => c.id)).toEqual(["a", "b"]);
    expect(spaceOut(oneKmApart("sparse")).map((c) => c.id)).toEqual(["a"]);
  });

  test("is deterministic when two candidates are equally busy", () => {
    // A published crawl has to be reproducible from the committed config, so
    // ties break on id rather than on input order.
    const pair = [
      at("zulu", 25, 55, "dense", 100),
      at("alpha", 25.0005, 55, "dense", 100),
    ];
    expect(spaceOut(pair).map((c) => c.id)).toEqual(["alpha"]);
    expect(spaceOut([...pair].reverse()).map((c) => c.id)).toEqual(["alpha"]);
  });

  test("preserves Dubai's genuinely tight pairs", () => {
    // DIFC/Sheikh Zayed Road at 0.78km and Media City/Internet City at 0.61km
    // are distinct business districts a human deliberately kept. The default
    // floors exist to survive exactly these, so a rule tuned any tighter would
    // be demonstrably wrong against the only ground truth available.
    const kept = spaceOut([
      at("difc", DIFC.lat, DIFC.lng, "dense", 500),
      at(
        "sheikh-zayed-road",
        SHEIKH_ZAYED_ROAD.lat,
        SHEIKH_ZAYED_ROAD.lng,
        "dense",
        400,
      ),
      at("media-city", MEDIA_CITY.lat, MEDIA_CITY.lng, "medium", 300),
      at("internet-city", INTERNET_CITY.lat, INTERNET_CITY.lng, "medium", 200),
    ]);
    expect(kept).toHaveLength(4);
  });

  test("has floors low enough for the tightest measured pair", () => {
    // Media City to Internet City is 0.614km and both are `medium`. If the
    // medium floor ever rises above that, this repository's own reference city
    // stops being reproducible.
    expect(SPACING_FLOORS.medium).toBeLessThan(
      distanceKm(MEDIA_CITY, INTERNET_CITY),
    );
    expect(SPACING_FLOORS.dense).toBeLessThan(
      distanceKm(DIFC, SHEIKH_ZAYED_ROAD),
    );
  });

  test("returns an empty list for no candidates", () => {
    expect(spaceOut([])).toEqual([]);
  });
});

describe("assignDensityByRank", () => {
  const make = (counts: number[]) =>
    counts.map((poiCount, i) => ({ id: `t${i}`, poiCount }));

  test("reproduces Dubai's 15/18/11 shape on 44 centres", () => {
    const assigned = assignDensityByRank(
      make(Array.from({ length: 44 }, (_, i) => (44 - i) * 100)),
    );
    const tally = (d: string) =>
      [...assigned.values()].filter((v) => v === d).length;
    expect(tally("dense")).toBe(15);
    expect(tally("medium")).toBe(18);
    expect(tally("sparse")).toBe(11);
  });

  test("normalises to the city rather than to Dubai", () => {
    // The defect this replaces: Dubai-fitted absolute thresholds called 43 of
    // Lisbon's 50 centres dense, because Lisbon is compact and superbly mapped.
    // The same counts must not all land in one class.
    const busy = assignDensityByRank(
      make(Array.from({ length: 50 }, (_, i) => 900 - i)),
    );
    expect(new Set(busy.values()).size).toBeGreaterThan(1);
    expect([...busy.values()].filter((d) => d === "dense").length).toBeLessThan(
      25,
    );
  });

  test("never calls near-empty ground dense, whatever its rank", () => {
    // A hamlet's busiest street is still a hamlet's busiest street, and dense
    // buys five pages of every broad category.
    const village = assignDensityByRank(make([9, 5, 3, 2, 1]));
    expect(village.get("t0")).not.toBe("dense");
  });

  test("always leaves at least one dense centre in a real city", () => {
    // PAGE_CAP gives a sparse tile zero pages for standard and niche alike, so
    // a city with nothing dense plans almost nothing at all.
    const assigned = assignDensityByRank(make([900, 800, 700]));
    expect([...assigned.values()]).toContain("dense");
  });

  test("ranks by count, so the busiest centre is the densest", () => {
    const assigned = assignDensityByRank(make([10, 5000, 20, 30]));
    expect(assigned.get("t1")).toBe("dense");
  });

  test("is deterministic when counts tie", () => {
    const a = assignDensityByRank(make([100, 100, 100, 100]));
    const b = assignDensityByRank(make([100, 100, 100, 100]));
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  test("handles an empty city without throwing", () => {
    expect(assignDensityByRank([]).size).toBe(0);
  });
});
