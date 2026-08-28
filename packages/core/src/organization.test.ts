import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { publisherJsonLd } from "./organization";

/**
 * A second, deliberately unrelated deployment. Every assertion about ADR 0005
 * is really the same assertion — a fork configures these seven strings and
 * inherits nothing else — so it is worth having one fixture that shares no
 * substring with the reference deployment.
 */
const FORK = {
  siteUrl: "https://guide.example.org",
  siteName: "Lisbon Guide",
  description: "Cafés and workshops in Lisbon.",
  repoUrl: "https://git.example.org/maria/lisbon-guide",
  authorName: "Maria Sousa",
  authorUrl: "https://maria.example.org",
} as const;

const SITE = {
  siteUrl: "https://directory.pooyagolchian.com",
  siteName: "Directory from Scratch",
  description: "A business directory for Dubai, built in public.",
  repoUrl: "https://github.com/pooyagolchian/business-directory-toolkit",
  authorName: "Pooya Golchian",
  authorUrl: "https://pooyagolchian.com",
} as const;

describe("publisherJsonLd", () => {
  test("emits one @graph holding exactly an Organization and a WebSite", () => {
    const graph = publisherJsonLd(SITE);
    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@graph"].map((node) => node["@type"])).toEqual([
      "Organization",
      "WebSite",
    ]);
  });

  test("gives each node a stable, fragment-scoped @id", () => {
    const [organization, website] = publisherJsonLd(SITE)["@graph"];
    expect(organization["@id"]).toBe(`${SITE.siteUrl}/#organization`);
    expect(website["@id"]).toBe(`${SITE.siteUrl}/#website`);
  });

  /**
   * The point of the graph. A reference that does not resolve to a node in the
   * same document is a dangling pointer, and an answer engine reading it learns
   * nothing about who publishes the site — which is the whole reason this
   * markup exists.
   */
  test("resolves WebSite.publisher to the Organization node in the same graph", () => {
    const graph = publisherJsonLd(SITE);
    const [, website] = graph["@graph"];
    const referenced = graph["@graph"].find(
      (node) => node["@id"] === website.publisher["@id"],
    );
    expect(referenced?.["@type"]).toBe("Organization");
  });

  test("carries the source repository in Organization.sameAs", () => {
    const [organization] = publisherJsonLd(SITE)["@graph"];
    expect(organization.sameAs).toEqual([SITE.repoUrl]);
  });

  /**
   * Absent, not `undefined`. `JSON.stringify` drops an undefined value silently,
   * so both spellings serialise identically and a test that only checked the
   * rendered string would pass either way — but `Object.keys` sees the
   * difference, and so does anything that iterates the node before it is
   * serialised.
   */
  test("omits sameAs entirely when there is no repository to point at", () => {
    const [organization] = publisherJsonLd({
      siteUrl: SITE.siteUrl,
      siteName: SITE.siteName,
    })["@graph"];
    expect(organization).not.toHaveProperty("sameAs");
    expect(Object.keys(organization)).not.toContain("sameAs");
  });

  /**
   * An environment variable that is set but empty is not a repository URL.
   * `sameAs: [""]` would be a claim that the publisher is also the empty string.
   */
  test("treats an empty repoUrl as absent rather than as a URL", () => {
    const [organization] = publisherJsonLd({ ...SITE, repoUrl: "" })["@graph"];
    expect(organization).not.toHaveProperty("sameAs");
  });

  test("omits every optional field when the caller supplies only the two required ones", () => {
    const graph = publisherJsonLd({
      siteUrl: SITE.siteUrl,
      siteName: SITE.siteName,
    });
    const [organization, website] = graph["@graph"];
    expect(Object.keys(organization).sort()).toEqual([
      "@id",
      "@type",
      "name",
      "url",
    ]);
    expect(website).not.toHaveProperty("description");
    // Nothing may serialise as an explicit null either.
    expect(JSON.stringify(graph)).not.toContain("null");
  });

  test("attaches the author to the Organization as its founder", () => {
    const [organization] = publisherJsonLd(SITE)["@graph"];
    expect(organization.founder).toEqual({
      "@type": "Person",
      name: SITE.authorName,
      url: SITE.authorUrl,
    });
  });

  /**
   * A Person node whose only property is a URL identifies nobody. The name is
   * what an entity resolver reconciles on, so without it there is no founder to
   * describe and the key is dropped rather than half-filled.
   */
  test("omits the founder when no author name is given, even if a URL is", () => {
    const [organization] = publisherJsonLd({
      siteUrl: SITE.siteUrl,
      siteName: SITE.siteName,
      authorUrl: SITE.authorUrl,
    })["@graph"];
    expect(organization).not.toHaveProperty("founder");
  });

  test("omits the founder's url while keeping the name", () => {
    const [organization] = publisherJsonLd({
      siteUrl: SITE.siteUrl,
      siteName: SITE.siteName,
      authorName: SITE.authorName,
    })["@graph"];
    expect(organization.founder).toEqual({
      "@type": "Person",
      name: SITE.authorName,
    });
  });

  test("defaults inLanguage to en", () => {
    const [, website] = publisherJsonLd(SITE)["@graph"];
    expect(website.inLanguage).toBe("en");
  });

  test("honours an explicit inLanguage", () => {
    const [, website] = publisherJsonLd({ ...SITE, inLanguage: "ar-AE" })[
      "@graph"
    ];
    expect(website.inLanguage).toBe("ar-AE");
  });

  test("describes the site on the WebSite node", () => {
    const [, website] = publisherJsonLd(SITE)["@graph"];
    expect(website.description).toBe(SITE.description);
  });

  /**
   * The base reaches this from whatever the caller holds — SITE_URL strips its
   * trailing slash, an env var pasted from a browser address bar will not. A
   * doubled slash produces `…com//#organization`, a different @id from the one
   * every other page emits, and the graph silently stops joining up.
   */
  test("tolerates a trailing slash on siteUrl without doubling it", () => {
    const [organization, website] = publisherJsonLd({
      ...SITE,
      siteUrl: `${SITE.siteUrl}/`,
    })["@graph"];
    expect(organization["@id"]).toBe(`${SITE.siteUrl}/#organization`);
    expect(website["@id"]).toBe(`${SITE.siteUrl}/#website`);
    expect(organization.url).toBe(SITE.siteUrl);
  });

  /**
   * Google retired the sitelinks searchbox result in late 2024, and this site's
   * /search route is Disallow-ed in robots.ts. A SearchAction would therefore
   * be markup for a dead feature pointing crawlers at a route we have asked
   * them not to crawl. This test is the guard against someone helpfully adding
   * it back.
   */
  test("emits no potentialAction on the WebSite", () => {
    const [, website] = publisherJsonLd(SITE)["@graph"];
    expect(website).not.toHaveProperty("potentialAction");
    expect(JSON.stringify(website)).not.toContain("SearchAction");
  });

  test("passes a non-Latin site name through verbatim", () => {
    const name = "دليل دبي — Dubai Directory";
    const [organization, website] = publisherJsonLd({
      siteUrl: SITE.siteUrl,
      siteName: name,
    })["@graph"];
    expect(organization.name).toBe(name);
    expect(website.name).toBe(name);
  });

  /**
   * ADR 0005: a city is data, and so is the deployment's identity. A fork that
   * sets its own seven strings must not find this deployment's domain, name,
   * author or repository anywhere in its markup.
   */
  test("a fork inherits none of the reference deployment's identity", () => {
    const rendered = JSON.stringify(publisherJsonLd(FORK));
    for (const inherited of Object.values(SITE)) {
      expect(rendered).not.toContain(inherited);
    }
    expect(rendered).toContain(FORK.siteName);
    expect(rendered).toContain(FORK.repoUrl);
    expect(rendered).toContain(FORK.authorName);
  });

  /**
   * The same rule, enforced one level down: it is not enough that the fork's
   * output looks clean for the inputs this file happens to test. The module
   * must contain no identity of its own to leak in the first place.
   *
   * Reading a file from a test does not breach the no-I/O rule for
   * packages/core — the rule is about what ships, and this assertion is how we
   * prove what ships is data-driven. `import.meta.url` resolves beside the test
   * regardless of the working directory the suite was started from.
   */
  describe("the module hard-codes no identity of its own", () => {
    const source = readFileSync(
      new URL("./organization.ts", import.meta.url),
      "utf8",
    );

    test.each(["Dubai", "pooyagolchian", "Directory from Scratch", "github"])(
      "does not mention %s",
      (needle) => {
        expect(source.toLowerCase()).not.toContain(needle.toLowerCase());
      },
    );

    /**
     * The general form of the rule. schema.org is the vocabulary the markup is
     * written in, so it is the one URL that is genuinely part of the code;
     * every other absolute URL in the output has to arrive as an argument.
     */
    test("contains no absolute URL but the schema.org vocabulary", () => {
      const urls = source.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
      expect(
        urls.filter((url) => !url.startsWith("https://schema.org")),
      ).toEqual([]);
    });
  });
});

