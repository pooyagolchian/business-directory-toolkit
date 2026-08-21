import { NextResponse } from "next/server";
import { typeahead } from "@/lib/data";

/**
 * Search-as-you-type.
 *
 * Deliberately separate from the SSR path: per-keystroke requests must never
 * queue behind a page render. Responses are cached at the edge, because the
 * dataset only changes when a crawl runs — so the same prefix returns the same
 * answer for the whole life of a deployment.
 *
 * The origin is us-east-1 and the audience is in Dubai (~250ms). ADR 0003
 * records the plan to move this index to the client entirely; this route stays
 * as the no-JavaScript fallback.
 *
 * NOT force-static: that strips the query string from `request.url`, so the
 * handler would answer every prefix with an empty list. Caching is done with
 * headers instead, which gets the same edge behaviour without lying about the
 * route being static.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(
    { suggestions: typeahead(query, 8) },
    {
      headers: {
        "cache-control": "public, max-age=3600, s-maxage=86400",
      },
    },
  );
}
