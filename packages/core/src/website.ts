/**
 * Strip campaign tracking from a business's own website URL.
 *
 * Businesses paste a tagged link into their Google listing so they can tell
 * Maps traffic apart in their analytics. Measured in the reference corpus:
 * 847 of 10,348 websites arrive carrying tracking, e.g.
 *
 *     https://www.atlantis.com/dubai?utm_source=googleplaces&utm_medium=location
 *
 * Republishing that verbatim is wrong twice over. It puts a third party's
 * campaign attribution into our LocalBusiness `url` — structured data asserting
 * a canonical address for a business that is really a tagged variant of it —
 * and it misattributes every outbound click we send to Google Places rather
 * than to this directory.
 *
 * The hard part is not the stripping. It is knowing when to stop.
 *
 * A removed parameter that the destination actually routes on turns a listing
 * into a 404, and a broken link is a worse failure than a dirty one: the
 * visitor came here specifically to reach that business. So the two errors are
 * not symmetrical, and neither is the list below. Every name on it is either
 * inert by construction (a click identifier the origin server ignores) or
 * measured in the corpus; every judgement call resolves towards keeping.
 */

/**
 * Names that identify a click or a campaign and never a resource.
 *
 * Grouped by the system that emits them, because that is the unit in which they
 * get renamed — and honouring one spelling of a parameter while missing its
 * successor is how a strip list quietly stops working.
 *
 * Matched case-insensitively. A business owner hand-types their listing, so the
 * casing is theirs; no server distinguishes `UTM_Source` from `utm_source`.
 *
 * `utm_*` is handled separately below, as a prefix rather than a member.
 */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  // Google Ads. `gbraid` and `wbraid` are what Ads substitutes for `gclid`
  // where iOS privacy rules forbid the user-scoped identifier — same system,
  // same purpose, so omitting them would honour the letter of the list and
  // not its point.
  "gclid",
  "gbraid",
  "wbraid",
  // Google Analytics cross-domain linker. `_gl` superseded `_ga`; both only
  // ever carry client state between properties.
  "_ga",
  "_gl",
  // Meta.
  "fbclid",
  // Microsoft Advertising.
  "msclkid",
  // Mailchimp campaign and recipient.
  "mc_cid",
  "mc_eid",
  // Instagram share. Instagram renamed `igshid` to `igsh`, and the corpus is
  // already past the changeover — 54 `igsh` against 30 `igshid` — so taking
  // only the older spelling would leave most Instagram links dirty. Both are
  // safe to drop because the profile lives in the path, never the query.
  "igshid",
  "igsh",
]);

/**
 * Deliberately NOT stripped, recorded here because each one looks like a
 * candidate and the reasoning is otherwise invisible to the next reader:
 *
 *   - `ref`, `referrer`. The brief allowed these if the case could be made.
 *     It cannot: `ref` occurs ONCE across 10,348 websites, `ref_` once (Amazon,
 *     where it is part of store routing) and `referer` once. Against a ceiling
 *     of one cleaned URL stands every site that genuinely routes on `ref` —
 *     referral codes, affiliate landings, in-app deep links. The measurement
 *     argues for leaving it, so it stays.
 *   - `y_source` (204), `src` (12), `cid` (10), `sourceid`, `merchantid`,
 *     `scid`. Unambiguously tracking in the instances sampled — `y_source` is
 *     Yext's location-website tag, `cid=gplaces-copthorne-hotel-dubai` speaks
 *     for itself. But `src`, `cid` and `id` are also the three commonest names
 *     for a parameter a CMS routes on (`?cid=1250` selects a page), and this
 *     function cannot tell the two apart from the name alone. Widening here
 *     needs per-host evidence, which is a different piece of work.
 *   - `srsltid` (1), `mibextid` (10). Real tracking, single-vendor, and each
 *     would be a new family rather than a rename of one already listed. Left
 *     for a deliberate decision rather than taken silently.
 */

/**
 * Decode a parameter name for matching, and never throw doing it.
 *
 * `decodeURIComponent` raises URIError on a malformed escape — a lone `%`, or
 * `%zz` — and a business owner controls the string this ultimately comes from.
 * Decoding matters because `%75tm_source` is `utm_source`, and matching only
 * the literal spelling would leave that gap open. When the name will not decode
 * it cannot be a tracking name either, so falling back to the raw text both
 * keeps the parameter and keeps the function total.
 */
function decodeParamName(raw: string): string {
  // `+` means space in a query string; decodeURIComponent does not know that.
  const spaced = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return raw;
  }
}

function isTrackingParam(rawName: string): boolean {
  const name = decodeParamName(rawName).toLowerCase();
  // Anchored, so `utmost` and `gclid_backup` survive. A substring match here
  // would silently eat parameters this function was never told about.
  if (name === "utm" || name.startsWith("utm_")) return true;
  return TRACKING_PARAMS.has(name);
}

/**
 * Returns a cleaned URL, or undefined when the input cannot safely be one.
 *
 * Total by construction: this runs over every website in the corpus, all of it
 * attacker-influencable, and it is called from render paths where a throw would
 * take out the whole page.
 */
export function canonicalWebsite(url: string | undefined): string | undefined {
  if (!url) return undefined;

  // Whitespace around a pasted URL is a listing typo, not a different address.
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Includes the protocol-relative `//example.com/x` and the bare
    // `www.example.com`. Both could be repaired by guessing a scheme, and
    // guessing is how a directory starts publishing addresses nobody gave it.
    return undefined;
  }

  // An allowlist, not a `javascript:` denylist. The threat is concrete: this
  // value reaches an href and a JSON-LD `url`, and a `javascript:` href runs on
  // click no matter how carefully serializeJsonLd escaped the string around it
  // — escaping cannot save you when the string IS the executable. Naming the
  // two schemes a directory link can legitimately use ends the argument about
  // which of `data:`, `vbscript:`, `blob:` or `file:` were remembered.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }

  // The query is spliced textually rather than rebuilt through URLSearchParams,
  // which looks like the obvious tool and is the wrong one. Measured: a
  // searchParams round-trip rewrites 147 of the corpus's queries — `%20` to
  // `+`, `,` to `%2C`. Equivalent to most servers, not to all, and this string
  // is also shown to a human as a link. Keeping the original bytes for every
  // parameter we are not removing means the only difference between input and
  // output is the removal itself.
  const kept = parsed.search
    .slice(1)
    .split("&")
    // `?a=1&&b=2` — an empty segment carries nothing, and dropping it avoids
    // leaving a bare `?&` behind once its neighbours are stripped.
    .filter((segment) => segment !== "")
    .filter((segment) => !isTrackingParam(segment.split("=", 1)[0] ?? ""));

  // No `?` at all when nothing survives. A trailing `?` is a different string
  // to every cache, canonical-tag comparison and analytics tool that sees it,
  // for no gain.
  const query = kept.length > 0 ? `?${kept.join("&")}` : "";

  // `origin` lowercases the host — safe, because DNS is case-insensitive, and
  // useful, because it makes equal URLs compare equal. `pathname` is left
  // exactly as given: path case is significant on any case-sensitive
  // filesystem, so folding it would 404 the link. `origin` also drops any
  // `user:pass@`, which is the right loss — credentials must not be rendered
  // into a public href. (Measured: none in the corpus.)
  return `${parsed.origin}${parsed.pathname}${query}${parsed.hash}`;
}