/**
 * Everything below is a regression guard added after an adversarial review.
 *
 * The module already reasoned, correctly and in a comment, that "an environment
 * variable that is set but empty is not a URL". The guards it wrote from that
 * reasoning tested `""` and stopped there — so a value of `"   "`, which is what
 * a `.env` line with a stray space after the `=` actually produces, walked
 * straight past every one of them and was published as a fact.
 */
describe("publisherJsonLd: blank and malformed configuration", () => {
  const MINIMUM = { siteUrl: "https://guide.example.org", siteName: "Guide" };

  /**
   * A directory's markup is graded by the same rule the LocalBusiness node is:
   * a wrong claim is worse than a missing one, which is why that node omits
   * aggregateRating rather than guess. `sameAs: ["   "]` is a claim that the
   * publisher is also findable at a URL made of spaces.
   */
  test.each([" ", "   ", "\t", "\n"])(
    "treats a whitespace-only repoUrl (%j) as absent, not as a URL",
    (blank) => {
      const [organization] = publisherJsonLd({ ...MINIMUM, repoUrl: blank })[
        "@graph"
      ];
      expect(organization).not.toHaveProperty("sameAs");
    },
  );

  test("trims a repoUrl rather than publishing the caller's whitespace", () => {
    const [organization] = publisherJsonLd({
      ...MINIMUM,
      repoUrl: "  https://git.example.org/maria/guide  ",
    })["@graph"];
    expect(organization.sameAs).toEqual([
      "https://git.example.org/maria/guide",
    ]);
  });

  /**
   * A Person node named `" "` asserts that a human exists and is called a
   * space. That is a fabricated entity, and an entity resolver that reconciles
   * on `name` has no way to tell it from a real one.
   */
  test.each([" ", "   ", "\t"])(
    "treats a whitespace-only authorName (%j) as absent, not as a person",
    (blank) => {
      const [organization] = publisherJsonLd({ ...MINIMUM, authorName: blank })[
        "@graph"
      ];
      expect(organization).not.toHaveProperty("founder");
    },
  );

  test("keeps a named founder but drops a whitespace-only authorUrl", () => {
    const [organization] = publisherJsonLd({
      ...MINIMUM,
      authorName: "  Maria Sousa  ",
      authorUrl: "   ",
    })["@graph"];
    expect(organization.founder).toEqual({
      "@type": "Person",
      name: "Maria Sousa",
    });
  });

  test("treats a whitespace-only description as absent", () => {
    const [, website] = publisherJsonLd({ ...MINIMUM, description: "   " })[
      "@graph"
    ];
    expect(website).not.toHaveProperty("description");
  });

  /**
   * `??` only catches null and undefined, so a blank `DIRECTORY_SITE_LANG`
   * published `inLanguage: ""` — not a BCP 47 tag, and a direct claim that the
   * document is written in no language at all. The default exists precisely to
   * cover the case where the caller has nothing useful to say.
   */
  test.each(["", " ", "\t"])(
    "falls back to en when inLanguage is blank (%j)",
    (blank) => {
      const [, website] = publisherJsonLd({ ...MINIMUM, inLanguage: blank })[
        "@graph"
      ];
      expect(website.inLanguage).toBe("en");
    },
  );

  /**
   * siteUrl and siteName are load-bearing: every `@id` in the graph is built
   * from the first, and both nodes are named by the second. There is no
   * degraded output worth emitting — a blank base collapses every page's `@id`
   * to the relative `/#organization`, which silently stops joining up with
   * itself. `packages/core/src/city.ts` throws on a blank required config
   * string for the same reason, and this follows that register.
   */
  test.each(["", "   ", "\n"])(
    "throws rather than emit a graph with a blank siteUrl (%j)",
    (blank) => {
      expect(() => publisherJsonLd({ ...MINIMUM, siteUrl: blank })).toThrow(
        /siteUrl/,
      );
    },
  );

  test.each(["", "   "])(
    "throws rather than emit an unnamed Organization (siteName %j)",
    (blank) => {
      expect(() => publisherJsonLd({ ...MINIMUM, siteName: blank })).toThrow(
        /siteName/,
      );
    },
  );

  /**
   * schema.org needs an absolute URL to join nodes across documents. A relative
   * base produces `@id`s that mean a different thing on every route that emits
   * them, which is worse than no markup at all.
   */
  test.each(["/directory", "example.org", "mailto:maria@example.org"])(
    "throws on a siteUrl that is not an absolute http(s) URL (%j)",
    (bad) => {
      expect(() => publisherJsonLd({ ...MINIMUM, siteUrl: bad })).toThrow(
        /siteUrl/,
      );
    },
  );

  /**
   * The trailing-slash normalisation is the module's longest comment, and a
   * single trailing space defeated it: `/\/+$/` cannot match when the last
   * character is a space, so `https://e.org/ ` kept both its slash and its
   * space and produced `https://e.org/ /#organization` — the doubled-identity
   * failure that comment exists to prevent, with an illegal space in it.
   */
  test("normalises a siteUrl whose trailing slash is followed by whitespace", () => {
    const [organization, website] = publisherJsonLd({
      ...MINIMUM,
      siteUrl: "  https://guide.example.org/  ",
    })["@graph"];
    expect(organization["@id"]).toBe("https://guide.example.org/#organization");
    expect(website["@id"]).toBe("https://guide.example.org/#website");
    expect(organization.url).toBe("https://guide.example.org");
  });

  /**
   * Measured against the real corpus: of 10,348 records carrying a website, 17
   * held a URL that already had a fragment, and every one of them concatenated
   * into a double-fragment `@id` such as `https://…/#home/#organization`. A
   * query string does the same. Neither belongs in a site's identity, so the
   * base is rebuilt from origin and path rather than pasted onto.
   */
  test.each([
    ["https://guide.example.org/?utm_source=gmb", "https://guide.example.org"],
    ["https://guide.example.org/#home", "https://guide.example.org"],
    [
      "https://guide.example.org/lisbon/?a=b#c",
      "https://guide.example.org/lisbon",
    ],
  ])("strips the query and fragment off %j", (siteUrl, expected) => {
    const [organization, website] = publisherJsonLd({ ...MINIMUM, siteUrl })[
      "@graph"
    ];
    expect(organization["@id"]).toBe(`${expected}/#organization`);
    expect(website["@id"]).toBe(`${expected}/#website`);
    expect(organization.url).toBe(expected);
  });

  /**
   * The invariant the corpus run actually checks, stated once: whatever shape
   * the caller's base arrives in, the fragment is exactly the node's name and
   * nothing in the identifier is whitespace.
   */
  test.each([
    "https://guide.example.org",
    "https://guide.example.org/",
    "https://guide.example.org///",
    "  https://guide.example.org/  ",
    "https://guide.example.org/?a=b/",
    "https://guide.example.org/#/home",
  ])("gives %j an @id whose fragment is exactly #organization", (siteUrl) => {
    const [organization, website] = publisherJsonLd({ ...MINIMUM, siteUrl })[
      "@graph"
    ];
    expect(organization["@id"].slice(organization["@id"].indexOf("#"))).toBe(
      "#organization",
    );
    expect(website.publisher["@id"]).toBe(organization["@id"]);
    expect(organization["@id"]).not.toMatch(/\s/);
  });

  /**
   * A host is case-insensitive, so two spellings of the same origin are the
   * same site — but they are two different strings, and two different `@id`s
   * do not join. Normalising the host means a fork that types its domain
   * inconsistently across environments still emits one identity.
   */
  test("normalises host case so one site cannot have two identities", () => {
    const lower = publisherJsonLd(MINIMUM)["@graph"][0]["@id"];
    const upper = publisherJsonLd({
      ...MINIMUM,
      siteUrl: "https://Guide.Example.ORG",
    })["@graph"][0]["@id"];
    expect(upper).toBe(lower);
  });

  test("trims a siteName rather than naming the publisher with whitespace", () => {
    const [organization, website] = publisherJsonLd({
      ...MINIMUM,
      siteName: "  Lisbon Guide  ",
    })["@graph"];
    expect(organization.name).toBe("Lisbon Guide");
    expect(website.name).toBe("Lisbon Guide");
  });
});

