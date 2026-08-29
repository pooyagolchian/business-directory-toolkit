import { describe, expect, test } from "vitest";
import { openingHoursSpecification } from "./hours";

/**
 * Google Maps renders opening hours for a human reader, and the two characters
 * doing that rendering are both invisible in a diff:
 *
 *     what looks like "8 AM-11 PM" is really
 *     8 U+202F A M U+2013 1 1 U+202F P M
 *
 * The separator is an EN DASH (U+2013) — a plain hyphen occurs zero times in
 * the 924 distinct hour strings this corpus holds — and the space before AM/PM
 * is a NARROW NO-BREAK SPACE (U+202F), present in 922 of those 924. A regex
 * written as /(\d+) (AM|PM)-(\d+) (AM|PM)/ therefore matches nothing at all
 * here, so the strings below are pasted in the encoding the crawler really
 * produces rather than retyped by hand from what they look like.
 */
const NNBSP = " "; // U+202F, NARROW NO-BREAK SPACE
const EN_DASH = "–"; // U+2013

/** A whole week is noise when the test is about one day's string. */
function monday(value: string) {
  return openingHoursSpecification({ monday: value });
}

describe("the encoding, held exactly", () => {
  test("the literals in this file really do carry U+202F and U+2013", () => {
    // A canary rather than a tautology. Both characters survive a copy-paste
    // but not every editor, formatter or tidy-the-whitespace pass — and were
    // one silently rewritten to a plain space or a hyphen, every test below
    // would keep passing against input the crawler never emits. So assert the
    // bytes, not the appearance.
    expect("8 AM–11 PM").toContain(NNBSP);
    expect("8 AM–11 PM").toContain(EN_DASH);
    expect("8 AM–11 PM").not.toContain(" ");
    expect("8 AM–11 PM").not.toContain("-");
  });

  test("parses the real corpus encoding", () => {
    expect(monday("8 AM–11 PM")).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Monday",
        opens: "08:00",
        closes: "23:00",
      },
    ]);
  });

  test("keeps minutes", () => {
    expect(monday("9:30 AM–10:30 PM")[0]).toMatchObject({
      opens: "09:30",
      closes: "22:30",
    });
  });

  test("accepts the ASCII spelling too, for a differently normalised crawl", () => {
    // ADR 0005: this is a toolkit, and another city's crawl may hand us a plain
    // hyphen and a plain space. Being liberal here costs one regex.
    expect(monday("8 AM-11 PM")[0]).toMatchObject({
      opens: "08:00",
      closes: "23:00",
    });
    expect(monday("8 am - 11 pm")[0]).toMatchObject({
      opens: "08:00",
      closes: "23:00",
    });
  });
});

describe("the twelve-hour clock, where the off-by-twelve bugs live", () => {
  test("12 AM is midnight, not noon", () => {
    expect(monday("12 AM–11:30 AM")[0]).toMatchObject({
      opens: "00:00",
      closes: "11:30",
    });
  });

  test("12 PM is noon, not midnight", () => {
    expect(monday("12 PM–2 AM")[0]).toMatchObject({
      opens: "12:00",
      closes: "02:00",
    });
  });

  test("a range that runs past midnight is a crossing span, not a reversed one", () => {
    // 837 day-entries read "8 AM–2 AM", across 130 businesses. Sorting the pair,
    // or clamping closes up
    // to opens, would claim a shop shuts eighteen hours before it does.
    // schema.org reads closes < opens as "the next day", which is the truth.
    expect(monday("8 AM–3 AM")[0]).toMatchObject({
      opens: "08:00",
      closes: "03:00",
    });
    expect(monday("9 PM–3 AM")[0]).toMatchObject({
      opens: "21:00",
      closes: "03:00",
    });
  });

  test("infers the omitted leading meridiem from the trailing one", () => {
    // 202 of the 924 distinct strings are written this way: Google drops the
    // first AM/PM when both ends share it. Refusing these would silently lose
    // a fifth of the corpus's vocabulary.
    expect(monday("3:30–11:55 PM")[0]).toMatchObject({
      opens: "15:30",
      closes: "23:55",
    });
    expect(monday("8–10 PM")[0]).toMatchObject({
      opens: "20:00",
      closes: "22:00",
    });
    expect(monday("12–6 AM")[0]).toMatchObject({
      opens: "00:00",
      closes: "06:00",
    });
  });

  test("rejects an hour the twelve-hour clock cannot hold", () => {
    expect(monday("13 PM–11 PM")).toEqual([]);
    expect(monday("0 AM–11 PM")).toEqual([]);
  });
});

