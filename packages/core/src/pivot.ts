import type { RatingBand, RatingBin } from "./distribution";
import {
  RATING_BANDS,
  ratingBandIndex,
  ratingDistribution,
} from "./distribution";

/**
 * The columnar dataset behind the interactive charts, and the aggregation the
 * browser runs against it.
 *
 * The filters have to re-derive medians, and a median cannot be recovered from
 * bucketed counts — only estimated. So rather than ship a pre-aggregated pivot
 * cube, this ships the four numbers each rated business contributes and lets
 * the browser aggregate. Measured on the v0.1 Dubai crawl: 14,041 rows, 164KB
 * of JSON, 30KB gzipped. The cube alternative was 20KB gzipped and could only
 * approximate every median on the page, which is a poor trade for 10KB.
 *
 * Column-major, and sorted. Four arrays of small integers run-length compress
 * where an array of 14,041 row objects does not — same data, 30KB against
 * 46KB. The sort is load-bearing and there is a test pinning it.
 *
 * Nothing here knows about a city. `categories` and `areas` are whatever the
 * corpus contained, so the same code serves Dubai and anywhere else (ADR 0005).
 */

export interface ReviewBucket {
  label: string;
  /** Inclusive. */
  min: number;
  /** Inclusive. `Infinity` on the open-ended final bucket. */
  max: number;
}

/**
 * Review-count buckets, roughly one order of magnitude each.
 *
 * Log-spaced because review counts are: the corpus runs from 0 to 102,494, and
 * linear buckets would put 97% of businesses in the first one. "None" is kept
 * separate from "1–9" because zero reviews is a different state from a few —
 * it means nobody has assessed this business at all.
 */
export const REVIEW_BUCKETS: readonly ReviewBucket[] = [
  { label: "None", min: 0, max: 0 },
  { label: "1–9", min: 1, max: 9 },
  { label: "10–49", min: 10, max: 49 },
  { label: "50–199", min: 50, max: 199 },
  { label: "200–999", min: 200, max: 999 },
  { label: "1k–9.9k", min: 1_000, max: 9_999 },
  { label: "10k+", min: 10_000, max: Infinity },
];

export interface ChartDataset {
  /** L2 category labels, alphabetical. Addressed by the `c` column. */
  categories: string[];
  /** Area slugs, alphabetical. Addressed by the `a` column. */
  areas: string[];
  /** Category index, or -1 for a business the taxonomy never classified. */
  c: number[];
  /** Area index. */
  a: number[];
  /** Rating in tenths — 47 for 4.7. Integers compress; floats do not. */
  r: number[];
  /** Review count, exact. The medians depend on it. */
  v: number[];
  /** Businesses left out for carrying no usable rating. */
  unrated: number;
}

export interface ChartFilter {
  /** Category index, or omitted for every category. */
  category?: number;
  /** Area index, or omitted for every area. */
  area?: number;
}

export interface ChartSlice {
  /** Businesses the filter matched. */
  matched: number;
  bins: RatingBin[];
  bands: RatingBand[];
  /** `heatmap[ratingBandIndex][reviewBucketIndex]` — businesses in that cell. */
  heatmap: number[][];
  /** The largest cell, which is what the colour scale is built against. */
  heatmapMax: number;
}

/** Google's scale, matching ./distribution.ts. */
const MIN_RATING = 10;
const MAX_RATING = 50;

function reviewBucketIndex(reviews: number): number {
  for (let i = 0; i < REVIEW_BUCKETS.length; i++) {
    const bucket = REVIEW_BUCKETS[i];
    if (bucket && reviews >= bucket.min && reviews <= bucket.max) return i;
  }
  // Unreachable while the final bucket is open-ended, but a silently dropped
  // business would make the heatmap disagree with the band count beside it.
  return REVIEW_BUCKETS.length - 1;
}

export function buildChartDataset(
  businesses: Array<{
    l2?: string | undefined;
    area: string;
    rating?: number | undefined;
    reviews?: number | undefined;
  }>,
): ChartDataset {
  const categories = [
    ...new Set(businesses.map((b) => b.l2).filter((l2): l2 is string => !!l2)),
  ].sort();
  const areas = [...new Set(businesses.map((b) => b.area))].sort();
  const categoryIndex = new Map(categories.map((label, i) => [label, i]));
  const areaIndex = new Map(areas.map((slug, i) => [slug, i]));

  const rows: Array<[number, number, number, number]> = [];
  let unrated = 0;

  for (const business of businesses) {
    const raw = business.rating;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      unrated++;
      continue;
    }
    const tenths = Math.round(raw * 10);
    if (tenths < MIN_RATING || tenths > MAX_RATING) {
      unrated++;
      continue;
    }
    const reviews =
      typeof business.reviews === "number" && Number.isFinite(business.reviews)
        ? Math.max(0, business.reviews)
        : 0;
    rows.push([
      business.l2 ? (categoryIndex.get(business.l2) ?? -1) : -1,
      areaIndex.get(business.area) ?? -1,
      tenths,
      reviews,
    ]);
  }

  // Sorting is what makes the columns compress. See the test.
  rows.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]);

  return {
    categories,
    areas,
    c: rows.map((row) => row[0]),
    a: rows.map((row) => row[1]),
    r: rows.map((row) => row[2]),
    v: rows.map((row) => row[3]),
    unrated,
  };
}

/**
 * Aggregate one filtered slice: histogram, bands, and heatmap in a single pass.
 *
 * An index that no longer exists — a category the filter UI is out of date
 * about — simply matches nothing, because a chart drawn from a stale filter
 * should read as empty rather than silently fall back to the whole corpus.
 */
export function sliceDataset(
  dataset: ChartDataset,
  filter: ChartFilter = {},
): ChartSlice {
  const { category, area } = filter;
  const heatmap = RATING_BANDS.map(() =>
    new Array<number>(REVIEW_BUCKETS.length).fill(0),
  );

  // ratingDistribution() owns the binning, so the histogram and the bands stay
  // one definition rather than two that agree until someone edits one of them.
  const matched: Array<{ rating: number; reviews: number }> = [];

  for (let i = 0; i < dataset.r.length; i++) {
    if (category !== undefined && dataset.c[i] !== category) continue;
    if (area !== undefined && dataset.a[i] !== area) continue;

    const rating = (dataset.r[i] ?? 0) / 10;
    const reviews = dataset.v[i] ?? 0;
    matched.push({ rating, reviews });

    const row = heatmap[ratingBandIndex(rating)];
    if (row) {
      const column = reviewBucketIndex(reviews);
      row[column] = (row[column] ?? 0) + 1;
    }
  }

  const distribution = ratingDistribution(matched);
  return {
    matched: matched.length,
    bins: distribution.bins,
    bands: distribution.bands,
    heatmap,
    heatmapMax: Math.max(0, ...heatmap.flat()),
  };
}
