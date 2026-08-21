import { describe, expect, test } from "vitest";
import { RATING_BANDS, ratingDistribution } from "./distribution";
import { REVIEW_BUCKETS, buildChartDataset, sliceDataset } from "./pivot";

const b = (
  l2: string | undefined,
  area: string,
  rating?: number,
  reviews?: number,
) => ({ l2, area, rating, reviews });

describe("buildChartDataset", () => {
  test("keeps only rated businesses and counts the rest", () => {
    const d = buildChartDataset([
      b("Cafes", "deira", 4.6, 30),
      b("Cafes", "deira"),
      b("Cafes", "deira", undefined, 90),
    ]);
    expect(d.r).toHaveLength(1);
    expect(d.unrated).toBe(2);
  });

  test("keeps the four columns parallel", () => {
    const d = buildChartDataset([
      b("Cafes", "deira", 4.6, 30),
      b("Salons", "jumeirah", 3.2, 4),
    ]);
    expect(d.c).toHaveLength(2);
    expect(d.a).toHaveLength(2);
    expect(d.r).toHaveLength(2);
    expect(d.v).toHaveLength(2);
  });

  test("stores the rating as an integer tenth", () => {
    // Floats would defeat the run-length compression the column order exists
    // for, and 4.7 does not survive a JSON round-trip as cleanly as 47.
    const d = buildChartDataset([b("Cafes", "deira", 4.7, 30)]);
    expect(d.r[0]).toBe(47);
  });

  test("indexes categories and areas rather than repeating the strings", () => {
    const d = buildChartDataset([
      b("Cafes", "deira", 4.6, 30),
      b("Cafes", "jumeirah", 4.6, 30),
    ]);
    expect(d.categories).toEqual(["Cafes"]);
    expect(d.areas).toEqual(["deira", "jumeirah"]);
    expect(d.c).toEqual([0, 0]);
    expect(new Set(d.a)).toEqual(new Set([0, 1]));
  });

  test("marks an uncategorised business with -1 rather than inventing a category", () => {
    // 72 of Dubai's businesses reach the loader with no L2. They are real
    // listings and belong in the unfiltered totals; they just cannot answer a
    // question about a category they do not have.
    const d = buildChartDataset([b(undefined, "deira", 4.6, 30)]);
    expect(d.categories).toEqual([]);
    expect(d.c).toEqual([-1]);
  });

  test("sorts the rows so the columns run-length compress", () => {
    // This is why the payload is 30KB gzipped instead of 46KB. A refactor that
    // drops the sort would triple the bytes on the wire and change nothing
    // visible, so the ordering is asserted rather than assumed.
    const d = buildChartDataset([
      b("Salons", "jumeirah", 3.2, 4),
      b("Cafes", "deira", 4.6, 30),
      b("Cafes", "deira", 4.1, 10),
    ]);
    const rows = d.c.map((c, i) => [c, d.a[i]!, d.r[i]!, d.v[i]!] as const);
    const sorted = [...rows].sort(
      (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3],
    );
    expect(rows).toEqual(sorted);
  });
});

describe("REVIEW_BUCKETS", () => {
  test("opens at zero and closes open-ended", () => {
    expect(REVIEW_BUCKETS[0]?.min).toBe(0);
    expect(REVIEW_BUCKETS[0]?.max).toBe(0);
    expect(REVIEW_BUCKETS.at(-1)?.max).toBe(Infinity);
  });

  test("leaves no gap between one bucket and the next", () => {
    for (let i = 1; i < REVIEW_BUCKETS.length; i++) {
      expect(REVIEW_BUCKETS[i]?.min).toBe(
        (REVIEW_BUCKETS[i - 1]?.max ?? 0) + 1,
      );
    }
  });
});

