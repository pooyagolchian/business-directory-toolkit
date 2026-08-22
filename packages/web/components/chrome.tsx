import Link from "next/link";

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
            href="https://github.com/pooyagolchian/directory-from-scratch"
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
  return (
    <footer className="mt-24 border-t border-[var(--rule)]">
      <div className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-2 px-6 py-8 text-sm text-[var(--muted)]">
        <span>Business listings only. Takedown requests honoured.</span>
        <a
          href="https://github.com/pooyagolchian/directory-from-scratch/blob/main/TAKEDOWN.md"
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

export function Breadcrumbs({
  trail,
}: {
  trail: Array<{ href?: string; label: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb" className="label mb-8 text-[var(--muted)]">
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
