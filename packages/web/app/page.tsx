import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { FacetGrid, Footer, Header } from "@/components/chrome";
import { BusinessList } from "@/components/business-card";
import { allBusinesses, areas, categories, stats } from "@/lib/data";

export default function Home() {
  const s = stats();
  const topCategories = categories().slice(0, 12);
  const topAreas = areas().slice(0, 12);
  // The dataset is sorted by review count at load, so the head is the most
  // reviewed businesses in the city.
  const notable = allBusinesses().slice(0, 8);

  const empty = s.businesses === 0;

  return (
    <>
      <Header />

      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <h1 className="font-[family-name:var(--font-display)] text-4xl leading-[1.05] tracking-tight sm:text-6xl">
          Find a business
          <br />
          in Dubai
        </h1>

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
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
