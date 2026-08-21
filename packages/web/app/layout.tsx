import type { Metadata } from "next";
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic,
  Instrument_Serif,
} from "next/font/google";
import "./globals.css";

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
  metadataBase: new URL("https://directory.pooyagolchian.com"),
  title: {
    default: "Directory from Scratch — Dubai business search",
    template: "%s · Directory from Scratch",
  },
  description:
    "An open-source Dubai business search engine, built in public on SearchApi's Google Maps engine.",
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