/**
 * Two properties that fall out of parsing the base rather than trimming it, and
 * that are worth pinning down explicitly because a future "simplification" back
 * to string manipulation would quietly lose both.
 */
describe("publisherJsonLd: the base is parsed, not pasted", () => {
  const MINIMUM = { siteUrl: "https://guide.example.org", siteName: "Guide" };

  /**
   * Credentials in a URL are rare but they are exactly the sort of thing that
   * reaches a config value by accident, and the old string-trimming base
   * published them: `https://user:secret@guide.example.org/` became an `@id`
   * carrying `user:secret`, on every page of the site. An origin has no
   * userinfo, so parsing drops it.
   */
  test("never publishes credentials that arrive in the siteUrl", () => {
    const rendered = JSON.stringify(
      publisherJsonLd({
        ...MINIMUM,
        siteUrl: "https://user:secret@guide.example.org/",
      }),
    );
    expect(rendered).not.toContain("secret");
    expect(rendered).toContain("https://guide.example.org/#organization");
  });

  /**
   * `new URL` is happy to parse `javascript:` and `data:`. Neither is a website,
   * and putting either in `url` hands a live URI to anything that renders the
   * node as a link.
   */
  test.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "ftp://guide.example.org",
  ])("refuses a non-http(s) scheme (%j)", (bad) => {
    expect(() => publisherJsonLd({ ...MINIMUM, siteUrl: bad })).toThrow(
      /siteUrl/,
    );
  });

  test("keeps a non-default port, which is part of the origin", () => {
    const [organization] = publisherJsonLd({
      ...MINIMUM,
      siteUrl: "https://guide.example.org:8443/",
    })["@graph"];
    expect(organization.url).toBe("https://guide.example.org:8443");
  });
});