describe("sliceDataset", () => {
  const corpus = [
    b("Cafes", "deira", 5, 4),
    b("Cafes", "deira", 5, 6),
    b("Cafes", "jumeirah", 4.6, 300),
    b("Salons", "deira", 4.6, 60),
    b("Salons", "jumeirah", 3.2, 12),
    b(undefined, "deira", 4.8, 900),
  ];
  const dataset = buildChartDataset(corpus);
  const catIndex = (name: string) => dataset.categories.indexOf(name);
  const areaIndex = (slug: string) => dataset.areas.indexOf(slug);

  test("matches everything when unfiltered", () => {
    expect(sliceDataset(dataset).matched).toBe(6);
  });

  test("filters by category", () => {
    const s = sliceDataset(dataset, { category: catIndex("Cafes") });
    expect(s.matched).toBe(3);
  });

  test("filters by area", () => {
    const s = sliceDataset(dataset, { area: areaIndex("deira") });
    expect(s.matched).toBe(4);
  });

  test("combines the two filters with AND", () => {
    const s = sliceDataset(dataset, {
      category: catIndex("Cafes"),
      area: areaIndex("deira"),
    });
    expect(s.matched).toBe(2);
  });

  test("a category filter excludes the uncategorised", () => {
    const s = sliceDataset(dataset, { category: catIndex("Salons") });
    expect(s.matched).toBe(2);
  });

  test("an impossible combination matches nothing rather than throwing", () => {
    const s = sliceDataset(dataset, {
      category: catIndex("Salons"),
      area: areaIndex("nowhere"),
    });
    expect(s.matched).toBe(0);
    expect(s.heatmapMax).toBe(0);
  });
});

describe("sliceDataset — the heatmap", () => {
  const dataset = buildChartDataset([
    b("Cafes", "deira", 5, 0),
    b("Cafes", "deira", 5, 9),
    b("Cafes", "deira", 5, 10),
    b("Cafes", "deira", 4.6, 10_000),
  ]);

  test("is one row per rating band and one column per review bucket", () => {
    const { heatmap } = sliceDataset(dataset);
    expect(heatmap).toHaveLength(RATING_BANDS.length);
    for (const row of heatmap) expect(row).toHaveLength(REVIEW_BUCKETS.length);
  });

  test("places a business in the bucket its review count falls in", () => {
    const { heatmap } = sliceDataset(dataset);
    const perfect = RATING_BANDS.findIndex((band) => band.label === "5.0");
    expect(heatmap[perfect]?.[0]).toBe(1); // 0 reviews
    expect(heatmap[perfect]?.[1]).toBe(1); // 1-9
    expect(heatmap[perfect]?.[2]).toBe(1); // 10-49
    const near = RATING_BANDS.findIndex((band) => band.label === "4.5–4.9");
    expect(heatmap[near]?.at(-1)).toBe(1); // 10,000+
  });

  test("totals to the number of matched businesses", () => {
    const s = sliceDataset(dataset);
    const total = s.heatmap.flat().reduce((sum, n) => sum + n, 0);
    expect(total).toBe(s.matched);
  });

  test("each row totals its band count, so the two panels cannot disagree", () => {
    const s = sliceDataset(dataset);
    s.heatmap.forEach((row, i) => {
      expect(row.reduce((sum, n) => sum + n, 0)).toBe(s.bands[i]?.count);
    });
  });

  test("reports the largest cell, which is what the colour scale is built on", () => {
    expect(sliceDataset(dataset).heatmapMax).toBe(1);
  });
});

describe("sliceDataset — agreement with ratingDistribution", () => {
  test("an unfiltered slice reproduces ratingDistribution exactly", () => {
    // The histogram and the median bars were server-rendered from
    // ratingDistribution before the filters existed. Re-deriving them from the
    // columnar dataset must not quietly change a single number.
    const corpus = [
      b("Cafes", "deira", 5, 4),
      b("Cafes", "deira", 4.9, 800),
      b("Salons", "jumeirah", 3.2, 12),
      b("Salons", "jumeirah", 4.4, 55),
      b(undefined, "deira", 2.1, 3),
    ];
    const s = sliceDataset(buildChartDataset(corpus));
    const direct = ratingDistribution(corpus);
    expect(s.bins).toEqual(direct.bins);
    expect(s.bands).toEqual(direct.bands);
  });
});
