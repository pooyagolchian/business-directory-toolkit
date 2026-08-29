"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Bilingual } from "./bilingual";

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
  /** Formatted for display. */
  rating?: string;
  reviews?: string;
  phone?: string;
  /** Raw values, for sorting and filtering — "1,204" sorts before "89". */
  ratingValue?: number;
  reviewsValue?: number;
  /** Credibility-weighted score; see packages/core/src/rank.ts. */
  rank?: number;
}

/**
 * Sort orders.
 *
 * "Best" is the default and is NOT the raw star average. Sorting by rating
 * alone puts a lone 5-star review above 2,000 reviews averaging 4.6, which is
 * wrong in a way anyone scanning the page can see. "Top rated" is still
 * offered, because sometimes that is genuinely what you want — it is just not
 * a sensible default.
 */
const SORTS = {
  rank: {
    label: "Best",
    compare: (a: ListRow, b: ListRow) => (b.rank ?? 0) - (a.rank ?? 0),
  },
  reviews: {
    label: "Most reviewed",
    compare: (a: ListRow, b: ListRow) =>
      (b.reviewsValue ?? 0) - (a.reviewsValue ?? 0),
  },
  rating: {
    label: "Top rated",
    compare: (a: ListRow, b: ListRow) =>
      (b.ratingValue ?? 0) - (a.ratingValue ?? 0),
  },
  name: {
    label: "A–Z",
    compare: (a: ListRow, b: ListRow) => a.title.localeCompare(b.title),
  },
} as const;

type SortKey = keyof typeof SORTS;

/** Minimum-rating steps. 4.5 is roughly the corpus mean, so it is a real cut. */
const RATING_STEPS = [
  { value: 0, label: "Any rating" },
  { value: 4, label: "4.0+" },
  { value: 4.5, label: "4.5+" },
] as const;

function Controls({
  sort,
  onSort,
  minRating,
  onMinRating,
}: {
  sort: SortKey;
  onSort: (s: SortKey) => void;
  minRating: number;
  onMinRating: (r: number) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="label text-[var(--muted)]">Sort</span>
        {(Object.keys(SORTS) as SortKey[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={sort === key}
            onClick={() => onSort(key)}
            className={`text-sm underline-offset-4 transition-colors ${
              sort === key
                ? "text-[var(--fg)] underline"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {SORTS[key].label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="label text-[var(--muted)]">Rating</span>
        {RATING_STEPS.map((step) => (
          <button
            key={step.value}
            type="button"
            aria-pressed={minRating === step.value}
            onClick={() => onMinRating(step.value)}
            className={`tabular text-sm underline-offset-4 transition-colors ${
              minRating === step.value
                ? "text-[var(--fg)] underline"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {step.label}
          </button>
        ))}
      </div>
    </div>
  );
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
      <div className="flex min-w-0 flex-1 items-center gap-2.5 border border-[var(--field-border)] px-3.5 py-2.5 transition-colors hover:border-[var(--field-border-hover)] focus-within:border-[var(--field-border-active)]">
        <Search
          aria-hidden="true"
          strokeWidth={1.5}
          className="h-4.5 w-4.5 shrink-0 text-[var(--muted)]"
        />
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent text-base outline-none placeholder:text-[var(--muted)]"
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
        className="tabular label shrink-0 text-[var(--muted)]"
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
  const [sort, setSort] = useState<SortKey>("rank");
  const [minRating, setMinRating] = useState(0);

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    const matched = rows.filter((r) => {
      if (minRating > 0 && (r.ratingValue ?? 0) < minRating) return false;
      if (!needle) return true;
      return fold(
        `${r.title} ${r.meta} ${r.detail ?? ""} ${r.phone ?? ""}`,
      ).includes(needle);
    });
    // Copy before sorting: `rows` is a server-rendered prop and must not be
    // mutated in place.
    return [...matched].sort(SORTS[sort].compare);
  }, [rows, query, sort, minRating]);

  return (
    <div>
      <FilterField
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        count={filtered.length}
        noun={noun}
      />

      <Controls
        sort={sort}
        onSort={setSort}
        minRating={minRating}
        onMinRating={setMinRating}
      />

      {filtered.length === 0 ? (
        <div className="py-12">
          <p className="text-[var(--muted)]">
            {minRating > 0 && !query.trim()
              ? `Nothing on this page is rated ${minRating.toFixed(1)} or above.`
              : `Nothing on this page matches “${query}”.`}
          </p>
          {searchAllHref && (
            <Link
              href={searchAllHref}
              className="mt-3 inline-block underline underline-offset-4"
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
                className="flex gap-5 py-6 transition-opacity hover:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  {/* Sans 600, matching BusinessCard — see the note there on
                      why the display serif does not set scanned rows. */}
                  <h3 dir="auto" className="text-lg font-semibold">
                    <Bilingual text={row.title} />
                  </h3>
                  <p className="label mt-1.5 text-[var(--muted)]">{row.meta}</p>
                  {row.detail && (
                    <p
                      dir="auto"
                      className="mt-2 line-clamp-1 text-sm text-[var(--muted)]"
                    >
                      <Bilingual text={row.detail} />
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {row.rating && (
                    <p className="tabular text-base">
                      {row.rating}
                      {row.reviews && (
                        <span className="text-sm text-[var(--muted)]">
                          {" "}
                          ({row.reviews})
                        </span>
                      )}
                    </p>
                  )}
                  {row.phone && (
                    <p className="tabular mt-1.5 text-sm text-[var(--muted)]">
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
      )}
    </div>
  );
}
