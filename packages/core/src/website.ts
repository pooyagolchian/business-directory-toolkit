/**
 * Strip campaign tracking from a business's own website URL.
 *
 * Businesses paste a tagged link into their Google listing so they can tell
 * Maps traffic apart in their analytics. Measured in the reference corpus:
 * 909 of 10,348 websites carry at least one parameter this function removes —
 * 841 of them a `utm_*` — e.g.
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
 * ICU's UTS-46 ToUnicode. It is the only thing available here that can tell a
 * punycode label which decodes from one that merely looks like it should — see
 * the long note on `hasUndecodableAceLabel`, where the alternatives are
 * measured and rejected.
 */
import { domainToUnicode } from "node:url";

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
 *   - `y_source` (204), `scid` (38), `sourceid` (33), `merchantid` (32),
 *     `cid` (20), `src` (12). Unambiguously tracking in the instances sampled —
 *     `y_source` is Yext's location-website tag, and
 *     `cid=gplaces-copthorne-hotel-dubai` speaks
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
 * The prefix that marks a label as punycode — "ACE", ASCII Compatible Encoding.
 * Lowercase, because every label is lowercased before it is tested.
 */
const ACE_PREFIX = "xn--";

/**
 * True when any label of the host claims to be punycode and does not decode.
 *
 * WHY THIS EXISTS — THE PARSER USED TO DO IT
 *
 * Until Node 24.20.0 this function had no reason to exist. `new URL()` rejected
 * a host whose punycode fails IDNA, so `https://xn--a.com/x` threw and the
 * catch below returned undefined for free. Node 24.20.0 stopped validating
 * those labels. Measured on both runtimes: `new URL("https://xn--a.com/x")`
 * throws ERR_INVALID_URL on 24.13.0 and parses to hostname "xn--a.com" on
 * 24.20.0, and the same split shows on `xn--.com`, `xn--a-ecp.ru` and
 * `xn--.-9na.com`.
 *
 * The difference is not cosmetic. `xn--a` has no address and never will — no
 * resolver answers for it — and this string is written into an href and into a
 * LocalBusiness `url`. Publishing an unresolvable host as a business's
 * canonical address is one of the two failures this module exists to prevent,
 * and the parser quietly stopped preventing it under us. So the check moves
 * into code, where a test pins it rather than a Node release.
 *
 * WHY PER LABEL AND NOT PER HOST
 *
 * The obvious shape of this check is `domainToUnicode(hostname) === hostname`,
 * and it fails on the host shape that matters most. `xn--bcher-kva.xn--a.com`
 * mixes one VALID punycode label with one dead one; measured on 24.20.0,
 * domainToUnicode returns "bücher.xn--a.com". The valid label decoded, the
 * string changed, and a whole-host comparison reads that as success while the
 * dead label sails into the href. Asking each label separately is what closes
 * it, and it is the case the tests spell out.
 *
 * HOW A FAILED DECODE ANNOUNCES ITSELF
 *
 * Two different ways, which is why both are matched. On 24.13.0 ICU signals
 * failure with the empty string — domainToUnicode("xn--a") === "". On 24.20.0
 * it hands the label back untouched — domainToUnicode("xn--a") === "xn--a". A
 * real internationalised label does neither on either runtime: "xn--bcher-kva"
 * decodes to "bücher" and "xn--zckzah" to "テスト". So "empty, or still an ACE
 * label" is the signal.
 *
 * WHAT THIS DOES NOT CATCH, MEASURED
 *
 * The signal is the two ways ICU refuses to MAP a label. It is not the whole of
 * UTS-46, because 24.20.0 applies the mapping table without the validity
 * criteria on top. Swept exhaustively over every `xn--` payload of length 1-3
 * plus 150k random ones, 374 of 202,059 labels are rejected by 24.13.0's parser
 * and still published here on 24.20.0. 345 of them decode to letters assigned
 * in a Unicode later than 24.13.0's ICU knew, where the newer runtime is
 * arguably right. The remaining 29 are not defensible: 27 decode to a leading
 * combining mark and 2 to a symbol, both of which UTS-46 validity forbids.
 *
 * They are left alone deliberately. Closing them means this module growing its
 * own opinion about which codepoints may start a label, and the obvious spelling
 * of that opinion is wrong: a blanket "reject a decoded symbol" also rejects
 * xn--ls8h, xn--i-7iq and xn--qei — 💩.la, i❤.ws and ❤.ws, which are registered
 * and resolve. Over-rejecting deletes a real business's website from its
 * listing, which this file's opening note calls the worse of the two errors, so
 * the judgement stays with ICU and the residue stays documented.
 *
 * REJECTED: `node:punycode`, AND A USERLAND PUNYCODE PACKAGE
 *
 * Both are worse, and not because of the DEP0040 deprecation warning that
 * `node:punycode` prints. They implement RFC 3492 — the encoding — and nothing
 * above it. Measured, identically on 24.13.0 and 24.20.0:
 * `punycode.toUnicode("xn--a-ecp")` returns "a⒈". The decode SUCCEEDS, because
 * U+2488 DIGIT ONE FULL STOP is a perfectly encodable codepoint. IDNA is what
 * forbids it, and for a good reason: "a⒈" renders as "a1." and is a
 * ready-made host spoof. A hand-rolled decoder, or the npm package, would wave
 * `xn--a-ecp.ru` straight through into a rendered link. Only the ICU path
 * applies the UTS-46 validity rules on top of the decode, so `node:url` here is
 * not a convenience, it is the requirement.
 *
 * REJECTED: `domainToASCII(hostname) === ""` as the signal. It is the same
 * measurement in mirror image and it died the same death — on 24.20.0
 * domainToASCII("xn--a.com") returns "xn--a.com" rather than "", so it carries
 * no signal at all on the runtime that needs one.
 *
 * The cost, named rather than buried: this is the first `node:` import in
 * @directory/core's shipped source, so a client component importing the package
 * barrel would now pull a Node built-in into a browser bundle. Nothing does
 * today — canonicalWebsite has a single caller, a server component — and the
 * day something tries, it is a build error and not a silent one.
 */
