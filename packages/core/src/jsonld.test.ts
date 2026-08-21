import { describe, expect, test } from "vitest";
import { serializeJsonLd } from "./jsonld.js";

/**
 * Business names come from Google, and a business owner controls their own
 * listing name. That makes every title attacker-influencable, and JSON-LD is
 * injected into the page inside a <script> tag — so a title is one bad
 * serialiser away from being executable.
 */
describe("serializeJsonLd", () => {
  test("escapes a closing script tag hidden in a business name", () => {
    const payload = {
      name: "Evil </script><script>alert(document.cookie)</script>",
    };
    const out = serializeJsonLd(payload);
    // The literal sequence a browser's HTML parser looks for must not survive.
    expect(out).not.toContain("</script>");
  });

  test("still parses back to exactly the same object", () => {
    // Escaping must be transparent: search engines have to read this.
    const payload = {
      name: "Evil </script><script>alert(1)</script>",
      rating: 4.5,
    };
    expect(JSON.parse(serializeJsonLd(payload))).toEqual(payload);
  });

  test("escapes the HTML comment opener, which also terminates a script", () => {
    const out = serializeJsonLd({ name: "before <!-- after" });
    expect(out).not.toContain("<!--");
    expect(JSON.parse(out).name).toBe("before <!-- after");
  });

  test("escapes U+2028 and U+2029, which break JavaScript string literals", () => {
    const out = serializeJsonLd({ name: "line\u2028break\u2029here" });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out).name).toBe("line\u2028break\u2029here");
  });

  test("leaves ordinary Arabic titles untouched and readable", () => {
    // Dubai listings are bilingual; escaping must not mangle them.
    const payload = { name: "Shamiat Restaurant مطعم شاميات" };
    expect(JSON.parse(serializeJsonLd(payload)).name).toBe(payload.name);
  });

  test("handles nested objects, since JSON-LD address blocks are nested", () => {
    const payload = {
      address: { streetAddress: "</script><img onerror=alert(1)>" },
    };
    const out = serializeJsonLd(payload);
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)).toEqual(payload);
  });
});
