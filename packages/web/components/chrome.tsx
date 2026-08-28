import Link from "next/link";
import { breadcrumbJsonLd, serializeJsonLd } from "@directory/core";

import { crawledAt, formatCrawlDate } from "@/lib/data";
import { SITE_URL } from "@/lib/site";
import { SearchApiWordmark } from "./search-api-logo";

export function Header() {
  return (
    <header className="border-b border-[var(--rule)]">
      <div className="mx-auto flex max-w-5xl items-baseline gap-8 px-6 py-5">
        <div className="flex items-baseline gap-3">
          {/*
            A masthead, not a nav item.

            At 22px next to a 12px mono nav the wordmark read as a fourth link
            that happened to be serif. Size is the whole separation here — the
            design has no colour and Instrument Serif has no weight axis — so
            it takes a full step above the section headings to register as the
            one fixed thing on every page.

            Tracking is pulled tighter than the -0.01em the 2xl step carries by
            default. Display serifs are drawn with display spacing already built
            in; at wordmark size the default gaps read as a word that was typed
            rather than one that was set.
          */}
          <Link
            href="/"
            className="font-[family-name:var(--font-display)] text-2xl tracking-[-0.022em] whitespace-nowrap transition-opacity hover:opacity-60"
          >
            Directory
          </Link>
          {/*
            The one mark in a design that otherwise has none — see the
            amendment in docs/adr/0004-design-system.md. It is inside the
            masthead group rather than in the nav because it is a statement
            about what this is built on, not a place to go; the rule and the
            muted ink are what keep it from reading as a fourth link.

            Hidden below `sm` on space alone: at 375px the masthead and nav
            already use the full column. The footer credit carries the
            attribution on small screens.
          */}
          <a
            href="https://www.searchapi.io/"
            className="label hidden items-center gap-2 border-l border-[var(--rule)] pl-3 whitespace-nowrap text-[var(--muted)] transition-opacity hover:opacity-60 sm:flex"
          >
            Built on
            <SearchApiWordmark className="h-[18px] w-auto" />
            <span className="sr-only">SearchApi</span>
          </a>
        </div>
        <nav className="label flex gap-5 text-[var(--muted)]">
          <Link href="/categories" className="hover:text-[var(--fg)]">
            Categories
          </Link>
          <Link href="/areas" className="hover:text-[var(--fg)]">
            Areas
          </Link>
          <a
            href="https://github.com/pooyagolchian/business-directory-toolkit"
            className="hover:text-[var(--fg)]"
          >
            Source
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  /*
    The site's only freshness signal, and it goes here because it is true of
    every page: the whole dataset is bundled into the Lambda (ADR 0009), so it
    changes at deploy and at no other time.

    It is a <time> element rather than plain text so the date is machine-readable
    without a second copy in JSON-LD that could drift from what the reader sees.
    Answer engines discount undated local-business content, and local data decays
    monthly — saying nothing was the worse option, and saying "updated today" on
    every render would have been the dishonest one.
  */
  const crawled = crawledAt();

  return (
    <footer className="mt-24 border-t border-[var(--rule)]">
      <div className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-2 px-6 py-8 text-sm text-[var(--muted)]">
        <span>Business listings only. Takedown requests honoured.</span>
        {crawled && (
          <span>
            Data retrieved from Google Maps on{" "}
            <time dateTime={crawled}>{formatCrawlDate(crawled)}</time>.
          </span>
        )}
        <a
          href="https://github.com/pooyagolchian/business-directory-toolkit/blob/main/TAKEDOWN.md"
          className="underline underline-offset-4 hover:text-[var(--fg)]"
        >
          Request removal
        </a>
        {/*
          The logo replaces the word here rather than joining it. An underline
          under a wordmark reads as a mistake, so this link drops the footer's
          underline convention and takes the opacity hover the header credit
          uses. `currentColor` means it inherits the muted ink of the footer
          row without a second asset.
        */}
        <span className="ml-auto flex items-center gap-2">
          Data via
          <a
            href="https://www.searchapi.io/"
            className="flex items-center transition-opacity hover:opacity-60"
          >
            <SearchApiWordmark className="h-[18px] w-auto" />
            <span className="sr-only">SearchApi</span>
          </a>
        </span>
      </div>
    </footer>
  );
}

/** Consistent page shell: header, constrained column, footer. */
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-14">{children}</main>
      <Footer />
    </>
  );
}

/**
 * The visible trail AND its BreadcrumbList markup, from one array.
 *
 * They are emitted together deliberately. Marking up a hierarchy the visitor
 * cannot see is a structured-data violation, and two separate call sites would
 * drift — the same reasoning that keeps components/faq.tsx's FAQPage script
 * inside the block it describes.
 *
 * The tier this actually buys something on is /business/<slug>. Those 14,981
 * URLs are flat and state no hierarchy in the path, so the markup is the only
 * place the site says Atlantis is a Hotel in Palm Jumeirah. On the facet tiers
 * Google already reads a trail out of /area/al-barsha/restaurants.
 */
export function Breadcrumbs({
  trail,
}: {
  trail: Array<{ href?: string; label: string }>;
}) {
  const jsonLd = breadcrumbJsonLd(trail, SITE_URL);

  return (
    <nav aria-label="Breadcrumb" className="label mb-8 text-[var(--muted)]">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      {trail.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`}>
          {i > 0 && <span className="mx-2">/</span>}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:text-[var(--fg)]">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-[var(--fg)]">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function FacetGrid({
  items,
  hrefFor,
}: {
  items: Array<{ slug: string; label: string; count: number }>;
  hrefFor: (slug: string) => string;
}) {
  return (
    <ul className="grid grid-cols-1 gap-px bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.slug} className="bg-[var(--bg)]">
          <Link
            href={hrefFor(item.slug)}
            className="flex items-baseline justify-between gap-3 px-5 py-4 transition-opacity hover:opacity-60"
          >
            <span className="min-w-0 truncate text-base">{item.label}</span>
            <span className="tabular shrink-0 text-sm text-[var(--muted)]">
              {item.count.toLocaleString()}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
