"use client";

import { useMemo, useState } from "react";
import { scaleQuantile } from "d3-scale";
import type { ChartDataset, ChartFilter, ChartSlice } from "@directory/core";
import { REVIEW_BUCKETS, sliceDataset } from "@directory/core";
import { ChartFrame, Histogram, MedianReviews } from "./rating-distribution";

/**
 * The interactive half of the statistics section.
 *
 * This is the only client component on the home page, and it exists for one
 * reason: filtering. Everything it draws could be server-rendered — and the
 * first paint still is, because it is rendered on the server with the
 * unfiltered slice — but re-deriving a median for "Restaurants in Dubai
 * Marina" is not something a static page can do without a round trip per
 * dropdown change.
 *
 * The cost is the dataset it carries: 14,041 rows, 164KB of JSON, 30KB
 * gzipped. See packages/core/src/pivot.ts for why that beats shipping a
 * pre-aggregated cube (medians cannot be recovered from bucketed counts) and
 * why the columns are sorted (they compress).
 */

// ---------------------------------------------------------------- heatmap

const M_W = 880;
const M_GRID_X = 96;
const M_TOTAL_W = 84;
const M_HEAD = 24;
const M_ROW = 44;
const M_CELL_H = 38;
const M_GAP = 4;
const M_LEGEND = 40;
const M_TIP_W = 168;
const M_TIP_H = 42;

/**
 * The five steps, ordered. Index 0 is "none", which is deliberately not part of
 * the green ramp — no businesses at all is a different statement from a few.
 */
const LEVELS = [
  "var(--chart-level-0)",
  "var(--chart-level-1)",
  "var(--chart-level-2)",
  "var(--chart-level-3)",
  "var(--chart-level-4)",
] as const;

/** Steps 3 and 4 are dark enough that ink on them fails contrast. */
const INK_ON = new Set([0, 1, 2]);

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

