import { describe, expect, test } from "vitest";
import { canonicalWebsite } from "./website";

/**
 * These tests pin two obligations that pull in opposite directions.
 *
 * Strip too little and somebody else's campaign attribution ends up in our
 * JSON-LD `url` and in every outbound click. Strip too much and the link
 * 404s — and a broken link on a directory listing is a worse outcome than a
 * dirty one, because the visitor came here to reach that business.
 *
 * So the removals below are each named and argued, and the "keeps" are load
 * bearing: they are the regression net that stops the strip list creeping.
 */
describe("canonicalWebsite", () => {
  describe("removes tracking parameters", () => {
    test("strips every utm_* member, whatever the suffix", () => {
      expect(
        canonicalWebsite(
          "https://example.com/x?utm_source=gmb&utm_medium=organic" +
            "&utm_campaign=c&utm_content=listing&utm_term=t&utm_id=9",
        ),
      ).toBe("https://example.com/x");
    });

    test("strips the advertising click identifiers", () => {
      expect(canonicalWebsite("https://example.com/?gclid=abc123")).toBe(
        "https://example.com/",
      );
      expect(
        canonicalWebsite("https://example.com/?fbclid=PAZXh0bgNhZW0"),
      ).toBe("https://example.com/");
      expect(canonicalWebsite("https://example.com/?msclkid=xyz")).toBe(
        "https://example.com/",
      );
    });

    test("strips the Mailchimp campaign and recipient identifiers", () => {
      expect(
        canonicalWebsite("https://example.com/?mc_cid=1a2b3c&mc_eid=4d5e6f"),
      ).toBe("https://example.com/");
    });

    test("strips the Instagram share identifier", () => {
      expect(
        canonicalWebsite(
          "https://instagram.com/ortodubai?igshid=MzRlODBiNWFlZA==",
        ),
      ).toBe("https://instagram.com/ortodubai");
    });

    /**
     * Instagram renamed `igshid` to `igsh`. Measured in the corpus: 54 `igsh`
     * against 30 `igshid`, so honouring only the older spelling would leave the
     * majority of Instagram links dirty.
     */
    test("strips the renamed Instagram share identifier", () => {
      expect(
        canonicalWebsite(
          "https://instagram.com/lamer_gems?igsh=NTc4MTIwNjQ2YQ==",
        ),
      ).toBe("https://instagram.com/lamer_gems");
    });

    test("strips the Google Analytics cross-domain linker", () => {
      expect(canonicalWebsite("https://example.com/?_ga=2.1.2.3")).toBe(
        "https://example.com/",
      );
      expect(canonicalWebsite("https://example.com/?_gl=1*abc*def")).toBe(
        "https://example.com/",
      );
    });

    /**
     * `gbraid` and `wbraid` are what Google Ads sends instead of `gclid` when
     * iOS privacy rules forbid the user-scoped one. Same system, same purpose,
     * so leaving them would be honouring the letter of the strip list and not
     * its point.
     */
    test("strips gclid's privacy-era replacements", () => {
      expect(canonicalWebsite("https://example.com/?gbraid=0AAAAA")).toBe(
        "https://example.com/",
      );
      expect(canonicalWebsite("https://example.com/?wbraid=0BBBBB")).toBe(
        "https://example.com/",
      );
    });

    /**
     * A business owner types their own listing, so the casing is theirs. No
     * server routes on the difference between `UTM_Source` and `utm_source`,
     * and matching only the lowercase spelling would make the strip list
     * trivially evadable by accident.
     */
    test("matches parameter names case-insensitively", () => {
      expect(
        canonicalWebsite("https://example.com/x?UTM_Source=Google&GCLID=abc"),
      ).toBe("https://example.com/x");
    });
  });

  describe("keeps everything it was not asked to remove", () => {
    test("keeps a parameter the site routes on", () => {
      expect(canonicalWebsite("https://example.com/page?id=42")).toBe(
        "https://example.com/page?id=42",
      );
      expect(canonicalWebsite("https://example.com/?lang=ar")).toBe(
        "https://example.com/?lang=ar",
      );
    });

    /**
     * The conservative call, and the one most likely to be revisited, so it is
     * pinned rather than left to inference.
     *
     * `ref` occurs ONCE in a 10,348-website corpus; `ref_` once (Amazon, where
     * it is part of store routing) and `referer` once. Set against that, `ref`
     * is a routing parameter on plenty of real sites — referral codes, affiliate
     * landings, in-app deep links. Stripping it buys one cleaner URL and risks
     * breaking any of them. The measurement argues for leaving it, so it stays.
     */
    test("keeps ref and referrer — measured too rare to be worth the risk", () => {
      expect(canonicalWebsite("https://example.com/?ref=partner-site")).toBe(
        "https://example.com/?ref=partner-site",
      );
      expect(canonicalWebsite("https://example.com/?referrer=abc")).toBe(
        "https://example.com/?referrer=abc",
      );
    });

    test("keeps the survivors when only some parameters are stripped", () => {
      expect(
        canonicalWebsite(
          "https://example.com/book?id=42&utm_source=gmb&lang=ar&gclid=x",
        ),
      ).toBe("https://example.com/book?id=42&lang=ar");
    });

    test("preserves the order of the parameters it keeps", () => {
      expect(
        canonicalWebsite("https://example.com/?z=1&utm_medium=m&a=2&b=3"),
      ).toBe("https://example.com/?z=1&a=2&b=3");
    });

    /**
     * Measured: rebuilding the query through URLSearchParams mutates 147 of the
     * corpus's queries — `%20` becomes `+`, `,` becomes `%2C`. Equivalent to
     * most servers, but not all, and this value is rendered as a link a human
     * may read. Kept parameters are therefore spliced out of `URL.search` and
     * never handed to a second serialiser. What that does and does not promise
     * is pinned by the test below.
     */
    test("does not re-normalise the parameters it keeps", () => {
      expect(
        canonicalWebsite(
          "https://example.com/x?utm_source=g&note=seo%20maps&list=a,b",
        ),
      ).toBe("https://example.com/x?note=seo%20maps&list=a,b");
    });

    /**
     * The limit of the promise above, and the reason it is worded as "does not
     * re-NORMALISE" rather than "does not re-encode".
     *
     * The query is spliced out of `URL.search`, not out of the caller's string,
     * so anything the WHATWG parser must percent-encode on the way in is
     * already encoded by the time the splice sees it — space, `"`, `<`, `>`.
     * That is a smaller set than URLSearchParams touches, which is the whole
     * point of not using URLSearchParams, but it is not nothing.
     *
     * Pinned because the alternative reading — that kept parameters survive as
     * literal input bytes — is what a reader would otherwise assume, and acting
     * on it means reaching for a raw-text splice that reintroduces every
     * malformed-URL crash the parser currently absorbs.
     */
    test("percent-encodes what the URL parser must, even in a kept parameter", () => {
      expect(
        canonicalWebsite("https://example.com/x?note=seo maps&utm_source=g"),
      ).toBe("https://example.com/x?note=seo%20maps");
      expect(
        canonicalWebsite('https://example.com/x?q=<a href="b">&gclid=1'),
      ).toBe("https://example.com/x?q=%3Ca%20href=%22b%22%3E");
    });

    /**
     * Tracking inside the FRAGMENT is left alone, and this is a decision rather
     * than an oversight — which is why it is pinned, because it looks exactly
     * like a gap somebody should close.
     *
     * A `#` query belongs to a hash router, not to a server: `#/home?tab=2` is
     * how a single-page app addresses its own views, and the fragment is never
     * sent upstream, so there is no analytics attribution to remove. Editing it
     * would be rewriting the site's internal routing to fix a leak that does
     * not exist. (Measured: 0 corpus URLs carry tracking in the fragment.)
     */
    test("leaves the fragment alone, tracking-shaped or not", () => {
      expect(
        canonicalWebsite("https://example.com/app/#/home?utm_source=g"),
      ).toBe("https://example.com/app/#/home?utm_source=g");
    });

    test("keeps a parameter whose name merely starts with a stripped one", () => {
      // `utmost` is not `utm_*`, and `gclid_backup` is not `gclid`. Prefix
      // matching is deliberately anchored so neither is caught.
      expect(
        canonicalWebsite("https://example.com/?utmost=1&gclid_backup=2"),
      ).toBe("https://example.com/?utmost=1&gclid_backup=2");
    });
  });

  describe("preserves the shape of the URL", () => {
    test("drops the ? entirely when stripping empties the query", () => {
      const out = canonicalWebsite("https://example.com/dubai?utm_source=gmb");
      expect(out).toBe("https://example.com/dubai");
      expect(out).not.toContain("?");
    });

    test("keeps the fragment", () => {
      expect(
        canonicalWebsite(
          "https://www.myviva.com/store-finder/?utm_source=g#karama-1",
        ),
      ).toBe("https://www.myviva.com/store-finder/#karama-1");
      expect(canonicalWebsite("https://qr.emenu.ae/h2ocafe/#/home")).toBe(
        "https://qr.emenu.ae/h2ocafe/#/home",
      );
    });

    test("keeps a non-default port", () => {
      expect(
        canonicalWebsite("https://example.com:8443/menu?utm_source=g"),
      ).toBe("https://example.com:8443/menu");
    });

    /**
     * Path case is significant on any case-sensitive filesystem, so lowercasing
     * it would 404 the link. The host is case-insensitive by DNS, so folding it
     * is safe and makes equal URLs compare equal.
     */
    test("preserves path case while lowercasing the host", () => {
      expect(canonicalWebsite("https://WWW.Example.COM/En-US/Menu")).toBe(
        "https://www.example.com/En-US/Menu",
      );
    });

    /**
     * A toolkit claim, not a Dubai one: the next city to be crawled may well be
     * one whose businesses use a non-ASCII domain. Both halves are normalised
     * rather than rejected — the host to punycode, which is what DNS resolves
     * anyway, and the path to percent-encoded UTF-8, which is what a browser
     * puts on the wire. So the output is the same address, spelled the way a
     * server will receive it, and the case argument made about `pathname`
     * elsewhere is about CASE only — this is the counter-example to reading it
     * as "the path is passed through untouched".
     */
    test("normalises an internationalised host and a non-ASCII path", () => {
      expect(canonicalWebsite("https://münchen.de/straße?utm_source=g")).toBe(
        "https://xn--mnchen-3ya.de/stra%C3%9Fe",
      );
    });

    test("drops a bare ? that carries no query at all", () => {
      expect(canonicalWebsite("https://example.com/menu?")).toBe(
        "https://example.com/menu",
      );
    });

    /**
     * `?a=&&b=1` and a trailing `&` are listing typos that cost nothing to
     * absorb — but the filter that absorbs them is load bearing for a second
     * reason. Without it, stripping the tracking out of `?utm_source=g&id=4`
     * would leave the empty neighbour behind as `?&id=4`.
     */
    test("collapses the empty segments a stray & leaves behind", () => {
      expect(canonicalWebsite("https://example.com/x?&&")).toBe(
        "https://example.com/x",
      );
      expect(
        canonicalWebsite("https://example.com/x?&utm_source=g&id=4&"),
      ).toBe("https://example.com/x?id=4");
    });

    test("keeps http as well as https", () => {
      expect(canonicalWebsite("http://www.kanzjewels.com/")).toBe(
        "http://www.kanzjewels.com/",
      );
    });

    test("trims surrounding whitespace, which is a listing typo not an address", () => {
      expect(canonicalWebsite("  https://example.com/x  ")).toBe(
        "https://example.com/x",
      );
    });
  });

  describe("refuses anything that must not reach an href", () => {
    /**
     * The threat is concrete: a business owner controls their own Google
     * listing, so `website` is attacker-influencable text that this codebase
     * renders into an href and into JSON-LD. serializeJsonLd escapes the
     * string, but escaping does not help when the string IS the executable —
     * a `javascript:` href runs on click no matter how well quoted it was.
     */
    test("rejects javascript: and data: URIs", () => {
      expect(
        canonicalWebsite("javascript:alert(document.cookie)"),
      ).toBeUndefined();
      expect(
        canonicalWebsite(
          "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
        ),
      ).toBeUndefined();
      expect(canonicalWebsite("JavaScript:alert(1)")).toBeUndefined();
    });

    test("rejects other non-http schemes", () => {
      expect(canonicalWebsite("file:///etc/passwd")).toBeUndefined();
      expect(canonicalWebsite("vbscript:msgbox(1)")).toBeUndefined();
      expect(canonicalWebsite("ftp://example.com/x")).toBeUndefined();
      expect(canonicalWebsite("mailto:hello@example.com")).toBeUndefined();
    });

    /**
     * The implementation gets this from `URL.origin`, which happens to exclude
     * userinfo — so it is a property of the expression used, not of anything
     * stated in the code, and a refactor to `${protocol}//${host}` or to a
     * splice of the original text would reinstate the credentials with nothing
     * going red. Pinned here because publishing someone's password into a
     * public href is not a defect worth discovering from a bug report.
     */
    test("drops userinfo credentials rather than publishing them", () => {
      expect(
        canonicalWebsite(
          "https://admin:s3cret@example.com/portal?utm_source=g",
        ),
      ).toBe("https://example.com/portal");
      expect(canonicalWebsite("https://admin@example.com/portal")).toBe(
        "https://example.com/portal",
      );
    });

    /**
     * The same removal defuses a second attack, which is worth stating because
     * it is the one a visitor cannot defend against. `https://<trusted>@evil/`
     * reads as the trusted host to a human skimming a link, and resolves to
     * `evil`. Dropping userinfo makes the rendered link say where it actually
     * goes — and makes it agree with the JSON-LD `url` beside it.
     */
    test("defuses the userinfo host-spoof shape", () => {
      expect(
        canonicalWebsite("https://www.emirates.com@evil.example/offers"),
      ).toBe("https://evil.example/offers");
    });
  });

  describe("never throws", () => {
    test("returns undefined for absent or empty input", () => {
      expect(canonicalWebsite(undefined)).toBeUndefined();
      expect(canonicalWebsite("")).toBeUndefined();
      expect(canonicalWebsite("   ")).toBeUndefined();
    });

    test("returns undefined for input that is not a URL", () => {
      expect(canonicalWebsite("not a url")).toBeUndefined();
      expect(canonicalWebsite("www.example.com")).toBeUndefined();
      expect(canonicalWebsite("//example.com/x")).toBeUndefined();
      expect(canonicalWebsite("https://")).toBeUndefined();
    });

    /**
     * The cases above all look wrong to a human. This one does not: it is a
     * well-formed https URL with a plausible host, and it still has no address,
     * because `xn--a` is not decodable punycode and IDNA rejects it. It is the
     * reason the guard is a try/catch around the parser rather than a regex on
     * the scheme — a scheme test would wave this through and hand an
     * unresolvable host to the renderer.
     */
    test("returns undefined for a well-formed URL whose host fails IDNA", () => {
      expect(canonicalWebsite("https://xn--a.com/x")).toBeUndefined();
    });

    /**
     * A lone `%` and a `%zz` are malformed percent-escapes: decodeURIComponent
     * throws URIError on both. Parameter names are decoded before matching, so
     * without a guard this input would take down whatever page rendered it.
     */
    test("survives malformed percent-escapes in a parameter name", () => {
      expect(() =>
        canonicalWebsite("https://example.com/?%zz=1&%=2&utm_source=g"),
      ).not.toThrow();
      expect(canonicalWebsite("https://example.com/?%zz=1&utm_source=g")).toBe(
        "https://example.com/?%zz=1",
      );
    });

    test("survives a percent-encoded spelling of a tracking name", () => {
      // `%75` is `u`. Decoding the name before matching closes the gap.
      expect(canonicalWebsite("https://example.com/x?%75tm_source=g")).toBe(
        "https://example.com/x",
      );
    });
  });

  /**
   * The URL that motivated the module, in the shape the crawler stores it.
   * 841 of the corpus's 10,348 websites carry a `utm_*`; 909 carry at least one
   * parameter this function removes.
   */
  test("cleans a real corpus-shaped listing URL", () => {
    expect(
      canonicalWebsite(
        "https://www.atlantis.com/dubai/atlantis-the-palm" +
          "?utm_source=googleplaces&utm_medium=location&utm_campaign=atp&utm_content=listing",
      ),
    ).toBe("https://www.atlantis.com/dubai/atlantis-the-palm");
  });
});
