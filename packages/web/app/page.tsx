import type { Metadata } from "next";
import Link from "next/link";
import { buildChartDataset } from "@directory/core";
import { SearchBox } from "@/components/search-box";
import { FacetGrid, Footer, Header } from "@/components/chrome";
import { BusinessList } from "@/components/business-card";
import { RatingExplorer } from "@/components/rating-explorer";
import {
  allBusinesses,
  areaLabel,
  areas,
  categories,
  cityName,
  crawledAt,
  formatCrawlDate,
  stats,
} from "@/lib/data";

/**
 * The one route that had no metadata export at all, and so no canonical — the
 * highest-authority URL on the domain was the only one not self-canonicalising.
 * The description is written for the homepage rather than inherited from the
 * layout, because the layout's copy describes the project and this page
 * describes the corpus.
 */
export async function generateMetadata(): Promise<Metadata> {
  const s = stats();
  const city = cityName();
  return {
    // Derived, not written down. A fork crawling Lisbon must not ship a
    // description advertising Dubai, and the count has to move with the corpus
    // or it becomes a claim the page cannot support (ADR 0005).
    //
    // An un-crawled deployment is a SUPPORTED state — the page below renders an
    // honest "No data yet" for it — so the description must not advertise
    // "0 businesses" while the page says the crawl has not run. This is the
    // og:description on every share of a fresh fork.
    description: s.businesses
      ? `Search ${s.businesses.toLocaleString()} ${city} businesses across ` +
        `${s.categories} categories and ${s.areas} neighbourhoods — by name, ` +
        `category, neighbourhood, or phone number. Open source, built in public ` +
        `on SearchApi's Google Maps engine.`
      : `An open-source ${city} business directory, built in public on ` +
        `SearchApi's Google Maps engine. No crawl has run for this deployment yet.`,
    alternates: { canonical: "/" },
  };
}

export default function Home() {
  const s = stats();
  const topCategories = categories().slice(0, 12);
  const topAreas = areas().slice(0, 12);
  // The dataset is sorted by review count at load, so the head is the most
  // reviewed businesses in the city.
  const notable = allBusinesses().slice(0, 8);
  // One linear pass over the corpus, at render time rather than at load, so the
  // figure describes whatever city this deployment was built for.
  const dataset = buildChartDataset(allBusinesses());
  // Area labels are resolved here because areaLabel() reads the city config off
  // disk; resolving them inside the client component would drag node:fs into
  // the browser bundle.
  const areaLabels = dataset.areas.map(areaLabel);

  const empty = s.businesses === 0;
  const crawled = crawledAt();

  return (
    <>
      <Header />

      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <h1 className="font-[family-name:var(--font-display)] text-4xl leading-[1.05] tracking-tight sm:text-6xl">
          Find a business
          <br />
          in {cityName()}
        </h1>

        {/*
          A lede that states the corpus in one extractable sentence.

          The <h1> above asserts nothing — "Find a business in Dubai" is an
          instruction — and the figures under it live in a <dl> grid, which is
          the right markup for labelled pairs but is not a sentence anything can
          quote. An answer engine lifting from this page had nothing to lift.

          The money-page template already proves the pattern: "109 restaurants
          in Al Barsha, Dubai. 104 list a phone number, and the average Google
          rating across 107 rated listings is 4.4" extracts cleanly on its own.
          This is the same move for the homepage, and the grid stays exactly as
          it was — this adds a sentence, it does not replace the numbers.
        */}
        {!empty && (
          <p className="mt-6 max-w-2xl text-lg text-[var(--muted)]">
            This directory lists{" "}
            <span className="tabular">{s.businesses.toLocaleString()}</span>{" "}
            businesses in {cityName()}, across{" "}
            <span className="tabular">{s.categories}</span> categories and{" "}
            <span className="tabular">{s.areas}</span> neighbourhoods, compiled
            from Google Maps data
            {crawled && <> and last retrieved on {formatCrawlDate(crawled)}</>}.
          </p>
        )}

        <div className="mt-10 max-w-2xl">
          <SearchBox />
          <p className="mt-4 text-sm text-[var(--muted)]">
            Search by name, category, neighbourhood — or paste a{" "}
            <span className="tabular">+971</span> number to find who it belongs
            to.
          </p>
        </div>

        {empty ? (
          <div className="mt-16 border border-[var(--rule)] p-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              No data yet
            </h2>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              This deployment has no crawl output. Run{" "}
              <code className="font-mono">pnpm crawl --city dubai --yes</code>{" "}
              then <code className="font-mono">pnpm load</code> to populate it,
              or point <code className="font-mono">DIRECTORY_CITY</code> at a
              city you have already crawled.
            </p>
          </div>
        ) : (
          <>
            <dl className="mt-16 grid grid-cols-2 gap-px bg-[var(--rule)] sm:grid-cols-4">
              {[
                { v: s.businesses.toLocaleString(), l: "businesses" },
                { v: s.categories.toLocaleString(), l: "categories" },
                { v: s.areas.toLocaleString(), l: "neighbourhoods" },
                {
                  v: `${Math.round((100 * s.withPhone) / s.businesses)}%`,
                  l: "with a phone number",
                },
              ].map((stat) => (
                <div key={stat.l} className="bg-[var(--bg)] p-5">
                  <dt className="tabular text-3xl">{stat.v}</dt>
                  <dd className="label mt-2 text-[var(--muted)]">{stat.l}</dd>
                </div>
              ))}
            </dl>

            <section className="mt-20">
              <div className="flex items-baseline justify-between">
                <h2 className="font-[family-name:var(--font-display)] text-2xl">
                  Browse by category
                </h2>
                <Link
                  href="/categories"
                  className="label text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  All {s.categories}
                </Link>
              </div>
              <div className="mt-5">
                <FacetGrid
                  items={topCategories}
                  hrefFor={(slug) => `/category/${slug}`}
                />
              </div>
            </section>

            <section className="mt-20">
              <div className="flex items-baseline justify-between">
                <h2 className="font-[family-name:var(--font-display)] text-2xl">
                  Browse by neighbourhood
                </h2>
                <Link
                  href="/areas"
                  className="label text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  All {s.areas}
                </Link>
              </div>
              <div className="mt-5">
                <FacetGrid
                  items={topAreas}
                  hrefFor={(slug) => `/area/${slug}`}
                />
              </div>
            </section>

            <section className="mt-20">
              <h2 className="font-[family-name:var(--font-display)] text-2xl">
                Most reviewed
              </h2>
              <BusinessList businesses={notable} />
            </section>

            {/* Deliberately last. "Most reviewed" is the page saying which
                businesses have the most evidence behind them; this is the page
                explaining why that is the measure it sorts on. */}
            <RatingExplorer dataset={dataset} areaLabels={areaLabels} />
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
