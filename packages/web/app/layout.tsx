import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  IBM_Plex_Sans_Arabic,
  Instrument_Serif,
} from "next/font/google";
import "./globals.css";

// Self-hosted via next/font: no external request, no layout shift, and the
// Arabic face is a real choice rather than a system fallback — Dubai listing
// titles are routinely bilingual.
const display = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
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
