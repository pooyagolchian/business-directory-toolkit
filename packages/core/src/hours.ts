/**
 * Opening hours, as schema.org OpeningHoursSpecification.
 *
 * 13,424 of the 14,981 business pages render a visible opening-hours table —
 * 89.6% — and until this module existed none of them said so in their
 * LocalBusiness markup. That is the largest single gap between what the page
 * shows a visitor and what it tells a search engine.
 *
 * Two things make this harder than it looks.
 *
 * The first is encoding. Google renders these strings for a human, so the range
 * separator is an EN DASH (U+2013) — a plain hyphen appears zero times across
 * the 924 distinct hour strings — and the space before AM/PM is a NARROW
 * NO-BREAK SPACE (U+202F), in 922 of them. Both are invisible in a diff. A
 * regex written against a plain hyphen and a plain space matches nothing here
 * and fails silently, which is the worst way for a parser to fail. We normalise
 * both, and accept the ASCII spellings as well, because this is a toolkit and
 * another city's crawl may hand us either (ADR 0005).
 *
 * The second is that a wrong claim is worse than a missing one. Structured data
 * is a first-party assertion made in our own name, and someone acts on it by
 * travelling to a shop. So every rule below resolves ambiguity by SKIPPING the
 * day: no entry is emitted for anything the parser cannot read confidently, and
 * a day never gets a guessed, reversed or zero-length span. Silence costs a
 * rich-result enhancement; a wrong answer costs someone their evening.
 */

export interface OpeningHoursSpecification {
  "@type": "OpeningHoursSpecification";
  /**
   * The absolute schema.org URL rather than the bare "Monday". Both validate,
   * but the URL is what Google's own LocalBusiness examples use and it removes
   * any question of which vocabulary the token belongs to.
   */
  dayOfWeek: string;
  /** 24-hour "HH:MM". */
  opens: string;
  /** 24-hour "HH:MM". Earlier than `opens` means the span crosses midnight. */
  closes: string;
}

/**
 * Monday first, and iterated in this order rather than over the record's own
 * keys. Output that depends on JSON key order produces diffs that look like
 * changes when nothing changed — and iterating a fixed list means an unknown
 * key is ignored for free rather than needing a guard.
 */
export const DAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Day = (typeof DAY_ORDER)[number];

const DAY_URL: Record<Day, string> = {
  monday: "https://schema.org/Monday",
  tuesday: "https://schema.org/Tuesday",
  wednesday: "https://schema.org/Wednesday",
  thursday: "https://schema.org/Thursday",
  friday: "https://schema.org/Friday",
  saturday: "https://schema.org/Saturday",
  sunday: "https://schema.org/Sunday",
};

/**
 * A day open around the clock is 00:00–23:59, which is what Google's
 * LocalBusiness guidance asks for.
 *
 * The tempting alternative, 00:00–00:00, is a zero-length span — and this file
 * treats every other zero-length span as unresolvable and skips it, because
 * opens === closes cannot be told apart from "closed" or from a data error. All
 * day gets the one spelling that says something, and loses the last minute of
 * the day to say it.
 */
const ALL_DAY = { opens: "00:00", closes: "23:59" } as const;

/**
 * One end of a range, as written rather than as meant.
 *
 * `meridiem` is null when the string carried no AM/PM, which is not the same as
 * unparseable — Google omits the leading meridiem when both ends share one
 * ("3:30–11:55 PM"), a form used by 202 of the 924 distinct strings.
 */
interface Endpoint {
  /** 1–12 when a meridiem is present, 0–23 when it is not. */
  hour: number;
  minute: number;
  meridiem: "am" | "pm" | null;
  /** True for a zero-padded two-digit hour ("09"), which only a 24-hour clock writes. */
  padded: boolean;
}

// Tolerant of "9", "9:30", "9 AM", "9AM", "9 a.m." and "09:00". Anything else
// — a stray word, a bad minute, a second dash — falls out as null upstream.
const ENDPOINT = /^(\d{1,2})(?::([0-5]\d))?\s*(?:([ap])\.?\s*m\.?)?$/i;

/**
 * Fold the presentation characters onto their ASCII equivalents.
 *
 * The U+202F/U+2013 pair is what this corpus uses, but the other spaces and
 * dashes cost nothing to accept and each one is a class of crawl output that
 * would otherwise be dropped in silence.
 */
