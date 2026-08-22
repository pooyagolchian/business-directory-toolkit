"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BusinessRow, type CardRow } from "./business-row";
import type { SearchBatch } from "@/lib/search-batch";

/**
 * The results list on /search, extended as you scroll.
 *
 * Progressive enhancement, not a rewrite of the pager. The control at the foot
 * of the list is a real `<a href="?page=N">` that renders and works with no
 * JavaScript at all; the observer below intercepts it when JS is present. That
 * matters more here than usual, because everything else on this page — all
 * seven filter groups — is already zero-JS, and a results list that needed a
 * bundle to be readable would be the one exception.
 *
 * Rows arrive already resolved (CardRow). A Business cannot cross to the client
 * because resolving one reads the city config off disk; see business-row.tsx.
 */

/**
 * Batches to append before the reader has to ask.
 *
 * The footer carries the takedown link, and TAKEDOWN.md is a promise this
 * project actually keeps rather than decoration. A list that appends forever
 * pushes the footer away forever, so "Request removal" becomes unreachable on
 * exactly the page most likely to show someone a listing they want removed.
 * Five batches is 250 results — past what anyone scrolls in practice — and
 * after that the button is the only way down.
 */
const AUTO_BATCHES = 5;

export function SearchResults({
  initialRows,
  initialPage,
  pages,
  total,
  matches,
  hasFilters,
  matchedByPhone,
  perPage,
  hrefForPage,
}: {
  initialRows: CardRow[];
  initialPage: number;
  pages: number;
  total: number;
  matches: number;
  hasFilters: boolean;
  matchedByPhone: boolean;
  perPage: number;
  /**
   * One href per batch, index 0 being page 1, built on the server so the URL
   * scheme stays in searchHref rather than being re-derived here.
   */
  hrefForPage: string[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [page, setPage] = useState(initialPage);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [autoUsed, setAutoUsed] = useState(0);

  const sentinel = useRef<HTMLDivElement>(null);
  // Guards against a second request for a batch already in flight — the
  // observer fires again the moment appended rows change the layout.
  const inFlight = useRef(false);

  const done = page >= pages;
  const nextHref = done ? undefined : hrefForPage[page];

  const loadMore = useCallback(async () => {
    if (inFlight.current || !nextHref) return;
    inFlight.current = true;
    setStatus("loading");
    try {
      // Take the query string off the page href rather than rewriting the
      // path: the endpoint answers the SAME parameters the page does, and
      // deriving it this way makes that literally true instead of nearly.
      const search = nextHref.slice(nextHref.indexOf("?"));
      const response = await fetch(`/api/search${search}`);
      if (!response.ok) throw new Error(String(response.status));
      const batch = (await response.json()) as SearchBatch;
      setRows((current) => [...current, ...batch.rows]);
      setPage(batch.page);
      setStatus("idle");
    } catch {
      // Surfaced, never swallowed. A list that silently stops growing is
      // indistinguishable from a list that has reached its end, and the reader
      // would conclude the directory holds 250 restaurants.
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, [nextHref]);

  /**
   * Keep the URL on the batch actually being read.
   *
   * replaceState, not pushState: thirty pushed entries would make Back walk the
   * whole list one batch at a time instead of returning where the reader came
   * from. Next supports the native History API for exactly this.
   */
  useEffect(() => {
    if (page === initialPage) return;
    const href = hrefForPage[page - 1];
    if (href) window.history.replaceState(null, "", href);
  }, [page, initialPage, hrefForPage]);

  useEffect(() => {
    const target = sentinel.current;
    // Only while idle: re-running once a batch lands is what chains the next
    // one if the sentinel is still on screen, and it stops a repeat fire mid
    // flight from burning an auto batch it never used.
    if (!target || done || autoUsed >= AUTO_BATCHES || status !== "idle") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setAutoUsed((n) => n + 1);
        void loadMore();
      },
      // Start fetching a screen early, so the rows are usually already there by
      // the time the reader arrives at the bottom.
      { rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [done, autoUsed, status, loadMore]);

  const shown = rows.length;

  return (
    <>
      <p className="mt-6 label text-[var(--muted)]">
        <ResultCount
          shown={shown}
          total={total}
          matches={matches}
          hasFilters={hasFilters}
          matchedByPhone={matchedByPhone}
        />
      </p>

      <h2 className="sr-only">Results</h2>
      <ul className="mt-2">
        {rows.map((row) => (
          <BusinessRow key={row.key} row={row} />
        ))}
      </ul>

      {/*
        aria-live so a screen reader is told the list grew. Without it the rows
        appear silently and the only clue is that the control moved.
      */}
      <p aria-live="polite" className="sr-only">
        {status === "loading"
          ? "Loading more results"
          : `Showing ${shown} of ${total} results`}
      </p>

      {!done && (
        <div
          ref={sentinel}
          className="mt-10 flex flex-col items-center gap-3 border-t border-[var(--rule)] pt-8"
        >
          {status === "error" ? (
            <>
              <p className="text-sm text-[var(--muted)]">
                Couldn&rsquo;t load more results.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  void loadMore();
                }}
                className="label border border-[var(--field-border)] px-5 py-2.5 transition-colors hover:border-[var(--field-border-active)]"
              >
                Try again
              </button>
            </>
          ) : status === "loading" ? (
            <p className="label text-[var(--muted)]">Loading…</p>
          ) : (
            <>
              <p className="tabular label text-[var(--muted)]">
                Showing {shown.toLocaleString()} of {total.toLocaleString()}
              </p>
              {/*
                A link, not a button. With JS this is intercepted; without it,
                it is the pager — it navigates to ?page=N, which the server
                renders cumulatively, so the reader keeps every row they already
                had rather than jumping to a disconnected batch.
              */}
              <Link
                href={nextHref ?? "#"}
                prefetch={false}
                onClick={(event) => {
                  event.preventDefault();
                  void loadMore();
                }}
                className="label border border-[var(--field-border)] px-5 py-2.5 transition-colors hover:border-[var(--field-border-active)]"
              >
                Load {Math.min(perPage, total - shown).toLocaleString()} more
              </Link>
            </>
          )}
        </div>
      )}

      {done && pages > 1 && (
        <p className="tabular label mt-10 border-t border-[var(--rule)] pt-8 text-center text-[var(--muted)]">
          All {total.toLocaleString()} results shown
        </p>
      )}
    </>
  );
}

/**
 * The count line.
 *
 * It states the filtered total against the unfiltered one whenever they differ,
 * because "312 matches" alone reads as the whole answer when it is a tenth of
 * it. "Showing N" counts what is actually on screen, so it stays true as rows
 * append — the previous version said "showing first 50" and there was no way to
 * reach the rest.
 */
function ResultCount({
  shown,
  total,
  matches,
  hasFilters,
  matchedByPhone,
}: {
  shown: number;
  total: number;
  matches: number;
  hasFilters: boolean;
  matchedByPhone: boolean;
}) {
  if (matches === 0) return <>No matches</>;

  const noun = matches === 1 ? "match" : "matches";
  const counted = hasFilters
    ? `${total.toLocaleString()} of ${matches.toLocaleString()} ${noun}`
    : `${matches.toLocaleString()} ${noun}`;

  return (
    <>
      {counted}
      {matchedByPhone && " · matched by phone number"}
      {shown < total && ` · showing ${shown.toLocaleString()}`}
    </>
  );
}