function Heatmap({ slice, columns }: { slice: ChartSlice; columns: number[] }) {
  const rows = slice.bands.map((band, i) => ({ band, i })).reverse();
  const gridW = M_W - M_GRID_X - M_TOTAL_W;
  const cellW = gridW / columns.length - M_GAP;
  const height = M_HEAD + rows.length * M_ROW + M_LEGEND;

  /*
   * Quantile, not linear.
   *
   * Cell counts here span 2 to 2,219, and a linear ramp puts all but a handful
   * of cells in the palest step — the grid goes flat and says nothing. Quantile
   * gives each step roughly a quarter of the non-empty cells, which is what
   * GitHub's contribution graph does and why theirs reads at a glance.
   *
   * The domain is the *current* slice, so the scale re-fits when a filter
   * narrows the data. The legend prints the largest cell, so a reader can always
   * see which absolute range the darkest step currently stands for.
   */
  const nonZero = slice.heatmap.flat().filter((n) => n > 0);
  const colour = scaleQuantile<string>()
    .domain(nonZero)
    .range(LEVELS.slice(1) as unknown as string[]);
  const levelOf = (count: number) =>
    count === 0 ? 0 : LEVELS.indexOf(colour(count) as (typeof LEVELS)[number]);

  return (
    <svg
      viewBox={`0 0 ${M_W} ${height}`}
      className="block w-full min-w-[820px]"
      role="img"
      aria-label={`Grid of businesses by rating against review count. ${rows
        .map(
          ({ band, i }) =>
            `${band.label}: ${columns
              .map(
                (j) =>
                  `${(slice.heatmap[i]?.[j] ?? 0).toLocaleString()} with ${REVIEW_BUCKETS[j]?.label} reviews`,
              )
              .join(", ")}`,
        )
        .join(". ")}.`}
    >
      {/* Column heads: the review-count buckets. */}
      {columns.map((j, col) => (
        <text
          key={j}
          x={M_GRID_X + col * (cellW + M_GAP) + cellW / 2}
          y={14}
          textAnchor="middle"
          className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
        >
          {REVIEW_BUCKETS[j]?.label}
        </text>
      ))}
      <text
        x={M_W}
        y={14}
        textAnchor="end"
        className="fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px] tracking-[0.07em] uppercase"
      >
        All
      </text>

      {rows.map(({ band, i }, row) => {
        const y = M_HEAD + row * M_ROW;
        const cellY = y + (M_ROW - M_CELL_H) / 2;
        const isPerfect = band.min === band.max;

        return (
          <g key={band.label}>
            <text
              x={0}
              y={cellY + M_CELL_H / 2 + 4}
              className={`tabular font-[family-name:var(--font-mono)] text-[12px] ${
                isPerfect ? "fill-[var(--fg)]" : "fill-[var(--muted)]"
              }`}
            >
              {band.label}
            </text>

            {columns.map((j, col) => {
              const count = slice.heatmap[i]?.[j] ?? 0;
              const level = levelOf(count);
              const x = M_GRID_X + col * (cellW + M_GAP);
              const tipX = clamp(x + cellW / 2 - M_TIP_W / 2, 0, M_W - M_TIP_W);
              const tipY = Math.max(0, cellY - M_TIP_H - 6);

              return (
                <g key={j} className="chart-col">
                  <rect
                    className="chart-cell"
                    x={x}
                    y={cellY}
                    width={cellW}
                    height={M_CELL_H}
                    rx={6}
                    fill={LEVELS[level]}
                  />
                  {/* The count is printed, not hidden behind the pointer. It
                      also means the grid never relies on colour alone, which
                      matters because GitHub's palest step does not clear 3:1
                      against paper. */}
                  {count > 0 && (
                    <text
                      x={x + cellW / 2}
                      y={cellY + M_CELL_H / 2 + 4}
                      textAnchor="middle"
                      className={`tabular font-[family-name:var(--font-mono)] text-[12px] ${
                        INK_ON.has(level)
                          ? "fill-[var(--color-ink-900)]"
                          : "fill-white"
                      }`}
                    >
                      {count.toLocaleString()}
                    </text>
                  )}

                  <g className="chart-tip">
                    <rect
                      x={tipX}
                      y={tipY}
                      width={M_TIP_W}
                      height={M_TIP_H}
                      fill="var(--bg)"
                      stroke="var(--rule)"
                      strokeWidth="1"
                    />
                    <text
                      x={tipX + 12}
                      y={tipY + 18}
                      className="tabular fill-[var(--fg)] font-[family-name:var(--font-mono)] text-[13px]"
                    >
                      {count.toLocaleString()}{" "}
                      {count === 1 ? "business" : "businesses"}
                    </text>
                    <text
                      x={tipX + 12}
                      y={tipY + 32}
                      className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
                    >
                      {band.label} &middot; {REVIEW_BUCKETS[j]?.label} reviews
                    </text>
                  </g>
                </g>
              );
            })}

            <text
              x={M_W}
              y={cellY + M_CELL_H / 2 + 4}
              textAnchor="end"
              className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[12px]"
            >
              {band.count.toLocaleString()}
            </text>
          </g>
        );
      })}

      {/* Legend, in GitHub's own shape. */}
      <g
        transform={`translate(${M_GRID_X}, ${M_HEAD + rows.length * M_ROW + 18})`}
      >
        <text
          x={0}
          y={10}
          className="fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
        >
          Fewer
        </text>
        {LEVELS.map((level, i) => (
          <rect
            key={level}
            className="chart-cell"
            x={44 + i * 18}
            y={0}
            width={13}
            height={13}
            rx={3}
            fill={level}
          />
        ))}
        <text
          x={44 + LEVELS.length * 18 + 4}
          y={10}
          className="fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
        >
          More
        </text>
        <text
          x={44 + LEVELS.length * 18 + 48}
          y={10}
          className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
        >
          &middot; darkest step tops out at {slice.heatmapMax.toLocaleString()}
        </text>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------- filters

const SELECT_CLASS =
  "mt-2 w-full appearance-none rounded-none border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm hover:border-[var(--field-border-hover)] focus-visible:border-[var(--field-border-active)] sm:w-56";

function FilterRow({
  dataset,
  areaLabels,
  category,
  area,
  onCategory,
  onArea,
  onReset,
  matched,
}: {
  dataset: ChartDataset;
  areaLabels: string[];
  category: number | null;
  area: number | null;
  onCategory: (v: number | null) => void;
  onArea: (v: number | null) => void;
  onReset: () => void;
  matched: number;
}) {
  // Sorted by the label a reader sees, not by the slug the data is keyed on.
  const areaOptions = useMemo(
    () =>
      areaLabels
        .map((label, index) => ({ label, index }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [areaLabels],
  );
  const filtered = category !== null || area !== null;

  return (
    <div className="mt-8 border-y border-[var(--rule)] py-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div>
          <label
            className="label block text-[var(--muted)]"
            htmlFor="chart-category"
          >
            Category
          </label>
          <select
            id="chart-category"
            className={SELECT_CLASS}
            value={category ?? ""}
            onChange={(e) =>
              onCategory(e.target.value === "" ? null : Number(e.target.value))
            }
          >
            <option value="">All {dataset.categories.length} categories</option>
            {dataset.categories.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            className="label block text-[var(--muted)]"
            htmlFor="chart-area"
          >
            Neighbourhood
          </label>
          <select
            id="chart-area"
            className={SELECT_CLASS}
            value={area ?? ""}
            onChange={(e) =>
              onArea(e.target.value === "" ? null : Number(e.target.value))
            }
          >
            <option value="">All {areaLabels.length} neighbourhoods</option>
            {areaOptions.map((option) => (
              <option key={option.index} value={option.index}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {filtered && (
          <button
            type="button"
            onClick={onReset}
            className="label border border-[var(--field-border)] px-3 py-2.5 text-[var(--muted)] hover:border-[var(--field-border-active)] hover:text-[var(--fg)]"
          >
            Reset
          </button>
        )}

        <p className="tabular w-full text-sm text-[var(--muted)] sm:ml-auto sm:w-auto">
          <span className="text-[var(--fg)]">{matched.toLocaleString()}</span>{" "}
          rated {matched === 1 ? "business" : "businesses"} in view
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tables

/**
 * The table is not a fallback, it is the other half of the figure.
 *
 * Every number the plots draw or reveal on hover is here in text, which is what
 * makes them safe to expose to assistive technology as single labelled images
 * rather than as 41 focusable columns nobody wants to tab through.
 */
function Numbers({ slice }: { slice: ChartSlice }) {
  return (
    <details className="mt-8 border-t border-[var(--rule)] pt-4">
      <summary className="label cursor-pointer text-[var(--muted)] hover:text-[var(--fg)]">
        Show the numbers
      </summary>

      <div className="mt-6 grid gap-10 sm:grid-cols-2">
        <table className="w-full text-sm">
          <caption className="label mb-3 text-left text-[var(--muted)]">
            Businesses by rating
          </caption>
          <thead>
            <tr className="border-b border-[var(--rule)]">
              <th className="py-2 text-left font-normal text-[var(--muted)]">
                Rating
              </th>
              <th className="py-2 text-right font-normal text-[var(--muted)]">
                Businesses
              </th>
            </tr>
          </thead>
          <tbody>
            {slice.bins
              .filter((bin) => bin.count > 0)
              .map((bin) => (
                <tr key={bin.rating} className="border-b border-[var(--rule)]">
                  <td className="tabular py-1.5">{bin.rating.toFixed(1)}</td>
                  <td className="tabular py-1.5 text-right">
                    {bin.count.toLocaleString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        <table className="w-full text-sm">
          <caption className="label mb-3 text-left text-[var(--muted)]">
            Median reviews by band
          </caption>
          <thead>
            <tr className="border-b border-[var(--rule)]">
              <th className="py-2 text-left font-normal text-[var(--muted)]">
                Rating
              </th>
              <th className="py-2 text-right font-normal text-[var(--muted)]">
                Median reviews
              </th>
              <th className="py-2 text-right font-normal text-[var(--muted)]">
                Businesses
              </th>
            </tr>
          </thead>
          <tbody>
            {slice.bands.map((band) => (
              <tr key={band.label} className="border-b border-[var(--rule)]">
                <td className="tabular py-1.5">{band.label}</td>
                <td className="tabular py-1.5 text-right">
                  {band.medianReviews.toLocaleString()}
                </td>
                <td className="tabular py-1.5 text-right">
                  {band.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- section

/** Below this, a median is drawn from too few businesses to mean much. */
const THIN_SLICE = 50;

export function RatingExplorer({
  dataset,
  areaLabels,
}: {
  dataset: ChartDataset;
  areaLabels: string[];
}) {
  const [category, setCategory] = useState<number | null>(null);
  const [area, setArea] = useState<number | null>(null);

  // The whole-corpus figures, which the standing claim in the deck is about.
  // Computed once: it never changes, whatever the filters do.
  const baseline = useMemo(() => sliceDataset(dataset), [dataset]);

  const slice = useMemo(() => {
    const filter: ChartFilter = {};
    if (category !== null) filter.category = category;
    if (area !== null) filter.area = area;
    return sliceDataset(dataset, filter);
  }, [dataset, category, area]);

  /*
   * Columns are chosen from the unfiltered data, not the current slice.
   *
   * Picking them per slice would make the grid's x-axis reflow every time a
   * filter changed, and an axis that moves under the reader is worse than a
   * column of zeroes. In practice this drops "None": Google does not publish a
   * rating until at least one review exists, so that bucket is structurally
   * empty here — but a different engine could fill it, so it is dropped by
   * measurement rather than by assumption.
   */
  const columns = useMemo(() => {
    const kept = REVIEW_BUCKETS.map((_, j) => j).filter((j) =>
      baseline.heatmap.some((row) => (row[j] ?? 0) > 0),
    );
    return kept.length > 0 ? kept : REVIEW_BUCKETS.map((_, j) => j);
  }, [baseline]);

  const near = baseline.bands.find((b) => b.label === "4.5–4.9");
  const perfect = baseline.bands.find((b) => b.label === "5.0");
  const low = slice.bands[0];
  const lowShare =
    slice.matched > 0
      ? (((low?.count ?? 0) / slice.matched) * 100).toFixed(1)
      : "0";
  const filtered = category !== null || area !== null;
  const scope = filtered ? "this selection" : "the city";

  return (
    <section className="mt-20">
      <p className="label text-[var(--muted)]">The shape of the data</p>
      <h2 className="mt-3 max-w-2xl font-[family-name:var(--font-display)] text-3xl leading-[1.1]">
        A perfect score is usually a thin one
      </h2>
      <p className="mt-4 max-w-2xl text-[var(--muted)]">
        Google shows a star average but never how much evidence is behind it.
        Across the whole city a typical 4.5-to-4.9 business has{" "}
        <span className="tabular text-[var(--fg)]">
          {near?.medianReviews.toLocaleString()}
        </span>{" "}
        reviews behind it, while a typical 5.0 has{" "}
        <span className="tabular text-[var(--fg)]">
          {perfect?.medianReviews.toLocaleString()}
        </span>{" "}
        — which is why listings here are ranked by a rating weighted for
        evidence, not by stars alone. Narrow it to one category or one
        neighbourhood and all three charts redraw.
      </p>

      <FilterRow
        dataset={dataset}
        areaLabels={areaLabels}
        category={category}
        area={area}
        onCategory={setCategory}
        onArea={setArea}
        onReset={() => {
          setCategory(null);
          setArea(null);
        }}
        matched={slice.matched}
      />

      {slice.matched === 0 ? (
        <p className="mt-10 border border-[var(--rule)] p-6 text-[var(--muted)]">
          No rated businesses match that combination. Widen one of the two
          filters.
        </p>
      ) : (
        <>
          <ChartFrame
            className="mt-10"
            label="Rating against review count, businesses per cell"
          >
            <Heatmap slice={slice} columns={columns} />
          </ChartFrame>

          <ChartFrame
            className="mt-14"
            label="Businesses by rating, in 0.1 steps"
          >
            <Histogram
              bins={slice.bins}
              matched={slice.matched}
              note={[
                `${(low?.count ?? 0).toLocaleString()} businesses rate below ${(
                  low?.max ?? 3
                ).toFixed(1)}.`,
                `That is ${lowShare}% of ${scope}.`,
              ]}
            />
          </ChartFrame>

          <ChartFrame
            className="mt-14"
            label="Median reviews behind each rating"
          >
            <MedianReviews bands={slice.bands} />
          </ChartFrame>

          {slice.matched < THIN_SLICE && (
            <p className="mt-6 text-xs text-[var(--fg)]">
              Only {slice.matched.toLocaleString()} businesses match, so the
              medians above are drawn from very few records and will move a long
              way on one more review.
            </p>
          )}

          <p className="mt-8 text-xs text-[var(--muted)]">
            {slice.matched.toLocaleString()} rated businesses in view,{" "}
            {baseline.matched.toLocaleString()} in the corpus.{" "}
            {dataset.unrated.toLocaleString()} carry no rating and are excluded
            throughout. Ratings and review counts are Google&rsquo;s, as
            returned by SearchApi on the day of the crawl.
          </p>

          <Numbers slice={slice} />
        </>
      )}
    </section>
  );
}
