/**
 * ItemList markup for a page of ranked business rows.
 *
 * The contract is one sentence, and getting it wrong is the whole risk: THIS
 * FUNCTION MARKS UP THE ROWS IT IS HANDED, so hand it exactly the array the
 * page renders — after any `.slice()`, in the order the visitor sees.
 *
 * That is not pedantry about the argument. `/category/[l2]` knows two different
 * numbers about itself: `facet.count`, which can be 1,164, and PAGE_SIZE, which
 * is 120. Only the second is true of the document a crawler fetches. Claiming
 * 1,164 items on a page listing 120 of them is the same class of violation as
 * marking up Google's ratings as first-party review data — which this codebase
 * already refuses to do — and it is easier to commit by accident, because the
 * bigger number is sitting right there in the same scope.
 *
 * So the safe call is always `rows` — the value passed to the list component —
 * never the facet the rows were drawn from:
 *
 *     const rows = byRank(businesses).slice(0, PAGE_SIZE).map(toRow);
 *     const list = itemListJsonLd(rows, BASE, {
 *       name: `${facet.label} in ${cityName()}`,
 *     });
 *
 * The city comes from `cityName()`, never a literal, because a city is data and
 * not code (ADR 0005) — this file has to be as true of Lisbon as of Dubai.
 *
 * On `/area/[area]/[l2]` — the money pages — there is no slice, so the list is
 * every matching business and the two numbers finally agree. That page is the
 * exception, not the pattern to generalise from.
 */

export interface ListEntry {
  /** Rendered exactly as given. Titles are often bilingual; nothing here mangles them. */
  name: string;
  /** The row's own href, root-relative — `/business/atlantis-the-palm-7f2a`. */
  url: string;
}

export interface ItemListOptions {
  /** Names the list for a crawler, e.g. "Restaurants in Al Barsha". */
  name?: string;
}

interface ListItem {
  "@type": "ListItem";
  position: number;
  /**
   * Both optional, and both for the same reason. An entry the page cannot
   * describe keeps its position and says nothing more, rather than assert a
   * name of "" or a URL that was never a URL. See resolveUrl below.
   */
  name?: string;
  url?: string;
}

export interface ItemList {
  "@context": "https://schema.org";
  "@type": "ItemList";
  name?: string;
  itemListElement: ListItem[];
}

/**
 * Resolve a row's href against the site base — or decline to.
 *
 * `${base}${href}` will happily concatenate anything, and three of the four
 * ways it goes wrong produce output no validator will flag, because the result
 * is still a string:
 *
 *   - `""` resolves to the site root, so the first restaurant in Al Barsha is
 *     claimed to be the homepage. This is the dangerous one: the output is a
 *     perfectly valid URL, just not this item's.
 *   - `https://example.com/x` becomes `https://<base>https://example.com/x`,
 *     which is not a URL at all.
 *   - `business/x` fuses into the host: `https://<base>business/x`.
 *   - `//example.com/x` is protocol-relative, so the <a href> beside it sends
 *     the visitor off-site while `${base}//example.com/x` claims a path on our
 *     own host. Markup and rendered link disagreeing is precisely the failure
 *     this module exists to prevent.
 *
 * One test covers all four: the href must begin with a single `/`. Anything
 * else has no destination that can be derived without inventing one, so the
 * entry carries no `url` — the bargain breadcrumbJsonLd already strikes with a
 * crumb that has nowhere to point. A missing claim is recoverable; a confident
 * wrong one is what gets a site's rich results turned off.
 */
function resolveUrl(href: string, base: string): string | undefined {
  // Trimmed because whitespace around an href is a call-site typo, not a
  // different page — and `${base}/business/x  ` would be asserted as one.
  const path = href.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  return `${base}${path}`;
}

export function itemListJsonLd(
  items: ListEntry[],
  baseUrl: string,
  options: ItemListOptions = {},
): ItemList | null {
  // An empty list describes nothing and still costs a validation surface, so
  // the caller gets null and skips the <script> — the same bargain
  // breadcrumbJsonLd offers a trail too short to be a hierarchy.
  if (items.length === 0) return null;

  // The base reaches here in whatever shape the call site holds it, because it
  // is duplicated across sitemap.ts, robots.ts and layout.tsx. Normalising once
  // is cheaper than trusting every one of them to agree about the slash.
  const base = baseUrl.replace(/\/+$/, "");

  const itemListElement = items.map((item, index): ListItem => {
    const entry: ListItem = {
      "@type": "ListItem",
      // schema.org counts from 1. An off-by-one here tells a crawler the first
      // result is the zeroth, which is not a position it recognises.
      position: index + 1,
    };

    // Tested for blankness, then assigned VERBATIM. Titles arrive from Google
    // Maps and are routinely bilingual; trimming them would be the thin end of
    // mangling data this module is only supposed to pass through. But `name: ""`
    // is not a name — it is an assertion that the item is called nothing.
    if (item.name.trim()) entry.name = item.name;

    const url = resolveUrl(item.url, base);
    if (url) entry.url = url;

    // A degraded entry is never dropped. Dropping one renumbers everything
    // below it, and the markup would stop describing the rows on the page —
    // the one thing it is for. The bare position slot says, truthfully, that
    // there is an nth item and nothing more can be said about it.
    return entry;
  });

  const list: ItemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement,
  };

  // Deliberately no `numberOfItems`. It would only ever be
  // itemListElement.length, so it carries nothing the array does not already
  // say — and a separate count field is the one place a page holding both 1,164
  // and 120 could put the wrong one. The field that cannot be filled in wrongly
  // is the field that is not there.

  // Set the key only when a real name was given. `name: undefined` survives
  // into the object and reads as an intentionally empty name; so, for that
  // matter, does the "  " a template like `${label} in ${city}` produces when
  // both interpolations come back empty.
  const name = options.name?.trim();
  if (name) list.name = name;

  return list;
}
