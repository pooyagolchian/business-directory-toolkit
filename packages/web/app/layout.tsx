import type { Metadata } from "next";
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic,
  Instrument_Serif,
} from "next/font/google";
import "./globals.css";
import { publisherJsonLd, serializeJsonLd } from "@directory/core";
import { cityName, stats } from "@/lib/data";
import {
  AUTHOR_NAME,
  AUTHOR_URL,
  REPO_URL,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

// Self-hosted via next/font: no external request, no layout shift, and the
// Arabic face is a real choice rather than a system fallback — Dubai listing
// titles are routinely bilingual.

// Display only, and that restriction is the point. Instrument Serif is a
// high-contrast editorial face whose hairlines thin out badly below ~22px; it
// was previously setting every list-row title at 18px, where it read lighter
// and smaller than the sans around it. Kept for headings, where it earns the
// editorial character ADR 0004 asked typography to carry, and kept away from
// anything that gets scanned rather than read.
const display = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

// No `weight`, so next/font takes the variable cut: one file covering 100–700
// rather than a request per weight. That matters more than usual here, because
// with no colour in the design weight carries a third of the hierarchy — 400
// for text against 600 for titles — and a static pair would mean two downloads
// to say that.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  display: "swap",
});

// Plex Mono has no variable cut, and only one weight is ever asked of it.
const mono = IBM_Plex_Mono({
  weight: ["400"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

const arabic = IBM_Plex_Sans_Arabic({
  weight: ["400", "600"],
  subsets: ["arabic"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Directory from Scratch — Dubai business search",
    template: "%s · Directory from Scratch",
  },
  description:
    "An open-source Dubai business search engine, built in public on SearchApi's Google Maps engine.",

  /*
   * NOTE WHAT IS ABSENT: openGraph.title and openGraph.description.
   *
   * Leaving them unset is what makes this block work for all ~15,900 URLs
   * instead of one. Next copies each route's already-resolved title and
   * description into openGraph only when an openGraph object exists but those
   * keys do not, and the twitter auto-fill hangs off the same condition — so
   * declaring the object here, and nothing more, hands every route its own
   * og:title for free.
   *
   * Setting them would be actively worse than the current absence: the
   * `title.template` above does NOT apply to og:title (Next reads the OG
   * template from openGraph.title.template instead), so a literal here would
   * freeze one og:title across every business, area and category page on the
   * site.
   *
   * Route-level metadata REPLACES rather than merges, so `images` deliberately
   * does not live here either — seven of the eight route files export their own
   * metadata and would each drop it. The image comes from the
   * app/opengraph-image.tsx file convention, which outranks this object and
   * resolves from the nearest ancestor, i.e. everywhere.
   */
  openGraph: {
    type: "website",
    siteName: "Directory from Scratch",
    locale: "en_AE",
    // `url` is deliberately absent too, and for a different reason than the
    // title. Because route metadata REPLACES this object rather than merging
    // into it, a per-route og:url would mean re-declaring type/siteName/locale
    // in all seven route files. Setting it once here is worse still: it is not
    // a template, so every one of ~15,900 pages would claim the homepage as its
    // canonical URL and every share would be attributed to `/`. Omitted, an
    // unfurler falls back to the URL it actually fetched, which is right.
  },
  twitter: { card: "summary_large_image" },

  /*
   * Let Google quote as much of a page as it wants.
   *
   * The default snippet length is short, and every listing page's value is a
   * handful of specific facts — a phone number, a count, an opening time. A
   * truncated snippet is the one that omits the fact somebody searched for.
   *
   * `max-image-preview` is included for completeness and does nothing today:
   * the pages carry zero <img> tags by design (ADR 0004). It costs nothing and
   * becomes correct the day that changes.
   *
   * Route metadata REPLACES this object rather than merging, which is the right
   * behaviour here — /search and the sub-threshold facet pages set their own
   * `robots` with index:false, and a noindex page has no snippet to size.
   */
  robots: {
    index: true,
    follow: true,
    googleBot: { "max-snippet": -1, "max-image-preview": "large" },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
    Publisher identity, on every page.

    The site emitted zero Organization and zero WebSite markup, so nothing
    machine-readable connected the domain to its author or its source. For a
    directory whose entire credibility argument is provenance — "here is where
    this data came from, here is when, here is the code that fetched it" — that
    argument was invisible to exactly the answer engines it was meant to
    persuade.

    It lives in the layout rather than in a route because it is true of the
    whole site, and in the body rather than in the metadata object because
    Next's Metadata API has no slot for arbitrary JSON-LD.

    Deliberately no SearchAction: Google retired the sitelinks searchbox in late
    2024, and /search is Disallow-ed in robots.ts, so it would point crawlers at
    the one route we ask them not to crawl.
  */
  const s = stats();
  const publisher = publisherJsonLd({
    siteUrl: SITE_URL,
    siteName: SITE_NAME,
    description: `An open-source directory of ${s.businesses.toLocaleString()} businesses in ${cityName()}, built from Google Maps data via SearchApi.`,
    repoUrl: REPO_URL,
    authorName: AUTHOR_NAME,
    authorUrl: AUTHOR_URL,
  });

  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} ${arabic.variable}`}
    >
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(publisher) }}
        />
        {children}
      </body>
    </html>
  );
}
