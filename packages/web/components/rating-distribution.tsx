import type { RatingBand, RatingBin } from "@directory/core";
import { scaleBand, scaleLinear } from "d3-scale";

/**
 * The presentational chart pieces. No state, no data access, no "use client" —
 * they are plain functions of their props, so they render identically on the
 * server for the first paint and in the browser on every filter change.
 *
 * D3 is used for what D3 is actually good at: scales. `scaleLinear().nice()`
 * picks the round axis ceiling, `scaleBand()` does the bin geometry, and React
 * owns the DOM. Pulling in d3-selection to imperatively append <rect>s inside a
 * React tree would give two things authority over the same nodes, which is the
 * classic way these two libraries break each other.
 */

/** Guards a degenerate domain: a filter can select a slice where nothing exists. */
const atLeastOne = (n: number) => Math.max(1, n);

/**
 * A bar with a rounded data-end and a square baseline.
 *
 * The radius clamps to the bar's own height, because the shortest bins in a
 * rating histogram are two pixels tall and a 4px radius on a 2px bar renders
 * as a lens rather than a bar.
 */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + w - r},${y}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join("");
}

function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h / 2, w);
  return [
    `M${x},${y}`,
    `L${x + w - r},${y}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `L${x + w},${y + h - r}`,
    `Q${x + w},${y + h} ${x + w - r},${y + h}`,
    `L${x},${y + h}`,
    "Z",
  ].join("");
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

// ---------------------------------------------------------------- histogram

const H_W = 880;
const H_PAD_L = 46;
const H_PAD_R = 10;
const H_TOP = 30; // headroom for the one direct label and the hover tooltip
const H_PLOT = 176;
const H_AXIS = 26;
const H_HEIGHT = H_TOP + H_PLOT + H_AXIS;
/** Capped well under the 20px band, so the air between bars does the separating. */
const H_BAR = 14;
const TIP_W = 116;
const TIP_H = 40;

export function Histogram({
  bins,
  matched,
  note,
}: {
  bins: RatingBin[];
  matched: number;
  note: [string, string];
}) {
  const max = Math.max(...bins.map((b) => b.count), 0);
  const y = scaleLinear()
    .domain([0, atLeastOne(max)])
    .nice(4)
    .range([H_TOP + H_PLOT, H_TOP]);
  const x = scaleBand<number>()
    .domain(bins.map((b) => b.rating))
    .range([H_PAD_L, H_W - H_PAD_R]);
  const band = x.bandwidth();
  const peak = bins.reduce((a, b) => (b.count > a.count ? b : a), bins[0]!);

  return (
    <svg
      viewBox={`0 0 ${H_W} ${H_HEIGHT}`}
      className="block w-full min-w-[820px]"
      role="img"
      aria-label={`Histogram of ${matched.toLocaleString()} business ratings in 0.1 steps from 1.0 to 5.0. The tallest bar is ${peak.rating.toFixed(1)}, held by ${peak.count.toLocaleString()} businesses. Every value is listed in the table below.`}
    >
      {/* Gridlines, hairline and solid. Never dashed — a dashed rule reads as a
          threshold or a projection, and these are neither. */}
      {y.ticks(4).map((tick) => (
        <g key={tick}>
          <line
            x1={H_PAD_L}
            x2={H_W - H_PAD_R}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--rule)"
            strokeWidth="1"
          />
          <text
            x={H_PAD_L - 10}
            y={y(tick) + 4}
            textAnchor="end"
            className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
          >
            {tick.toLocaleString()}
          </text>
        </g>
      ))}

      {bins.map((bin) => {
        const left = x(bin.rating) ?? H_PAD_L;
        const barX = left + (band - H_BAR) / 2;
        // A bin holding four businesses is a fraction of a pixel tall, which
        // renders as nothing and reads as "no businesses rated 1.4" — a
        // different and false claim. Anything non-zero gets a visible floor;
        // zero stays zero, so the gaps in the low tail remain real gaps.
        const top = bin.count === 0 ? y(0) : Math.min(y(bin.count), y(0) - 1.5);
        const h = y(0) - top;
        const isPeak = bin.rating === peak.rating && peak.count > 0;
        const tipX = clamp(left + band / 2 - TIP_W / 2, 0, H_W - TIP_W);
        const tipY = clamp(top - TIP_H - 6, 0, H_TOP + H_PLOT - TIP_H);
        const onHalfStep =
          Math.abs(bin.rating * 10 - Math.round((bin.rating * 10) / 5) * 5) <
          0.01;

        return (
          <g key={bin.rating} className="chart-col">
            {/* The hit area is the whole column, floor to ceiling. */}
            <rect
              className="chart-hit"
              x={left}
              y={H_TOP}
              width={band}
              height={H_PLOT}
            />
            {h > 0 && (
              <path
                className={`chart-mark${isPeak ? " chart-mark-emphasis" : ""}`}
                d={columnPath(barX, top, H_BAR, h)}
              />
            )}

            {/* X ticks every half star. Labelling all 41 would be noise. */}
            {onHalfStep && (
              <text
                x={left + band / 2}
                y={H_TOP + H_PLOT + 18}
                textAnchor="middle"
                className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
              >
                {bin.rating.toFixed(1)}
              </text>
            )}

            {/* One direct label, on the bar the figure is about. Sparing is the
                point — a value over all 41 columns would go unread. */}
            {isPeak && (
              <text
                x={clamp(left + band / 2, 0, H_W - H_PAD_R - 18)}
                y={top - 10}
                textAnchor="middle"
                className="tabular fill-[var(--fg)] font-[family-name:var(--font-mono)] text-[12px]"
              >
                {bin.count.toLocaleString()}
              </text>
            )}

            <g className="chart-tip">
              <rect
                x={tipX}
                y={tipY}
                width={TIP_W}
                height={TIP_H}
                fill="var(--bg)"
                stroke="var(--rule)"
                strokeWidth="1"
              />
              {/* Value first, label second: the reader already knows which bar
                  they are pointing at and wants the number. */}
              <text
                x={tipX + 12}
                y={tipY + 18}
                className="tabular fill-[var(--fg)] font-[family-name:var(--font-mono)] text-[13px]"
              >
                {bin.count.toLocaleString()}
              </text>
              <text
                x={tipX + 12}
                y={tipY + 31}
                className="fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
              >
                rated {bin.rating.toFixed(1)}
              </text>
            </g>
          </g>
        );
      })}

      {/*
        The left of this plot empties out, and that emptiness is the finding
        rather than a layout accident: a city that rates almost nothing below
        3.5 is not using the bottom of the scale at all. Annotating the gap says
        so, and stops it reading as a chart that failed to load.
      */}
      <text
        x={H_PAD_L + 14}
        y={H_TOP + H_PLOT - 38}
        className="tabular fill-[var(--fg)] font-[family-name:var(--font-mono)] text-[12px]"
      >
        {note[0]}
      </text>
      <text
        x={H_PAD_L + 14}
        y={H_TOP + H_PLOT - 20}
        className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[12px]"
      >
        {note[1]}
      </text>

      {/* Baseline drawn last so the bars sit on it rather than through it. */}
      <line
        x1={H_PAD_L}
        x2={H_W - H_PAD_R}
        y1={y(0)}
        y2={y(0)}
        stroke="var(--fg)"
        strokeWidth="1"
      />
    </svg>
  );
}

// ---------------------------------------------------------------- medians

const B_W = 880;
const B_ROW = 34;
const B_HEAD = 26;
const B_TRACK_X = 104;
const B_TRACK_W = 500;
const B_BAR_H = 16;

/**
 * Median reviews per rating band, as horizontal bars.
 *
 * Horizontal because the categories are named rather than numbered, and a
 * vertical version would set "Below 3.0" on its side. Every bar carries its
 * value at the tip and its sample size on the right, so there are no gridlines
 * here — direct labels come before gridlines, and gridlines before a second
 * axis. Nothing is behind a hover, which is why this panel has no tooltip.
 */
export function MedianReviews({ bands }: { bands: RatingBand[] }) {
  const max = Math.max(...bands.map((b) => b.medianReviews), 0);
  const w = scaleLinear()
    .domain([0, atLeastOne(max)])
    .nice(3)
    .range([0, B_TRACK_W]);
  const height = B_HEAD + bands.length * B_ROW;
  // The story is the band that breaks the pattern, so that is the one in ink.
  const perfect = bands.at(-1);

  return (
    <svg
      viewBox={`0 0 ${B_W} ${height}`}
      className="block w-full min-w-[820px]"
      role="img"
      aria-label={`Median review count for each rating band. ${bands
        .map((b) => `${b.label}: ${b.medianReviews.toLocaleString()}`)
        .join("; ")}.`}
    >
      {[
        { x: 0, anchor: "start" as const, text: "Rating" },
        { x: B_TRACK_X, anchor: "start" as const, text: "Median reviews" },
        { x: B_W, anchor: "end" as const, text: "Businesses" },
      ].map((head) => (
        <text
          key={head.text}
          x={head.x}
          y={12}
          textAnchor={head.anchor}
          className="fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px] tracking-[0.07em] uppercase"
        >
          {head.text}
        </text>
      ))}
      <line
        x1={0}
        x2={B_W}
        y1={B_HEAD - 8}
        y2={B_HEAD - 8}
        stroke="var(--rule)"
        strokeWidth="1"
      />

      {bands.map((band, i) => {
        const y = B_HEAD + i * B_ROW;
        const barY = y + (B_ROW - B_BAR_H) / 2 - 4;
        const width =
          band.medianReviews === 0 ? 0 : Math.max(2, w(band.medianReviews));
        const isPerfect = band.label === perfect?.label;

        return (
          <g key={band.label} className="chart-col">
            <rect
              className="chart-hit"
              x={0}
              y={y - 2}
              width={B_W}
              height={B_ROW}
            />
            <text
              x={0}
              y={barY + B_BAR_H - 3}
              className={`tabular font-[family-name:var(--font-mono)] text-[12px] ${
                isPerfect ? "fill-[var(--fg)]" : "fill-[var(--muted)]"
              }`}
            >
              {band.label}
            </text>
            {width > 0 && (
              <path
                className={`chart-mark${isPerfect ? " chart-mark-emphasis" : ""}`}
                d={barPath(B_TRACK_X, barY, width, B_BAR_H)}
              />
            )}
            <text
              x={B_TRACK_X + width + 10}
              y={barY + B_BAR_H - 3}
              className="tabular fill-[var(--fg)] font-[family-name:var(--font-mono)] text-[12px]"
            >
              {band.medianReviews.toLocaleString()}
            </text>
            <text
              x={B_W}
              y={barY + B_BAR_H - 3}
              textAnchor="end"
              className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[12px]"
            >
              {band.count.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------- frame

/**
 * One figure: a caption, and a plot that scrolls rather than shrinks.
 *
 * The plot holds its width instead of scaling down to the viewport, because
 * SVG text scales with the viewBox — fitting 41 bins onto a phone would set the
 * axis labels at four pixels. Scrolling is the honest trade, so the narrow
 * widths where it actually happens get told about it.
 */
export function ChartFrame({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <figure className={className}>
      <figcaption className="mb-4 flex items-baseline justify-between gap-4">
        <span className="label text-[var(--muted)]">{label}</span>
        <span className="label shrink-0 text-[var(--muted)] sm:hidden">
          Scroll &rarr;
        </span>
      </figcaption>
      <div className="overflow-x-auto">{children}</div>
    </figure>
  );
}
