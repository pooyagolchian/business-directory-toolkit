import { describe, expect, test } from "vitest";
import { hasArabic, splitScriptRuns } from "./bidi";

/**
 * Splitting a bilingual title into script runs, so the Arabic half can be
 * marked `lang="ar"`.
 *
 * This is an ACCESSIBILITY fix, not a rendering one. The rendering half is
 * already handled deliberately — globals.css appends the Arabic face to the
 * Latin stacks so per-character font fallback resolves the Arabic run, and
 * `dir="auto"` gets the bidi ordering right. What neither does is tell a screen
 * reader which language it is looking at, so `مطعم شاميات` is currently
 * announced by an English voice reading Arabic letters.
 *
 * Measured: 391 of 14,981 titles (2.6%) contain Arabic, and 52 are Arabic-only.
 * That is small enough that wrapping only the Arabic runs costs almost nothing
 * in payload — which is the reason this splits rather than tagging whole titles.
 */
describe("splitScriptRuns", () => {
  test("returns one untagged run for a title with no Arabic", () => {
    // The common case by far, and it must produce no wrapper element at all.
    expect(splitScriptRuns("Yoko Sizzlers")).toEqual([
      { text: "Yoko Sizzlers" },
    ]);
  });

  test("returns one tagged run for an Arabic-only title", () => {
    expect(splitScriptRuns("مطعم شاميات")).toEqual([
      { text: "مطعم شاميات", lang: "ar" },
    ]);
  });

  test("splits a real bilingual title at the script boundary", () => {
    const runs = splitScriptRuns("AL Emad Car Rental العماد لتأجير السيارات");
    expect(runs).toEqual([
      { text: "AL Emad Car Rental " },
      { text: "العماد لتأجير السيارات", lang: "ar" },
    ]);
  });

  test("handles Latin after Arabic, and Latin on both sides", () => {
    expect(splitScriptRuns("مطعم Shamiat Dubai")).toEqual([
      { text: "مطعم ", lang: "ar" },
      { text: "Shamiat Dubai" },
    ]);
    const runs = splitScriptRuns("AG CARS - مركز ايه جي, Deira");
    expect(runs.map((r) => r.lang)).toEqual([undefined, "ar", undefined]);
    expect(runs.map((r) => r.text).join("")).toBe(
      "AG CARS - مركز ايه جي, Deira",
    );
  });

  /**
   * The reassembly property. Whatever the split does, concatenating the runs
   * must reproduce the input byte for byte — this markup wraps live business
   * names, and a split that drops or duplicates a character corrupts the one
   * thing the page exists to state.
   */
  test("always reassembles to exactly the input", () => {
    for (const title of [
      "Yoko Sizzlers",
      "مطعم شاميات",
      "Sallet al Sayad seafood restaurant مطعم سلة الصياد للمأكولات البحرية",
      "AG CARS Vehicle Testing Centre, Deira - مركز ايه جي كارس لفحص المركبات, ديرة",
      "Café Crème – مقهى",
      "123 مطعم 456",
      "",
    ]) {
      expect(
        splitScriptRuns(title)
          .map((r) => r.text)
          .join(""),
      ).toBe(title);
    }
  });

  test("keeps punctuation and digits with the run they sit in, not as their own run", () => {
    // Otherwise a title fragments into a dozen spans and the markup costs more
    // than the accessibility gain is worth.
    expect(splitScriptRuns("Shop 4, Marina Walk").length).toBe(1);
    expect(splitScriptRuns("مطعم، شاميات").length).toBe(1);
  });

  test("returns an empty array for an empty string", () => {
    expect(splitScriptRuns("")).toEqual([]);
  });

  test("never emits an empty run", () => {
    for (const title of ["مطعم Shamiat", "A مطعم B", "مطعم"]) {
      expect(splitScriptRuns(title).every((r) => r.text.length > 0)).toBe(true);
    }
  });

  test("covers the Arabic Presentation Forms block, not just the base block", () => {
    // U+FEF3 is an Arabic Presentation Form; Google returns these in some
    // listing names, and a range check that stops at U+06FF would miss them.
    const runs = splitScriptRuns("Shop ﻳ");
    expect(runs[1]?.lang).toBe("ar");
  });
});

describe("hasArabic", () => {
  test("is true only when an Arabic character is present", () => {
    expect(hasArabic("مطعم شاميات")).toBe(true);
    expect(hasArabic("Yoko Sizzlers")).toBe(false);
    expect(hasArabic("")).toBe(false);
  });
});
