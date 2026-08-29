import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { areas, categories, cityName, stats } from "@/lib/data";
import { SITE_HOST, SITE_NAME } from "@/lib/site";

/**
 * The site's Open Graph card.
 *
 * ONE image, at the root, on purpose. File-based metadata resolves from the
 * nearest ancestor, so this single route covers all ~15,900 URLs with no
 * per-route work. Colocating a card under business/[slug] instead would mean
 * ~500 build-time renders plus a 14,000-page on-demand tail, for listings
 * nobody shares individually. The tier worth revisiting later is
 * area/[area]/[l2] — 782 pages, already fully prerendered.
 *
 * This is a static segment with no params, so it is rasterised once at build
 * and served as a static asset. There is no per-request Lambda here, which is
 * what keeps it clear of next.config.ts's rule about origin hits.
 *
 * THREE THINGS THAT LOOK WRONG AND ARE NOT:
 *
 * 1. Hex, not the oklch tokens in globals.css. Satori's rasteriser has no oklch
 *    support whatsoever — it does not warn, it renders the whole card black at
 *    HTTP 200. The neutral ramp is chroma 0, so #000/#fff is an exact
 *    conversion of --color-ink-1000 and --color-paper, not an approximation.
 * 2. Fonts read off disk from ../assets rather than reused from next/font.
 *    Satori reads ttf/otf/woff; next/font emits woff2 only. See assets/README.md.
 * 3. Inline styles and flexbox only. Satori supports no grid and no stylesheet,
 *    so Tailwind classes would silently do nothing here.
 */

/*
 * Split the site name for the masthead: the first word set large in the display
 * serif, the remainder as the rule-separated small-caps label beside it — the
 * treatment the site header already uses. Deriving it means a fork's card
 * carries the fork's name instead of this deployment's.
 *
 * A single-word name renders without the second half.
 */
const [wordmark, ...rest] = SITE_NAME.split(" ");
const tagline = rest.join(" ");

export const alt = `${SITE_NAME} — open-source local business search`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const display = await readFile(
  join(process.cwd(), "assets", "InstrumentSerif-Regular.ttf"),
);
const sans = await readFile(
  join(process.cwd(), "assets", "IBMPlexSans-Regular.ttf"),
);

// The monochrome ramp, resolved out of oklch. See note 1 above.
const INK = "#000000";
const PAPER = "#ffffff";
const MUTED = "#7a7a7a";
const RULE = "#e0e0e0";

export default async function Image() {
  const s = stats();
  const city = cityName();

  // An unpopulated deployment is a valid state — the homepage renders an honest
  // empty state for it, and the card must not claim "0 businesses" as a feature.
  const populated = s.businesses > 0;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: PAPER,
        color: INK,
        padding: "72px 80px",
      }}
    >
      {/* Masthead. The wordmark is the one fixed thing on every page, and the
            card is no exception — same face, same tight tracking as the header. */}
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <div
          style={{
            fontFamily: "Instrument Serif",
            fontSize: 44,
            letterSpacing: "-0.022em",
          }}
        >
          {wordmark}
        </div>
        {tagline && (
          <div
            style={{
              fontFamily: "IBM Plex Sans",
              fontSize: 17,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: MUTED,
              marginLeft: 22,
              paddingLeft: 22,
              borderLeft: `1px solid ${RULE}`,
            }}
          >
            {tagline}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontFamily: "Instrument Serif",
            fontSize: 104,
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>Find a business</span>
          <span>in {city}</span>
        </div>

        {populated && (
          <div
            style={{
              display: "flex",
              marginTop: 44,
              borderTop: `1px solid ${RULE}`,
              paddingTop: 26,
            }}
          >
            {[
              { v: s.businesses.toLocaleString(), l: "businesses" },
              { v: categories().length.toLocaleString(), l: "categories" },
              { v: areas().length.toLocaleString(), l: "neighbourhoods" },
            ].map((stat) => (
              <div
                key={stat.l}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginRight: 72,
                }}
              >
                <div style={{ fontFamily: "IBM Plex Sans", fontSize: 40 }}>
                  {stat.v}
                </div>
                <div
                  style={{
                    fontFamily: "IBM Plex Sans",
                    fontSize: 16,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: MUTED,
                    marginTop: 8,
                  }}
                >
                  {stat.l}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "IBM Plex Sans",
          fontSize: 19,
          color: MUTED,
        }}
      >
        <span>{SITE_HOST}</span>
        <span>Open source · Built on SearchApi</span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Instrument Serif",
          data: display,
          style: "normal",
          weight: 400,
        },
        { name: "IBM Plex Sans", data: sans, style: "normal", weight: 400 },
      ],
    },
  );
}