function normalise(value: string): string {
  return value
    .replace(/[\u00A0\u2007\u2009\u202F\u2060]/g, " ")
    .replace(/[\u2010-\u2015\u2212\uFF0D]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function readEndpoint(text: string): Endpoint | null {
  const match = ENDPOINT.exec(text.trim());
  if (!match) return null;

  const hourText = match[1] ?? "";
  const hour = Number(hourText);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]
    ? match[3].toLowerCase() === "a"
      ? "am"
      : "pm"
    : null;

  // "13 PM" and "0 AM" are not times, they are corrupt input. "24:00" is not a
  // clock reading either. Refuse both rather than folding them into something
  // plausible.
  if (meridiem ? hour < 1 || hour > 12 : hour > 23) return null;

  return { hour, minute, meridiem, padded: /^0\d$/.test(hourText) };
}

/**
 * Does this endpoint prove, on its own, that the string is a 24-hour clock?
 *
 * Only three things can: an hour past twelve, a midnight zero, and a
 * zero-padded hour — no twelve-hour renderer writes "09 AM". Everything else
 * bare ("9", "11:30") is genuinely ambiguous, and the caller refuses it.
 */
function proves24Hour(endpoint: Endpoint): boolean {
  return (
    endpoint.meridiem === null &&
    (endpoint.hour === 0 || endpoint.hour >= 13 || endpoint.padded)
  );
}

function toMinutes(endpoint: Endpoint, meridiem: "am" | "pm" | null): number {
  if (meridiem === null) return endpoint.hour * 60 + endpoint.minute;
  // The classic off-by-twelve: 12 AM is midnight and 12 PM is noon, so the hour
  // wraps to 0 before the PM offset is added — never after.
  const hour = (endpoint.hour % 12) + (meridiem === "pm" ? 12 : 0);
  return hour * 60 + endpoint.minute;
}

function format(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * One day's string to a span, or null for "make no claim about this day".
 *
 * Null covers three different situations deliberately treated the same way:
 * the day is closed, the string is unreadable, and the string is readable but
 * ambiguous. Omitting the day is how schema.org says "not open" — no entry is
 * itself the correct markup for a closed day — so the three converge honestly.
 */
function parseRange(value: string): { opens: string; closes: string } | null {
  const text = normalise(value);
  if (text === "") return null;

  // The word anywhere, not just alone on the line. The all-day test below is a
  // substring search, so "Closed for 24 hours" used to match it and publish
  // 00:00-23:59 — the failure running in the dangerous direction, claiming MORE
  // openness than the source. Anything mentioning a closure is now refused
  // outright: at worst that costs a day we could have read ("9 AM-5 PM, closed
  // for lunch"), which is the trade this file makes everywhere else.
  if (/\bclosed\b/i.test(text)) return null;

  // Checked before the split, because this form carries no separator at all.
  // "24/7" is not in this corpus; it is what a hand-maintained dataset writes.
  if (/\b24\s*(hours|hrs)\b/i.test(text) || /\b24\/7\b/.test(text)) {
    return { ...ALL_DAY };
  }

  const parts = text.split("-");
  if (parts.length !== 2) return null;

  const start = readEndpoint(parts[0] ?? "");
  const end = readEndpoint(parts[1] ?? "");
  if (!start || !end) return null;

  // Meridiem inheritance runs one way only. Google drops the FIRST AM/PM when
  // both ends share it ("8–10 PM" is twenty hundred to twenty-two hundred), and
  // no renderer drops the second — so a bare tail means a 24-hour clock, and it
  // has to prove that on its own or the day is skipped. Inheriting backwards
  // would read "9 AM–5" as five in the morning.
  //
  // Inheritance is suppressed when the start has already proved itself a
  // 24-hour reading. "09:00" cannot mean nine in the evening, so borrowing the
  // far end's PM turned "09:00-5 PM" into 21:00-17:00: a twenty-hour span
  // crossing midnight, well formed enough that nothing downstream would query
  // it. The same arithmetic moved "00:30-6 PM" to half past twelve in the
  // afternoon, because (0 % 12) + 12 is noon. Hours of 13 and above escaped
  // only by accident — (h % 12) + 12 === h across 13..23 — which is not a
  // property worth relying on.
  const startMeridiem = proves24Hour(start)
    ? null
    : (start.meridiem ?? end.meridiem);
  if (start.meridiem !== null && end.meridiem === null && !proves24Hour(end)) {
    return null;
  }

  // Neither end carries a meridiem: fine when something proves a 24-hour clock
  // ("18:30-22:00", "09:00-11:00"), refused when nothing does. "9-5" is the
  // case that matters — read as a 24-hour clock it claims a shop trades until
  // five in the morning, and it is far more likely to mean 09:00 to 17:00.
  if (
    startMeridiem === null &&
    end.meridiem === null &&
    !proves24Hour(start) &&
    !proves24Hour(end)
  ) {
    return null;
  }

  const opens = toMinutes(start, startMeridiem);
  const closes = toMinutes(end, end.meridiem);

  // A zero-length span has at least three readings — closed, open all day, and
  // a mistake — so it is the definition of a day we cannot resolve.
  if (opens === closes) return null;

  // `closes` earlier than `opens` is left exactly as it is. 837 day-entries in
  // the corpus read "8 AM–2 AM" (across 130 businesses), and schema.org reads a
  // closing time before the opening time as
  // the following day. Sorting the pair or clamping it would turn a real
  // eighteen-hour day into a two-hour one.
  return { opens: format(opens), closes: format(closes) };
}

/**
 * Build the OpeningHoursSpecification list for one business.
 *
 * Pure, and total: no input throws. The record arrives from crawled JSON, so
 * the `Record<string, string>` annotation is a promise the runtime does not
 * keep and every value is re-checked here.
 */
export function openingHoursSpecification(
  openHours: Record<string, string> | undefined,
): OpeningHoursSpecification[] {
  if (!openHours) return [];

  const byDay = new Map<string, string>();
  const conflicted = new Set<string>();
  for (const [key, value] of Object.entries(openHours)) {
    if (typeof value !== "string") continue;
    const day = key.trim().toLowerCase();

    // "Monday" and "monday" fold to the same day. When they disagree the last
    // one written used to win, so the answer depended on JSON key order — the
    // very thing DAY_ORDER exists to prevent — and in one of the two orderings
    // it published opening hours for a day the other key called Closed. Two
    // sources contradicting each other are not evidence, so the day is dropped.
    // Compared after normalising, so a crawl that spells one key with an ASCII
    // hyphen and the other with an en dash is agreement, not conflict.
    const seen = byDay.get(day);
    if (
      seen !== undefined &&
      normalise(seen).toLowerCase() !== normalise(value).toLowerCase()
    ) {
      conflicted.add(day);
    }
    byDay.set(day, value);
  }

  const specs: OpeningHoursSpecification[] = [];
  for (const day of DAY_ORDER) {
    if (conflicted.has(day)) continue;
    const raw = byDay.get(day);
    if (raw === undefined) continue;

    const range = parseRange(raw);
    if (!range) continue;

    specs.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAY_URL[day],
      ...range,
    });
  }

  return specs;
}
