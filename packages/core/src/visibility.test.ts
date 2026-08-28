import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  citationsFrom,
  domainOf,
  isOurDomain,
  scoreProbe,
  selectProbes,
  summarise,
} from "./visibility";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/visibility/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

const SITE = "directory.pooyagolchian.com";

/**
 * Extracting citations is the whole measurement, and it runs against four
 * engines whose response shapes differ, are partly undocumented, and will
 * drift. Every case here is a shape a real engine returns.
 */
describe("citationsFrom", () => {
  test("reads perplexity's reference_links", () => {
    const urls = citationsFrom(fixture("perplexity_restaurants_dubai_marina"));
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("tripadvisor.com");
  });

  test("reads chatgpt's reference_links", () => {
    const urls = citationsFrom(fixture("chatgpt_pharmacies_deira_cited"));
    expect(urls).toContain(
      "https://directory.pooyagolchian.com/area/deira/pharmacies",
    );
  });

  test("reads google_ai_mode's top-level references", () => {
    const urls = citationsFrom(fixture("google_ai_mode_hotels_palm"));
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("booking.com");
  });

  test("reaches inside ai_overview, which nests everything one level down", () => {
    const urls = citationsFrom(fixture("google_ai_overview_dentists"));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("doctoruna.com");
  });

  /**
   * A response that cites nothing is a real outcome, not an error. Throwing
   * here would turn a paid response into a lost one — the CLI reports the count
   * of zero-citation probes instead, so a shape change shows up as a visible
   * anomaly rather than a crash or a silent zero.
   */
  test("returns an empty array rather than throwing when there are no sources", () => {
    expect(citationsFrom(fixture("perplexity_no_citations"))).toEqual([]);
  });

  test("survives junk without throwing", () => {
    for (const junk of [
      null,
      undefined,
      42,
      "a string",
      [],
      {},
      { reference_links: "nope" },
    ]) {
      expect(citationsFrom(junk)).toEqual([]);
    }
  });

  test("preserves citation order, because position is part of the measurement", () => {
    const urls = citationsFrom(fixture("chatgpt_pharmacies_deira_cited"));
    expect(urls[1]).toContain("directory.pooyagolchian.com");
  });
});

describe("domainOf", () => {
  test("strips scheme, www and path", () => {
    expect(
      domainOf("https://www.tripadvisor.com/Restaurants-g295424.html"),
    ).toBe("tripadvisor.com");
  });

  test("lowercases a shouted host", () => {
    expect(
      domainOf("HTTPS://WWW.Directory.PooyaGolchian.com/category/dentists/"),
    ).toBe("directory.pooyagolchian.com");
  });

  test("returns null for something that is not a URL", () => {
    expect(domainOf("not a url")).toBeNull();
    expect(domainOf("")).toBeNull();
  });
});

/**
 * The matching rule that decides every number this tool reports.
 */
describe("isOurDomain", () => {
  test("matches the exact host", () => {
    expect(
      isOurDomain("https://directory.pooyagolchian.com/area/deira", SITE),
    ).toBe(true);
  });

  test("matches through www and a trailing slash", () => {
    expect(isOurDomain("https://www.directory.pooyagolchian.com/", SITE)).toBe(
      true,
    );
  });

  /**
   * The apex is a different property with a different reason to exist, and
   * crediting the directory for a citation of the personal site would inflate
   * the one number this whole tool exists to report honestly.
   */
  test("does NOT match the parent domain", () => {
    expect(isOurDomain("https://pooyagolchian.com/blog/directory", SITE)).toBe(
      false,
    );
  });

  test("does NOT match a lookalike that merely ends with our name", () => {
    expect(
      isOurDomain("https://notdirectory.pooyagolchian.com.evil.test/", SITE),
    ).toBe(false);
  });

  test("does not throw on a malformed citation", () => {
    expect(isOurDomain("://////", SITE)).toBe(false);
  });
});

describe("scoreProbe", () => {
  const probe = { query: "pharmacies in deira", category: "Pharmacies" };

  test("records the 1-based position when cited", () => {
    const result = scoreProbe(
      probe,
      "chatgpt",
      citationsFrom(fixture("chatgpt_pharmacies_deira_cited")),
      SITE,
    );
    expect(result.cited).toBe(true);
    expect(result.position).toBe(2);
  });

  test("reports not-cited with a null position, not a zero", () => {
    // 0 would sort and average as if it were a rank. Null cannot be mistaken.
    const result = scoreProbe(
      probe,
      "perplexity",
      citationsFrom(fixture("perplexity_restaurants_dubai_marina")),
      SITE,
    );
    expect(result.cited).toBe(false);
    expect(result.position).toBeNull();
  });

  test("keeps the competitor domains, deduplicated and in order", () => {
    const result = scoreProbe(
      probe,
      "perplexity",
      citationsFrom(fixture("perplexity_restaurants_dubai_marina")),
      SITE,
    );
    expect(result.citations).toEqual([
      "tripadvisor.com",
      "timeoutdubai.com",
      "zomato.com",
    ]);
  });
});