function hasUndecodableAceLabel(hostname: string): boolean {
  for (const rawLabel of hostname.split(".")) {
    // `new URL` already lowercases the host of an http(s) URL, so the fold
    // below only matters to a direct caller. It costs nothing, and `XN--A` is
    // precisely the spelling someone reaches for when a check looks case-bound.
    const label = rawLabel.toLowerCase();
    // A non-ACE label is ordinary ASCII DNS and none of this function's
    // business. That also covers the empty label a trailing dot leaves behind,
    // and an IPv4 or bracketed IPv6 literal, none of which carry punycode.
    if (!label.startsWith(ACE_PREFIX)) continue;
    const decoded = domainToUnicode(label);
    if (decoded === "" || decoded.startsWith(ACE_PREFIX)) return true;
  }
  return false;
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

  // A host that claims punycode and does not decode resolves nowhere, and as of
  // Node 24.20.0 the parser above no longer rejects it. See the note on
  // hasUndecodableAceLabel for why this is now our job and why it is per label.
  if (hasUndecodableAceLabel(parsed.hostname)) return undefined;

  // The query is spliced out of `parsed.search` rather than rebuilt through
  // URLSearchParams, which looks like the obvious tool and is the wrong one.
  // Measured: a searchParams round-trip rewrites 147 of the corpus's queries —
  // `%20` to `+`, `,` to `%2C`. Equivalent to most servers, not to all, and
  // this string is also shown to a human as a link.
  //
  // Splicing avoids that second encoding pass. It does NOT make the output a
  // byte-for-byte copy of the caller's query, and it is worth being exact about
  // which of the two this is: `parsed.search` has already been through the
  // WHATWG parser, which percent-encodes space, `"`, `<` and `>` on the way in.
  // So `?q=a b` arrives here as `?q=a%20b` and leaves that way. The guarantee
  // is that nothing is re-encoded a SECOND time — not that kept parameters are
  // untouched. (Across the corpus the two happen to coincide: every stored URL
  // is already parser-normalised, so all 10,348 round-trip byte-identically.)
  //
  // Reading it as the stronger promise is what leads to a raw-text splice over
  // the caller's string, which gives that byte-for-byte property and gives up
  // every malformed-input crash the parser currently absorbs.
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

  // `origin` lowercases the host and punycodes an internationalised one — both
  // safe, because that is what DNS resolves either way, and useful, because it
  // makes equal URLs compare equal.
  //
  // `pathname` keeps its CASE, which is the part that matters: path case is
  // significant on any case-sensitive filesystem, so folding it would 404 the
  // link. It is not otherwise untouched — the parser percent-encodes non-ASCII
  // and the reserved ASCII set, so `/straße` reaches here as `/stra%C3%9Fe`.
  //
  // `origin` also drops any `user:pass@`. That is deliberate and load bearing
  // twice over: credentials must never be rendered into a public href, and
  // `https://<trusted>@evil/` is a spoof that reads as the trusted host to a
  // human skimming the link. Dropping userinfo makes the visible link and the
  // JSON-LD `url` both say where the click actually goes. (Measured: no corpus
  // URL carries credentials — this is a guard for other cities' crawls.)
  //
  // The fragment is passed through even when it looks like tracking. A `#`
  // query is a hash router's own business — `#/home?tab=2` addresses a view
  // inside a single-page app — and it is never sent to the server, so there is
  // no attribution in it to strip. (Measured: 0 corpus URLs carry tracking
  // there.)
  return `${parsed.origin}${parsed.pathname}${query}${parsed.hash}`;
}
