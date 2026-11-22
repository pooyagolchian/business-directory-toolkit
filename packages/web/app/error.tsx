"use client";

import Link from "next/link";

/**
 * The route-level error boundary: a page threw while rendering.
 *
 * No Page chrome, unlike the 404s. Error boundaries must be Client Components,
 * and chrome.tsx's Footer reads the crawl date off disk through lib/data.ts —
 * importing it here would pull `node:fs` into a browser bundle. The root layout
 * still wraps this, so fonts and globals.css are present; the column matches
 * Page's <main> so the heading lands where every other page's does.
 *
 * error.message is never shown. In production Next replaces a Server
 * Component's message with a generic one anyway, but a Client Component's
 * message arrives verbatim, and either way it is written for whoever reads the
 * logs, not for a visitor. The digest IS shown: it is an opaque hash, it
 * carries nothing sensitive, and it is the one string that lets a bug report
 * be matched to a server-side log line.
 *
 * `retry` rather than `reset`: retry re-fetches the segment from the server,
 * which is what clears a transient failure; reset only re-renders what the
 * client already has, which would throw the same error again.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl">
        This page didn’t load
      </h1>
      <p className="mt-4 max-w-xl text-[var(--muted)]">
        Something went wrong on our side while building it. Trying again usually
        fixes it.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
        {/* The page's one filled control. Every other action on the site is a
            text link, so a solid block is unambiguous as the thing to press. */}
        <button
          type="button"
          onClick={() => retry()}
          className="bg-[var(--fg)] px-5 py-2.5 text-[var(--bg)] transition-opacity hover:opacity-80"
        >
          Try again
        </button>
        <Link
          href="/"
          className="underline underline-offset-4 hover:text-[var(--muted)]"
        >
          Go to the home page
        </Link>
      </div>

      {error.digest && (
        <p className="mt-12 text-sm text-[var(--muted)]">
          Reference{" "}
          <code className="font-[family-name:var(--font-mono)] text-[var(--fg)]">
            {error.digest}
          </code>
          . Quote it if you report this, so it can be matched to the server log.
        </p>
      )}
    </main>
  );
}
