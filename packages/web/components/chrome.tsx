import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-[var(--rule)]">
      <div className="mx-auto flex max-w-5xl items-baseline gap-6 px-6 py-4">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-lg whitespace-nowrap"
        >
          Directory
        </Link>
        <nav className="flex gap-5 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
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
      <div className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-2 px-6 py-6 text-xs text-[var(--muted)]">
        <span>Business listings only. Takedown requests honoured.</span>
        <a
          href="https://github.com/pooyagolchian/directory-from-scratch/blob/main/TAKEDOWN.md"
          className="underline underline-offset-4 hover:text-[var(--fg)]"
        >
          Request removal
        </a>
        <span className="ml-auto">
          Data via{" "}
          <a
            href="https://www.searchapi.io/"
            className="underline underline-offset-4 hover:text-[var(--fg)]"
          >
            SearchApi
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
      <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
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
    <nav
      aria-label="Breadcrumb"
      className="mb-6 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"
    >
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
            className="flex items-baseline justify-between gap-3 p-4 transition-opacity hover:opacity-60"
          >
            <span className="min-w-0 truncate text-sm">{item.label}</span>
            <span className="tabular shrink-0 text-xs text-[var(--muted)]">
              {item.count.toLocaleString()}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
