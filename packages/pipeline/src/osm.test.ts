import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  OVERPASS_AREA_OFFSET,
  cacheKey,
  categoryCountsQuery,
  createOsmClient,
  isOverpassJson,
  placesQuery,
  poisQuery,
} from "./osm";

const BOX = { minLat: 25.19, maxLat: 25.28, minLng: 55.26, maxLng: 55.34 };
const HATTA = { minLat: 24.73, maxLat: 24.87, minLng: 56.06, maxLng: 56.21 };
const DUBAI = { osmType: "relation" as const, osmId: 4479752 };

/** A client that records what it was asked and answers from a script. */
function fakeClient(
  bodies: string[] | (() => Response),
  onCall?: (url: string, init?: RequestInit) => void,
) {
  let i = 0;
  return createOsmClient({
    cacheDir: null,
    sleep: async () => {},
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      onCall?.(String(url), init);
      if (typeof bodies === "function") return bodies();
      return new Response(bodies[Math.min(i++, bodies.length - 1)], {
        status: 200,
      });
    }) as unknown as typeof fetch,
  });
}

describe("placesQuery", () => {
  test("turns a relation id into an Overpass area id", () => {
    // Areas are the OSM id plus a per-type offset. Get it wrong and Overpass
    // returns an empty element list, which is indistinguishable from a city
    // whose neighbourhoods nobody has mapped.
    expect(placesQuery(DUBAI)).toContain(
      String(4479752 + OVERPASS_AREA_OFFSET.relation),
    );
  });

  test("uses the way offset for a city mapped as a closed way", () => {
    expect(placesQuery({ osmType: "way", osmId: 12345 })).toContain(
      String(12345 + OVERPASS_AREA_OFFSET.way),
    );
  });

  test("asks only for neighbourhood-scale place types", () => {
    const q = placesQuery(DUBAI);
    expect(q).toMatch(/suburb/);
    expect(q).toMatch(/neighbourhood/);
    expect(q).toMatch(/quarter/);
  });

  test("requires a name, since an unnamed centre cannot become a tile id", () => {
    expect(placesQuery(DUBAI)).toContain('["name"]');
  });
});

describe("poisQuery", () => {
  test("asks for skeletons, because only coordinates are ever counted", () => {
    // out skel drops tags, which is most of the payload: the recorded central
    // Dubai response is 23,829 nodes at 2MB even without them.
    expect(poisQuery([BOX])).toContain("out skel qt");
  });

  test("covers every bounding box the city has", () => {
    // Three POI families across two boxes. Dubai's second box is Hatta, and a
    // query that skipped it would call the exclave empty.
    expect(poisQuery([BOX, HATTA]).match(/node\(/g)).toHaveLength(6);
  });

  test("writes the box in Overpass order, which is south,west,north,east", () => {
    expect(poisQuery([BOX])).toContain("25.19,55.26,25.28,55.34");
  });
});

describe("categoryCountsQuery", () => {
  test("emits one out count per tag, in the order given", () => {
    // Counts come back as {type:"count", id:0} with nothing naming the tag, so
    // position is the only key. Query order and parse order are one list.
    const q = categoryCountsQuery([BOX], ["amenity=pharmacy", "shop=laundry"]);
    expect(q.match(/out count;/g)).toHaveLength(2);
    expect(q.indexOf("pharmacy")).toBeLessThan(q.indexOf("laundry"));
  });

  test("unions the boxes, because consecutive statements count only the last", () => {
    // This replaces a test that asserted the same two counts of `node(` and
    // `out count;` and passed while the behaviour was wrong. In Overpass QL a
    // bare statement REPLACES the default result set, so
    // `node(A); node(B); out count;` reports B alone.
    //
    // Measured live on 2026-08-22 with amenity=pharmacy over these two boxes:
    //   box A alone .................. 156
    //   box B alone (Hatta) .......... 1
    //   consecutive statements ....... 1     <- what shipped
    //   wrapped in a union ........... 157   <- correct
    //
    // So this asserts the bracket, which is the thing that carries the meaning.
    const lines = categoryCountsQuery([BOX, HATTA], ["amenity=bank"])
      .split("\n")
      .map((l) => l.trim());
    expect(lines.filter((l) => l === "out count;")).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("node("))).toHaveLength(2);
    // The two node statements sit inside a union, and the union closes
    // immediately before the count.
    expect(lines[1]).toBe("(");
    expect(lines[lines.indexOf("out count;") - 1]).toBe(");");
  });

  test("unions even a single box, so one box and many behave identically", () => {
    const lines = categoryCountsQuery([BOX], ["amenity=bank"])
      .split("\n")
      .map((l) => l.trim());
    expect(lines[1]).toBe("(");
    expect(lines[3]).toBe(");");
    expect(lines[4]).toBe("out count;");
  });

  test("refuses a tag that is not tag=value rather than building bad syntax", () => {
    expect(() => categoryCountsQuery([BOX], ["pharmacy"])).toThrow(/pharmacy/);
  });
});