describe("all day and no day", () => {
  test("open around the clock spans 00:00 to 23:59", () => {
    // 13,160 days in this corpus say "Open 24 hours" — the single most common
    // value, so getting it wrong would be the loudest possible error.
    expect(monday("Open 24 hours")).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Monday",
        opens: "00:00",
        closes: "23:59",
      },
    ]);
  });

  test("Closed emits no entry for that day, and leaves the others alone", () => {
    const week = openingHoursSpecification({
      monday: "Closed",
      tuesday: "9 AM–5 PM",
    });
    expect(week).toHaveLength(1);
    expect(week[0]?.dayOfWeek).toBe("https://schema.org/Tuesday");
  });

  test("never emits a zero-length span", () => {
    // "9 AM–9 AM" could mean closed, could mean 24 hours, could be a data bug.
    // Three readings, no way to choose — so make no claim.
    expect(monday("9 AM–9 AM")).toEqual([]);
  });
});

describe("refusing to guess", () => {
  test("an unparseable string emits nothing and does not throw", () => {
    for (const junk of [
      "Hours might differ",
      "",
      "   ",
      "Open",
      "9 AM",
      "9:75 AM–10 PM",
      "25:00-26:00",
      "abc–def",
    ]) {
      expect(() => monday(junk)).not.toThrow();
      expect(monday(junk)).toEqual([]);
    }
  });

  test("survives values that are not strings at all", () => {
    // The record arrives from JSON, so the type annotation is a promise the
    // runtime does not keep.
    const junk = {
      monday: null,
      tuesday: 9,
      wednesday: ["9 AM"],
    } as unknown as Record<string, string>;
    expect(() => openingHoursSpecification(junk)).not.toThrow();
    expect(openingHoursSpecification(junk)).toEqual([]);
  });

  test("reads a bare 24-hour clock only when something proves it is one", () => {
    // "18:30" and "09:00" can only be a 24-hour clock; "9–5" cannot be told
    // apart from 09:00–17:00 written badly, and guessing it would send someone
    // to a shop that shut at five in the morning.
    expect(monday("18:30-22:00")[0]).toMatchObject({
      opens: "18:30",
      closes: "22:00",
    });
    expect(monday("09:00-11:00")[0]).toMatchObject({
      opens: "09:00",
      closes: "11:00",
    });
    expect(monday("9-5")).toEqual([]);
    expect(monday("9-11")).toEqual([]);
  });
});

describe("the week", () => {
  test("comes out Monday first however the keys were ordered", () => {
    const week = openingHoursSpecification({
      sunday: "10 AM–6 PM",
      wednesday: "10 AM–6 PM",
      friday: "10 AM–6 PM",
      monday: "10 AM–6 PM",
    });
    expect(week.map((entry) => entry.dayOfWeek)).toEqual([
      "https://schema.org/Monday",
      "https://schema.org/Wednesday",
      "https://schema.org/Friday",
      "https://schema.org/Sunday",
    ]);
  });

  test("names every day the way schema.org does", () => {
    const same = "10 AM–6 PM";
    const week = openingHoursSpecification({
      monday: same,
      tuesday: same,
      wednesday: same,
      thursday: same,
      friday: same,
      saturday: same,
      sunday: same,
    });
    expect(week.map((entry) => entry.dayOfWeek)).toEqual([
      "https://schema.org/Monday",
      "https://schema.org/Tuesday",
      "https://schema.org/Wednesday",
      "https://schema.org/Thursday",
      "https://schema.org/Friday",
      "https://schema.org/Saturday",
      "https://schema.org/Sunday",
    ]);
  });

  test("ignores a key that is not a day", () => {
    const week = openingHoursSpecification({
      caturday: "10 AM–6 PM",
      note: "Open 24 hours",
      monday: "10 AM–6 PM",
    });
    expect(week).toHaveLength(1);
    expect(week[0]?.dayOfWeek).toBe("https://schema.org/Monday");
  });

  test("takes a day key in any case, with stray whitespace", () => {
    const week = openingHoursSpecification({ " Monday ": "Open 24 hours" });
    expect(week[0]?.dayOfWeek).toBe("https://schema.org/Monday");
  });

  test("returns an empty array for no hours at all", () => {
    expect(openingHoursSpecification(undefined)).toEqual([]);
    expect(openingHoursSpecification({})).toEqual([]);
  });
});