describe("selectProbes", () => {
  const demand = [
    {
      category: "Restaurants",
      areasInDemand: ["marina"],
      suggestions: [
        { query: "restaurants in dubai mall", rank: 0 },
        { query: "restaurants in dubai marina", rank: 1, area: "marina" },
      ],
    },
    {
      category: "Gyms",
      areasInDemand: ["marina", "jlt", "deira"],
      suggestions: [
        { query: "gyms in dubai price", rank: 0 },
        { query: "gyms in dubai marina", rank: 1, area: "marina" },
      ],
    },
    {
      category: "Accounting",
      areasInDemand: [],
      suggestions: [
        { query: "accounting in dubai salary", rank: 0 },
        { query: "accounting in dubai jobs", rank: 1 },
      ],
    },
    { category: "Spas", areasInDemand: [], suggestions: [] },
  ];

  /**
   * The ordering signal is areasInDemand — the neighbourhoods people actually
   * attach to a category, measured by `pnpm demand`. It is the whole reason the
   * probe set is worth anything: a category people localise is a category this
   * directory's area x category pages compete for. Sorting by suggestion volume
   * instead collapsed to alphabetical (Google returns a near-constant number of
   * suggestions per seed) and led with "accounting in dubai salary" — a
   * job-seeker query no directory should be measured against.
   */
  test("leads with the category people localise most", () => {
    expect(selectProbes(demand, 2).map((p) => p.category)).toEqual([
      "Gyms",
      "Restaurants",
    ]);
  });

  test("prefers the most popular suggestion that names a neighbourhood", () => {
    // Not rank 0. "gyms in dubai price" is more popular but has no local
    // intent, and local intent is the thing being measured.
    expect(selectProbes(demand, 1)[0]?.query).toBe("gyms in dubai marina");
  });

  test("falls back to the most popular suggestion when none names an area", () => {
    const probes = selectProbes(demand, 4);
    expect(probes.find((p) => p.category === "Accounting")?.query).toBe(
      "accounting in dubai salary",
    );
  });

  test("skips a category with nothing to ask", () => {
    expect(selectProbes(demand, 10).map((p) => p.category)).not.toContain(
      "Spas",
    );
  });

  test("is deterministic, so two runs measure the same thing", () => {
    expect(selectProbes(demand, 3)).toEqual(selectProbes(demand, 3));
  });

  test("honours the limit", () => {
    expect(selectProbes(demand, 1)).toHaveLength(1);
  });

  test("works on a demand file that predates the areasInDemand field", () => {
    const legacy = [
      {
        category: "Hotels",
        suggestions: [{ query: "hotels in dubai", rank: 0 }],
      },
    ];
    expect(selectProbes(legacy, 1)[0]?.query).toBe("hotels in dubai");
  });
});

describe("summarise", () => {
  const results = [
    {
      query: "a",
      category: "A",
      engine: "chatgpt" as const,
      cited: true,
      position: 2,
      citations: ["timeoutdubai.com", "zomato.com"],
    },
    {
      query: "b",
      category: "B",
      engine: "chatgpt" as const,
      cited: false,
      position: null,
      citations: ["timeoutdubai.com"],
    },
    {
      query: "c",
      category: "C",
      engine: "perplexity" as const,
      cited: false,
      position: null,
      citations: [],
    },
  ];

  test("reports the citation rate over the whole probe set", () => {
    const s = summarise(results);
    expect(s.probes).toBe(3);
    expect(s.cited).toBe(1);
    expect(s.citationRate).toBeCloseTo(1 / 3);
  });

  test("breaks the rate down per engine, since they answer differently", () => {
    const s = summarise(results);
    expect(s.byEngine.chatgpt).toEqual({ probes: 2, cited: 1 });
    expect(s.byEngine.perplexity).toEqual({ probes: 1, cited: 0 });
  });

  /**
   * Share of voice is the half that is useful on day one, when our own number
   * is still zero: who owns these answers today.
   */
  test("ranks the domains that own the answers", () => {
    const s = summarise(results);
    expect(s.topDomains[0]).toMatchObject({
      domain: "timeoutdubai.com",
      citations: 2,
    });
  });

  test("counts a probe that returned nothing at all, so shape drift is visible", () => {
    expect(summarise(results).probesWithNoCitations).toBe(1);
  });

  test("does not divide by zero on an empty run", () => {
    const s = summarise([]);
    expect(s.citationRate).toBe(0);
    expect(s.topDomains).toEqual([]);
  });
});