describe("isOverpassJson", () => {
  test("accepts a real response", () => {
    expect(isOverpassJson('{"version":0.6,"elements":[]}')).toBe(true);
  });

  test("rejects the HTML error page Overpass serves with a 200", () => {
    // Recorded live on 2026-08-22: "runtime error: ... The server is probably
    // too busy to handle your request." — HTTP 200, Content-Type text/html.
    // Parsing that as JSON throws a SyntaxError a long way from its cause.
    expect(
      isOverpassJson('<?xml version="1.0"?>\n<html><body>Error</body></html>'),
    ).toBe(false);
  });
});

describe("createOsmClient", () => {
  test("identifies itself, which Nominatim's policy requires", async () => {
    let headers: Headers | undefined;
    const client = fakeClient(["[]"], (_u, init) => {
      headers = new Headers(init?.headers);
    });
    await client.resolvePlace("Lisbon");
    expect(headers?.get("user-agent")).toMatch(/business-directory-toolkit/);
  });

  test("simplifies the boundary it asks for", async () => {
    let url = "";
    const client = fakeClient(["[]"], (u) => {
      url = u;
    });
    await client.resolvePlace("Lisbon");
    expect(url).toContain("polygon_threshold=0.002");
    expect(url).toContain("namedetails=1");
  });

  test("waits between requests rather than hammering a free service", async () => {
    const waits: number[] = [];
    const client = createOsmClient({
      cacheDir: null,
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetchImpl: (async () => new Response("[]", { status: 200 })) as never,
    });
    await client.resolvePlace("Lisbon");
    await client.resolvePlace("Porto");
    expect(waits.some((w) => w >= 1000)).toBe(true);
  });

  test("names the service, the status and the stage when a request fails", async () => {
    const client = fakeClient(() => new Response("nope", { status: 429 }));
    await expect(client.resolvePlace("Lisbon")).rejects.toThrow(
      /Nominatim.*429/s,
    );
  });

  test("treats a 200 with an HTML body as a failure, not as data", async () => {
    const client = fakeClient(
      () => new Response("<html>Error: too busy</html>", { status: 200 }),
    );
    await expect(client.pois([BOX])).rejects.toThrow(/busy|HTML|not JSON/i);
  });
});

describe("the disk cache", () => {
  const dir = new URL(
    `./osm-cache-test-${process.pid}/`,
    pathToFileURL(`${tmpdir()}/`),
  );
  beforeEach(() => {
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("serves a hit without touching the network", async () => {
    const key = cacheKey("places", placesQuery(DUBAI));
    writeFileSync(
      new URL(`${key}.json`, dir),
      '{"elements":[{"cached":true}]}',
    );
    let calls = 0;
    const client = createOsmClient({
      cacheDir: dir,
      sleep: async () => {},
      fetchImpl: (async () => {
        calls++;
        return new Response("{}", { status: 200 });
      }) as never,
    });
    expect(await client.places(DUBAI)).toEqual({
      elements: [{ cached: true }],
    });
    expect(calls).toBe(0);
  });

  test("treats a truncated cache file as a miss, not as a fatal error", async () => {
    // Writes are not atomic, so an interrupted run leaves a half-written file.
    // Parsing it threw a SyntaxError on every subsequent run, with nothing
    // naming the cache and no way out but deleting the directory by hand.
    const key = cacheKey("places", placesQuery(DUBAI));
    writeFileSync(new URL(`${key}.json`, dir), '{"elements":[{"id":1');
    const client = createOsmClient({
      cacheDir: dir,
      sleep: async () => {},
      fetchImpl: (async () =>
        new Response('{"elements":[{"fresh":true}]}', {
          status: 200,
        })) as never,
    });
    expect(await client.places(DUBAI)).toEqual({ elements: [{ fresh: true }] });
  });

  test("never caches a body it refused to accept", async () => {
    // Overpass serves "too busy" as HTML with a 200. Caching that would make a
    // transient outage permanent for every later run.
    const client = createOsmClient({
      cacheDir: dir,
      sleep: async () => {},
      fetchImpl: (async () =>
        new Response("<html>Error: too busy</html>", { status: 200 })) as never,
    });
    await expect(client.pois([BOX])).rejects.toThrow();
    expect(readdirSync(dir)).toHaveLength(0);
  });
});

describe("cacheKey", () => {
  test("is stable for the same request", () => {
    expect(cacheKey("pois", "abc")).toBe(cacheKey("pois", "abc"));
  });

  test("separates different requests of the same kind", () => {
    expect(cacheKey("pois", "abc")).not.toBe(cacheKey("pois", "abd"));
  });

  test("separates different kinds of the same body", () => {
    expect(cacheKey("pois", "abc")).not.toBe(cacheKey("places", "abc"));
  });

  test("is filesystem-safe, because it becomes a filename", () => {
    expect(cacheKey("pois", "a/b?c=d&e")).toMatch(/^[a-z0-9-]+$/);
  });
});