/**
 * The optional URLs were the last unguarded input. `siteUrl` is now parsed and
 * rejected if it is not absolute, but `repoUrl` and `authorUrl` were emitted
 * exactly as given — and dropping the scheme is the single most likely way to
 * mistype a repository URL.
 *
 * These are optional, so the failure mode is the opposite of `siteUrl`'s: there
 * is nothing structural to protect, and a claim that cannot be true is worse
 * than a claim that is absent. They are dropped, not thrown on.
 */
describe("publisherJsonLd: optional URLs that are not URLs", () => {
  const MINIMUM = { siteUrl: "https://guide.example.org", siteName: "Guide" };

  /**
   * A relative `sameAs` does not fail loudly, it resolves against the page it
   * was found on — so `git.example.org/maria/guide` becomes a claim that the
   * publisher is also findable at a path on *this* site, which is a 404.
   */
  test.each([
    "git.example.org/maria/guide",
    "/maria/guide",
    "not a url",
    "javascript:alert(1)",
  ])("omits sameAs when repoUrl is not an absolute http(s) URL (%j)", (bad) => {
    const [organization] = publisherJsonLd({ ...MINIMUM, repoUrl: bad })[
      "@graph"
    ];
    expect(organization).not.toHaveProperty("sameAs");
  });

  test.each(["maria.example.org", "/maria", "mailto:maria@example.org"])(
    "omits the founder's url when authorUrl is not an absolute http(s) URL (%j)",
    (bad) => {
      const [organization] = publisherJsonLd({
        ...MINIMUM,
        authorName: "Maria Sousa",
        authorUrl: bad,
      })["@graph"];
      expect(organization.founder).toEqual({
        "@type": "Person",
        name: "Maria Sousa",
      });
    },
  );

  /** A bad optional URL must not take the rest of the node down with it. */
  test("keeps the named founder when only the author's URL is unusable", () => {
    const [organization] = publisherJsonLd({
      ...MINIMUM,
      repoUrl: "nonsense",
      authorName: "Maria Sousa",
      authorUrl: "nonsense",
    })["@graph"];
    expect(organization.name).toBe("Guide");
    expect(organization.founder?.name).toBe("Maria Sousa");
  });

  test("still accepts a well-formed repoUrl and authorUrl", () => {
    const [organization] = publisherJsonLd({
      ...MINIMUM,
      repoUrl: "https://git.example.org/maria/guide",
      authorName: "Maria Sousa",
      authorUrl: "http://maria.example.org",
    })["@graph"];
    expect(organization.sameAs).toEqual([
      "https://git.example.org/maria/guide",
    ]);
    expect(organization.founder?.url).toBe("http://maria.example.org");
  });
});
