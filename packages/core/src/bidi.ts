/**
 * Split a bilingual string into script runs, so an Arabic run can carry
 * `lang="ar"`.
 *
 * WHAT THIS FIXES, AND WHAT IT DOES NOT
 *
 * The VISUAL half is already handled, deliberately and in two places: globals.css
 * appends the Arabic face to the Latin font stacks so per-character fallback
 * resolves Arabic glyphs, and every bilingual field carries `dir="auto"` so the
 * bidi algorithm orders it correctly. Read the long note in globals.css before
 * changing either — the family names there are load-bearing.
 *
 * Neither of those tells assistive technology what LANGUAGE it is looking at.
 * `<html lang="en">` is the only lang attribute in the document, so a screen
 * reader announces `مطعم شاميات` with an English voice reading Arabic letters.
 * That is what this is for, and it is the only thing it is for.
 *
 * WHY SPLIT RATHER THAN TAG THE WHOLE STRING
 *
 * Tagging a whole bilingual title `lang="ar"` would be a worse lie than tagging
 * nothing — most of these titles are majority-Latin. Measured in the Dubai v0.1
 * corpus: 391 of 14,981 titles (2.6%) contain any Arabic and only 52 are
 * Arabic-only, so splitting costs a wrapper element on 2.6% of titles and
 * nothing at all on the rest.
 */

export interface ScriptRun {
  text: string;
  /** Present only on an Arabic run. Absent means "inherit the document language". */
  lang?: "ar";
}

/**
 * Every Unicode block that carries Arabic letters.
 *
 * The base block alone (U+0600–U+06FF) is not enough: Google returns listing
 * names containing Presentation Forms (U+FB50–U+FDFF, U+FE70–U+FEFF), which are
 * the shaped glyph variants, and a range check stopping at U+06FF would classify
 * those as Latin and announce them in the wrong voice.
 *
 * Written as escapes, not literal characters. Two reasons, and the second is a
 * real bug the literal form hid: a range of unreadable Arabic glyphs tells a
 * reader nothing about which codepoints it covers, and Presentation Forms-B
 * ends at U+FEFF — which is the BYTE ORDER MARK, not an Arabic letter. Spelling
 * the bound U+FEFC keeps a stray BOM from being classified as Arabic and
 * announced as a word.
 */
const ARABIC =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

export function hasArabic(text: string): boolean {
  return ARABIC.test(text);
}

/**
 * Characters that belong to whichever run they are adjacent to rather than
 * starting one of their own: spaces, digits, and punctuation.
 *
 * Without this a title fragments at every comma and space — "AG CARS, مركز, Deira"
 * would become five runs and five spans, which costs more markup than the
 * accessibility gain is worth. Neutral characters simply extend the current run.
 */
function isNeutral(char: string): boolean {
  return !/\p{L}/u.test(char);
}

export function splitScriptRuns(text: string): ScriptRun[] {
  if (text === "") return [];

  const runs: ScriptRun[] = [];
  let current = "";
  // null until the first letter decides what kind of run this is. Leading
  // punctuation therefore joins whatever letter follows it, rather than forming
  // an untagged run of its own.
  let arabic: boolean | null = null;

  for (const char of text) {
    if (isNeutral(char)) {
      current += char;
      continue;
    }

    const charIsArabic = ARABIC.test(char);
    if (arabic === null) {
      arabic = charIsArabic;
      current += char;
      continue;
    }

    if (charIsArabic === arabic) {
      current += char;
      continue;
    }

    // Script boundary. Trailing neutrals stay with the run that precedes them,
    // which keeps "AL Emad Car Rental " + "العماد" rather than stranding the
    // space in a run of its own.
    runs.push(arabic ? { text: current, lang: "ar" } : { text: current });
    current = char;
    arabic = charIsArabic;
  }

  if (current !== "") {
    runs.push(arabic ? { text: current, lang: "ar" } : { text: current });
  }

  return runs;
}
