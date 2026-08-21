import type {
  RatingBand,
  RatingBin,
  RatingDistribution,
} from "@directory/core";

/**
 * "What a rating is worth" — the home page's statistical figure.
 *
 * Two panels, one story. The histogram shows where a city's ratings actually
 * sit; the bar chart under it shows how much evidence stands behind each
 * rating. Read together they say the thing a star average cannot: the median
 * review count climbs all the way up the scale and then falls off a cliff at
 * exactly 5.0, because a perfect score is mostly a score nobody has tested.
 *
 * The two are deliberately NOT overlaid on shared axes. Counts and review
 * medians have unrelated scales, and pinning two y-scales to one plot invents
 * a visual correlation the data does not contain — the alignment between them
 * would be a choice we made, not a fact we measured.
 *
 * Everything renders on the server. There is no chart library and no client
 * component: hand-built SVG plus a `:hover` rule in globals.css costs the home
 * page zero kilobytes of JavaScript, which matters more here than it would
 * elsewhere because Milestone 2 exists to publish this page's latency numbers.
 */

// ---------------------------------------------------------------- scales

/**
 * A round number at or above `max`, and the tick step that reaches it.
 *
 * The 1 / 2 / 2.5 / 5 ladder is the standard one, and the reason to compute it
 * rather than hardcode 3,000 is that this is a toolkit: the same component has
 * to draw a 15,000-business Dubai and a 400-business market town without
 * anyone editing it (ADR 0005).
 */
function niceScale(
  max: number,
  intervals = 4,
): { ceiling: number; step: number } {
  if (max <= 0) return { ceiling: 1, step: 1 };
  const rough = max / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    ([1, 2, 2.5, 5, 10].find((m) => magnitude * m >= rough) ?? 10) * magnitude;
  return { ceiling: Math.ceil(max / step) * step, step };
}

function ticksTo(ceiling: number, step: number): number[] {
  const out: number[] = [];
  for (let v = 0; v <= ceiling + step / 2; v += step) out.push(v);
  return out;
}

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

// ---------------------------------------------------------------- panel 1

const H_W = 880;
const H_PAD_L = 46;
const H_PAD_R = 10;
const H_TOP = 30; // headroom for the one direct label and the hover tooltip
const H_PLOT = 176;
const H_AXIS = 26;
const H_HEIGHT = H_TOP + H_PLOT + H_AXIS;
const H_TRACK = H_W - H_PAD_L - H_PAD_R;
/** Capped well under the 20px band, so the air between bars does the separating. */
const H_BAR = 14;
const TIP_W = 116;
const TIP_H = 40;

