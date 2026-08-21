"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

/**
 * Display-ready row.
 *
 * Everything is resolved on the server before it reaches here, because the
 * helpers that build these strings read the city config off disk. Passing a
 * Business straight into a client component would drag `node:fs` into the
 * browser bundle.
 */
export interface ListRow {
  key: string;
  href: string;
  title: string;
  meta: string;
  detail?: string;
  rating?: string;
  reviews?: string;
  phone?: string;
}

/** Strip diacritics so "Tresind" finds "Trèsind". */
function fold(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function FilterField({
  value,
  onChange,
  placeholder,
  count,
  noun,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  count: number;
  noun: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 border border-[var(--field-border)] px-3 py-2 transition-colors hover:border-[var(--field-border-hover)] focus-within:border-[var(--field-border-active)]">
        <Search
          aria-hidden="true"
          strokeWidth={1.5}
          className="h-4 w-4 shrink-0 text-[var(--muted)]"
        />
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear filter"
            className="shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            <X aria-hidden="true" strokeWidth={1.5} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p
        aria-live="polite"
        className="tabular shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"
      >
        {count.toLocaleString()} {noun}
      </p>
    </div>
  );
}

/**
 * A business list you can narrow in place.
 *
 * This filters what is already on the page — it does not search the whole
 * directory. The placeholder says "Filter" rather than "Search" for that
 * reason: a control that silently searches a subset is worse than no control,
 * and the empty state offers the real search as the way out.
 */
export function FilterableBusinessList({
  rows,
  noun = "results",
  placeholder = "Filter these results",
  searchAllHref,
}: {
  rows: ListRow[];
  noun?: string;
  placeholder?: string;
  searchAllHref?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return rows;
    return rows.filter((r) =>
      fold(`${r.title} ${r.meta} ${r.detail ?? ""} ${r.phone ?? ""}`).includes(
        needle,
      ),
    );
  }, [rows, query]);

  return (
    <div>
      <FilterField
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        count={filtered.length}
        noun={noun}
      />

      {filtered.length === 0 ? (
        <div className="py-12">
          <p className="text-[var(--muted)]">
            Nothing on this page matches &ldquo;{query}&rdquo;.
          </p>
          {searchAllHref && (
            <Link
              href={searchAllHref}
              className="mt-2 inline-block text-sm underline underline-offset-4"
            >
              Search the whole directory instead
            </Link>
          )}
        </div>
      ) : (
        <ul className="mt-4">
          {filtered.map((row) => (
            <li
              key={row.key}
              className="border-t border-[var(--rule)] last:border-b"
            >
              <Link
                href={row.href}
                className="flex gap-4 py-5 transition-opacity hover:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <h3
                    dir="auto"
                    className="font-[family-name:var(--font-display)] text-lg leading-snug"
                  >
                    {row.title}
                  </h3>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                    {row.meta}
                  </p>
                  {row.detail && (
                    <p
                      dir="auto"
                      className="mt-1.5 line-clamp-1 text-sm text-[var(--muted)]"
                    >
                      {row.detail}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {row.rating && (
                    <p className="tabular text-sm">
                      {row.rating}
                      {row.reviews && (
                        <span className="text-[var(--muted)]">
                          {" "}
                          ({row.reviews})
                        </span>
                      )}
                    </p>
                  )}
                  {row.phone && (
                    <p className="tabular mt-1 text-xs text-[var(--muted)]">
                      {row.phone}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface FacetRow {
  slug: string;
  label: string;
  count: number;
}

/** The same idea for the category and neighbourhood grids. */
export function FilterableFacetGrid({
  items,
  hrefPrefix,
  noun,
  placeholder,
}: {
  items: FacetRow[];
  hrefPrefix: string;
  noun: string;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return items;
    return items.filter((i) => fold(i.label).includes(needle));
  }, [items, query]);

  return (
    <div>
      <FilterField
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        count={filtered.length}
        noun={noun}
      />

      {filtered.length === 0 ? (
        <p className="py-12 text-[var(--muted)]">
          No {noun} match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-px bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <li key={item.slug} className="bg-[var(--bg)]">
              <Link
                href={`${hrefPrefix}/${item.slug}`}
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
      )}
    </div>
  );
}
