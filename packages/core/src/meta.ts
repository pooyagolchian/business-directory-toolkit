/**
 * The meta description for a single business listing.
 *
 * This is the largest page tier on the site — 14,981 URLs — and it was reading
 * as unedited machine output. The old frame was:
 *
 *     `${title} is a ${what.toLowerCase()} in ${where}, Dubai.`
 *
 * Taxonomy labels are plural ("Hotels", "Restaurants", "Opticians"), so the
 * indefinite article never agreed: 9,175 pages shipped "Atlantis - The Palm is
 * a hotels in Palm Jumeirah", and another 1,687 wanted "an" rather than "a".
 *
 * Those counts move when the taxonomy is re-classified — they were 9,102 and
 * 1,688 against an earlier classification of the same 14,981 records. They are
 * quoted to show the SCALE of the agreement problem, which is a property of
 * pluralised category labels rather than of any particular crawl, so re-derive
 * rather than trust them if you need an exact figure.
 *
 * The fix is not to special-case plurals and vowels. It is to drop the article
 * entirely — an appositive needs none, so both bugs stop existing rather than
 * being handled. That also lets the label keep the casing the taxonomy gave it.
 *
 * Meta descriptions are not a ranking input and Google rewrites them freely.
 * This is about not looking generated on the tier a reader is most likely to
 * land on.
 */

export interface BusinessDescriptionInput {
  title: string;
  /** The taxonomy label, l3 preferred over l2. Absent when unclassified. */
  what?: string | undefined;
  /** Resolved neighbourhood name, not the slug. */
  area: string;
  city: string;
  /** As the engine returned it — "04 577 6680" — because that is how it is dialled. */
  phoneRaw?: string | undefined;
  address?: string | undefined;
}

/**
 * Google truncates displayed descriptions somewhere around 155–160 characters
 * on desktop, and the exact point moves with pixel width rather than character
 * count. 155 is the conventional safe budget; 31% of the old descriptions blew
 * past 160 and the longest reached 378.
 */
export const DESCRIPTION_MAX = 155;

/**
 * Below this there is no point keeping any of the address — a six-character
 * fragment followed by an ellipsis is noise that costs a reader attention and
 * tells them nothing.
 */
const MIN_USEFUL_ADDRESS = 24;

/** Addresses arrive from Google with newlines and runs of spaces in them. */
function flatten(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Cut at a word boundary inside `budget` characters, including the ellipsis.
 * Returns null when nothing worth showing survives.
 */
function clip(value: string, budget: number): string | null {
  if (value.length <= budget) return value;
  // Reserve one character for the ellipsis itself.
  const cut = value.slice(0, budget - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const words = lastSpace === -1 ? cut : cut.slice(0, lastSpace);
  const trimmed = words.replace(/[\s,;.]+$/, "");
  if (trimmed.length < MIN_USEFUL_ADDRESS) return null;
  return `${trimmed}…`;
}

export function businessDescription(
  input: BusinessDescriptionInput,
  maxLength: number = DESCRIPTION_MAX,
): string {
  const { title, what, area, city, phoneRaw, address } = input;

  // The category clause is omitted rather than filled with a placeholder. An
  // unclassified listing saying "Business" tells the reader nothing the page
  // does not already say, and it reads as a gap in the data — which it is.
  const head = what
    ? `${title} — ${what} in ${area}, ${city}.`
    : `${title} — ${area}, ${city}.`;

  // The phone is the most useful fact a directory snippet can carry, and half a
  // phone number is worse than none — so it is never subject to the cap. A
  // title long enough to blow the budget on its own also survives intact:
  // Google rewrites over-long descriptions, but a business name cut mid-word is
  // what a reader actually notices.
  const parts = [head];
  if (phoneRaw) parts.push(`Phone ${phoneRaw}.`);

  const fixed = parts.join(" ");
  if (!address) return fixed;

  const remaining = maxLength - fixed.length - 1; // -1 for the joining space
  if (remaining < MIN_USEFUL_ADDRESS) return fixed;

  const tail = clip(flatten(address), remaining);
  return tail ? `${fixed} ${tail}` : fixed;
}