describe("mixed notation: a 24-hour endpoint never takes a borrowed meridiem", () => {
  // Inheritance exists for one reason: Google drops the FIRST AM/PM when both
  // ends share one. It must not fire once the start has already proved itself a
  // 24-hour reading, because "09:00" cannot mean nine in the evening. Lending
  // it the "PM" from the far end turned an eight-hour day into 21:00-17:00 — a
  // twenty-hour span crossing midnight, well formed enough that nothing
  // downstream would question it.

  test("a zero-padded start keeps its own clock", () => {
    expect(monday("09:00-5 PM")[0]).toMatchObject({
      opens: "09:00",
      closes: "17:00",
    });
    expect(monday("08:30-6 PM")[0]).toMatchObject({
      opens: "08:30",
      closes: "18:00",
    });
    expect(monday("01:00-11 PM")[0]).toMatchObject({
      opens: "01:00",
      closes: "23:00",
    });
  });

  test("a midnight zero is not folded into the afternoon", () => {
    // (0 % 12) + 12 is noon, so a borrowed PM moved midnight half a day.
    expect(monday("00:30-6 PM")[0]).toMatchObject({
      opens: "00:30",
      closes: "18:00",
    });
    expect(monday("0:30-6 PM")[0]).toMatchObject({
      opens: "00:30",
      closes: "18:00",
    });
  });

  test("an hour past twelve survives untouched", () => {
    // These two were right by arithmetic accident — (h % 12) + 12 === h for
    // 13..23 — so they pin the coincidence rather than trusting it.
    expect(monday("13:00-10 PM")[0]).toMatchObject({
      opens: "13:00",
      closes: "22:00",
    });
    expect(monday("18:30-10 PM")[0]).toMatchObject({
      opens: "18:30",
      closes: "22:00",
    });
  });

  test("and the genuine shared-meridiem elision still inherits", () => {
    // The guard must not swallow the 202 corpus strings that depend on
    // inheritance. "8" and "12" prove nothing on their own, so they still take
    // the trailing meridiem.
    expect(monday("8–10 PM")[0]).toMatchObject({
      opens: "20:00",
      closes: "22:00",
    });
    expect(monday("12–6 AM")[0]).toMatchObject({
      opens: "00:00",
      closes: "06:00",
    });
  });
});

describe("the all-day marker never overrides a closure", () => {
  test("a string that says closed is never read as open around the clock", () => {
    // The all-day test is a substring search over the whole value, so anything
    // merely containing "24 hours" used to win — including a value whose first
    // word is Closed. The failure direction is what makes it serious: it errs
    // towards claiming MORE openness, sending someone to a shut shop.
    expect(monday("Closed 24 hours")).toEqual([]);
    expect(monday("Closed for 24 hours")).toEqual([]);
    expect(monday("Temporarily closed")).toEqual([]);
    expect(monday("Permanently closed")).toEqual([]);
  });

  test("the real all-day markers still work, whatever the casing", () => {
    for (const marker of [
      "Open 24 hours",
      "OPEN 24 HOURS",
      "open 24 hrs",
      "24/7",
      "24 hours",
    ]) {
      expect(monday(marker)[0]).toMatchObject({
        opens: "00:00",
        closes: "23:59",
      });
    }
  });
});

describe("a single day may not be claimed twice", () => {
  test("two spellings of one day that disagree make no claim", () => {
    // Whichever key landed last used to win, so the answer depended on JSON key
    // order — the very thing DAY_ORDER exists to avoid — and in one ordering it
    // published opening hours for a day the other key called Closed.
    expect(
      openingHoursSpecification({ monday: "Closed", Monday: "9 AM-5 PM" }),
    ).toEqual([]);
    expect(
      openingHoursSpecification({ Monday: "9 AM-5 PM", monday: "Closed" }),
    ).toEqual([]);
  });

  test("two spellings that agree are not a conflict", () => {
    const week = openingHoursSpecification({
      Monday: "9 AM-5 PM",
      monday: "9 AM-5 PM",
    });
    expect(week).toHaveLength(1);
    expect(week[0]).toMatchObject({ opens: "09:00", closes: "17:00" });
  });
});

describe("corners the corpus leans on, pinned", () => {
  test("closing exactly at midnight is closes 00:00, not a dropped day", () => {
    // 2,553 occurrences — the most common crossing span in the corpus, and it
    // had no test. closes < opens is how schema.org spells "the next day".
    expect(monday("10 AM–12 AM")[0]).toMatchObject({
      opens: "10:00",
      closes: "00:00",
    });
    expect(monday("12 PM–12 AM")[0]).toMatchObject({
      opens: "12:00",
      closes: "00:00",
    });
  });

  test("a bare tail after a meridiem start is refused, not inherited backwards", () => {
    // The highest-risk line in the module and previously untested: reading
    // "9 AM-5" as a 24-hour clock claims a shop trades until five in the
    // morning, and inheriting the head's AM backwards claims it shuts at dawn.
    expect(monday("9 AM–5")).toEqual([]);
    expect(monday("9 AM–11")).toEqual([]);
    expect(monday("10 PM–2")).toEqual([]);
  });

  test("a split shift is skipped whole rather than half-read", () => {
    // Two ranges in one day is legal schema.org, but this module emits one span
    // per day. Reading only the first half would publish a shop as shut through
    // an evening it is open.
    expect(monday("9 AM–1 PM, 4–10 PM")).toEqual([]);
    expect(monday("9 AM to 5 PM")).toEqual([]);
  });
});
