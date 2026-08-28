import type { Metadata } from "next";
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic,
  Instrument_Serif,
} from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} ${arabic.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