function Histogram({
  bins,
  rated,
  note,
}: {
  bins: RatingBin[];
  rated: number;
  note: [string, string];
}) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  const { ceiling, step } = niceScale(max);
  const band = H_TRACK / bins.length;
  const peak = bins.reduce((a, b) => (b.count > a.count ? b : a), bins[0]!);

  return (
    <svg
      viewBox={`0 0 ${H_W} ${H_HEIGHT}`}
      className="block w-full min-w-[820px]"
      role="img"
      aria-label={`Histogram of ${rated.toLocaleString()} business ratings in 0.1 steps from 1.0 to 5.0. The tallest bar is ${peak.rating.toFixed(1)}, held by ${peak.count.toLocaleString()} businesses. Every value is listed in the table below.`}
    >
      {/* Gridlines, hairline and solid. Never dashed — a dashed rule reads as a
          threshold or a projection, and these are neither. */}
      {ticksTo(ceiling, step).map((tick) => {
        const y = H_TOP + H_PLOT - (tick / ceiling) * H_PLOT;
        return (
          <g key={tick}>
            <line
              x1={H_PAD_L}
              x2={H_W - H_PAD_R}
              y1={y}
              y2={y}
              stroke="var(--rule)"
              strokeWidth="1"
            />
            <text
              x={H_PAD_L - 10}
              y={y + 4}
              textAnchor="end"
              className="tabular fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px]"
            >
              {tick.toLocaleString()}
            </text>
          </g>
        );
      })}

      {bins.map((bin, i) => {
        const x = H_PAD_L + i * band;
        const barX = x + (band - H_BAR) / 2;
        // A bin holding four businesses is 0.3px tall at this scale, which
        // renders as nothing and reads as "no businesses rated 1.4" — a
        // different and false claim. Anything non-zero gets a visible floor;
        // zero stays zero, so the gaps in the low tail remain real gaps.
        const h =
          bin.count === 0 ? 0 : Math.max(1.5, (bin.count / ceiling) * H_PLOT);
        const y = H_TOP + H_PLOT - h;
        const isPeak = bin.rating === peak.rating;
        const tipX = clamp(x + band / 2 - TIP_W / 2, 0, H_W - TIP_W);
        const tipY = clamp(y - TIP_H - 6, 0, H_TOP + H_PLOT - TIP_H);
        const halfStep =
          Math.abs(bin.rating * 10 - Math.round((bin.rating * 10) / 5) * 5) <
          0.01;

        return (
          <g key={bin.rating} className="chart-col">
            {/* The hit area is the whole column, floor to ceiling. */}
            <rect
              className="chart-hit"
              x={x}
              y={H_TOP}
              width={band}
              height={H_PLOT}
            />
            {h > 0 && (
              <path
                className={`chart-mark${isPeak ? " chart-mark-emphasis" : ""}`}
                d={columnPath(barX, y, H_BAR, h)}
              />
            )}

            {/* X ticks every half star. Labelling all 41 would be noise. */}
            {halfStep && (
              <text
                x={x + band / 2}
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
                x={clamp(x + band / 2, 0, H_W - H_PAD_R - 18)}
                y={y - 10}
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
        The left two-fifths of this plot are empty, and that emptiness is the
        finding rather than a layout accident: a city that rates almost nothing
        below 3.5 is not using the bottom of the scale at all. Annotating the
        gap says so, and stops it reading as a chart that failed to load.
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
        y1={H_TOP + H_PLOT}
        y2={H_TOP + H_PLOT}
        stroke="var(--fg)"
        strokeWidth="1"
      />
    </svg>
  );
}

// ---------------------------------------------------------------- panel 2

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
function MedianReviews({ bands }: { bands: RatingBand[] }) {
  const max = Math.max(...bands.map((b) => b.medianReviews), 1);
  const { ceiling } = niceScale(max, 3);
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
      <text
        x={0}
        y={12}
        className="fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.07em]"
      >
        Rating
      </text>
      <text
        x={B_TRACK_X}
        y={12}
        className="fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.07em]"
      >
        Median reviews
      </text>
      <text
        x={B_W}
        y={12}
        textAnchor="end"
        className="fill-[var(--muted)] font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.07em]"
      >
        Businesses
      </text>
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
        const w =
          band.medianReviews === 0
            ? 0
            : Math.max(2, (band.medianReviews / ceiling) * B_TRACK_W);
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
            {w > 0 && (
              <path
                className={`chart-mark${isPerfect ? " chart-mark-emphasis" : ""}`}
                d={barPath(B_TRACK_X, barY, w, B_BAR_H)}
              />
            )}
            <text
              x={B_TRACK_X + w + 10}
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

// ---------------------------------------------------------------- figure

/**
 * The table is not a fallback, it is the other half of the figure.
 *
 * Every number the SVG draws or reveals on hover is here in text, which is what
 * makes the plot safe to expose to assistive technology as a single labelled
 * image rather than as 41 focusable columns nobody wants to tab through.
 */
function Numbers({ bins, bands }: { bins: RatingBin[]; bands: RatingBand[] }) {
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
            {bins
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
            {bands.map((band) => (
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

export function RatingDistributionFigure({
  distribution,
}: {
  distribution: RatingDistribution;
}) {
  const { bins, bands, rated, unrated } = distribution;
  if (rated === 0) return null;

  const near = bands.find((b) => b.label === "4.5–4.9");
  const perfect = bands.find((b) => b.label === "5.0");
  const low = bands[0];
  const lowShare = (((low?.count ?? 0) / rated) * 100).toFixed(1);

  return (
    <section className="mt-20">
      <p className="label text-[var(--muted)]">The shape of the data</p>
      <h2 className="mt-3 max-w-2xl font-[family-name:var(--font-display)] text-3xl leading-[1.1]">
        A perfect score is usually a thin one
      </h2>
      <p className="mt-4 max-w-2xl text-[var(--muted)]">
        Half of everything here rates between 4.5 and 4.9, and{" "}
        <span className="tabular text-[var(--fg)]">
          {perfect?.count.toLocaleString()}
        </span>{" "}
        businesses show a flawless 5.0 — the single most common rating in the
        city. The second chart is why that is not the compliment it looks like.
        Median review count climbs steadily with rating and then collapses at
        the top: a typical 4.5-to-4.9 business has{" "}
        <span className="tabular text-[var(--fg)]">
          {near?.medianReviews.toLocaleString()}
        </span>{" "}
        reviews behind it, a typical 5.0 has{" "}
        <span className="tabular text-[var(--fg)]">
          {perfect?.medianReviews.toLocaleString()}
        </span>
        . It is the reason listings here are ordered by a rating weighted for
        how much evidence stands behind it, rather than by stars alone.
      </p>

      <figure className="mt-10">
        <figcaption className="label mb-4 text-[var(--muted)]">
          Businesses by rating, in 0.1 steps
        </figcaption>
        <div className="overflow-x-auto">
          <Histogram
            bins={bins}
            rated={rated}
            note={[
              `${low?.count.toLocaleString() ?? "0"} businesses rate below ${(
                low?.max ?? 3
              ).toFixed(1)}.`,
              `That is ${lowShare}% of the city.`,
            ]}
          />
        </div>
      </figure>

      <figure className="mt-14">
        <figcaption className="label mb-4 text-[var(--muted)]">
          Median reviews behind each rating
        </figcaption>
        <div className="overflow-x-auto">
          <MedianReviews bands={bands} />
        </div>
      </figure>

      <p className="mt-8 text-xs text-[var(--muted)]">
        {rated.toLocaleString()} rated businesses. {unrated.toLocaleString()}{" "}
        carry no rating and are excluded. Ratings and review counts are
        Google&rsquo;s, as returned by SearchApi on the day of the crawl.
      </p>

      <Numbers bins={bins} bands={bands} />
    </section>
  );
}
