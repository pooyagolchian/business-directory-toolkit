/**
 * Serialise JSON-LD for safe injection into a `<script>` tag.
 *
 * `JSON.stringify` alone is NOT safe here. It escapes what JSON requires, but
 * a browser's HTML parser does not read JSON — it scans for `</script`, and it
 * will end the script element wherever it finds one, regardless of quoting.
 *
 * That matters because business names come from Google Maps and a business
 * owner controls their own listing name. Renaming a business to
 * `Cafe </script><script>…</script>` would put executable script on every page
 * that rendered it. This is the difference between a stored XSS and a
 * correctly escaped string.
 *
 * The escapes below are all valid JSON, so `JSON.parse` — and every search
 * engine reading the markup — sees exactly the original values.
 */
export function serializeJsonLd(value: unknown): string {
  return (
    JSON.stringify(value)
      // `<` cannot begin `</script` or `<!--` once escaped. Escaping the angle
      // bracket rather than the word means no variant spelling gets through:
      // `</ScRiPt`, `</script foo>` and `<!--` are all neutralised at once.
      .replace(/</g, "\\u003c")
      // U+2028 and U+2029 are valid in JSON strings but terminate a line in
      // JavaScript source, which breaks the surrounding script element.
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")
  );
}
