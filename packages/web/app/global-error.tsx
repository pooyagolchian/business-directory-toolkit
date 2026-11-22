"use client";

/**
 * The last fallback: the root layout itself failed to render.
 *
 * This REPLACES app/layout.tsx, so none of it is available — no next/font
 * variables, no publisher markup, and no guarantee globals.css arrived either,
 * since a failure this early may be the reason it did not. Everything the page
 * needs is therefore inline: system faces, black on white, and spacing set in
 * rem so it still follows the reader's text size. It is meant to be readable
 * with no stylesheet at all, not to look like the rest of the site.
 *
 * The same rules as app/error.tsx apply: never error.message, always the
 * digest, and `retry` so the root segment is fetched again rather than merely
 * re-rendered.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#fff",
          color: "#000",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          fontSize: "1.0625rem",
          lineHeight: 1.55,
        }}
      >
        <title>Something went wrong</title>
        <main
          style={{
            maxWidth: "64rem",
            margin: "0 auto",
            padding: "3.5rem 1.5rem",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: "2.0625rem",
              fontWeight: 400,
              lineHeight: 1.18,
            }}
          >
            The directory didn’t load
          </h1>
          <p
            style={{ margin: "1rem 0 0", maxWidth: "36rem", color: "#4d4d4d" }}
          >
            Something went wrong on our side. Trying again usually fixes it.
          </p>
          <p style={{ margin: "2.5rem 0 0" }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                font: "inherit",
                padding: "0.625rem 1.25rem",
                border: 0,
                background: "#000",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </p>
          {error.digest && (
            <p
              style={{
                margin: "3rem 0 0",
                fontSize: "0.875rem",
                color: "#4d4d4d",
              }}
            >
              Reference{" "}
              <code
                style={{
                  fontFamily: "ui-monospace, Menlo, monospace",
                  color: "#000",
                }}
              >
                {error.digest}
              </code>
              . Quote it if you report this, so it can be matched to the server
              log.
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
