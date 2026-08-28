/**
 * The network half of the city generator.
 *
 * Nothing here spends a SearchApi credit: OpenStreetMap is openly licensed and
 * both services are free. That is the whole reason a worldwide registry is
 * possible at all — see docs/adr/0014-generate-the-city-registry.md.
 *
 * A city costs **four upstream requests**: one Nominatim resolve, then three
 * Overpass queries for neighbourhood centres, POI skeletons and category
 * counts. The design note originally called for one Overpass count per
 * candidate centre, which is sixty-odd requests per city to a free public
 * service; counting POIs locally from one bulk fetch gives identical numbers
 * for one request, and batching every category into a single multi-`out count`
 * query does the same for the category pass.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { BoundingBox } from "@directory/core";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";

/**
 * Nominatim's usage policy is at most one request per second and a User-Agent
 * that identifies the application. Both are conditions of use rather than
 * suggestions, and a generator meant to be pointed at a hundred cities is
 * exactly the client the policy exists to restrain. 1.1s buys margin against
 * clock jitter.
 */
const NOMINATIM_MIN_INTERVAL_MS = 1_100;

/**
 * Overpass publishes no fixed rate, but it is free, heavily loaded, and will
 * refuse work when busy. Requests are serialised and spaced regardless.
 */
const OVERPASS_MIN_INTERVAL_MS = 2_000;

const USER_AGENT =
  "business-directory-toolkit/0.1.0 (https://github.com/pooyagolchian/business-directory-toolkit)";

/** Matches `POLYGON_SIMPLIFY_DEG` in packages/core/src/osm.ts. */
const POLYGON_THRESHOLD = 0.002;

/** Overpass timeout, in seconds. A city-wide POI sweep genuinely needs this. */
const OVERPASS_TIMEOUT_S = 250;

/** Wall-clock ceiling per request, comfortably above the Overpass timeout. */
const REQUEST_TIMEOUT_MS = 280_000;

/**
 * OSM ids become Overpass area ids by adding a per-type offset. A wrong offset
 * silently returns nothing, which reads downstream as "nobody has mapped this
 * city" — so both values are asserted in tests.
 */
export const OVERPASS_AREA_OFFSET = {
  relation: 3_600_000_000,
  way: 2_400_000_000,
} as const;

/** POI families that stand in for "a business" when measuring density. */
const POI_TAGS = ["shop", "amenity", "office"] as const;

/** Place types that are neighbourhood-scale, and so make sensible tile centres. */
const PLACE_TYPES = [
  "suburb",
  "quarter",
  "neighbourhood",
  "borough",
  "city_block",
] as const;

export interface AreaRef {
  osmType: "relation" | "way";
  osmId: number;
}

/** Overpass writes a box as south,west,north,east. */
function bbox(box: BoundingBox): string {
  return `${box.minLat},${box.minLng},${box.maxLat},${box.maxLng}`;
}

export function placesQuery(area: AreaRef): string {
  const areaId = area.osmId + OVERPASS_AREA_OFFSET[area.osmType];
  return [
    `[out:json][timeout:${OVERPASS_TIMEOUT_S}];`,
    `area(${areaId})->.city;`,
    `node(area.city)["place"~"^(${PLACE_TYPES.join("|")})$"]["name"];`,
    `out body qt;`,
  ].join("\n");
}

export function poisQuery(boxes: readonly BoundingBox[]): string {
  const lines = [`[out:json][timeout:${OVERPASS_TIMEOUT_S}];`, `(`];
  for (const box of boxes) {
    for (const tag of POI_TAGS) lines.push(`  node(${bbox(box)})["${tag}"];`);
  }
  lines.push(`);`, `out skel qt;`);
  return lines.join("\n");
}

const TAG_PATTERN = /^[a-z_]+=[a-z0-9_:]+$/;

/**
 * One `out count` per tag, summed across all of the city's boxes.
 *
 * **The union brackets are load-bearing.** In Overpass QL a bare statement
 * replaces the default result set, so `node(A)[...]; node(B)[...]; out count;`
 * counts only B. Measured against the live API on 2026-08-22 with
 * `amenity=pharmacy`: box A alone 156, box B alone 1, the two as consecutive
 * statements **1**, the two inside a union **157**.
 *
 * The bug was invisible from the outside. The generator currently passes a
 * single box, so nothing misbehaved, and the test asserting that this "counts a
 * tag across all of the city's boxes" only checked how many `node(` and
 * `out count;` fragments the string contained — it never checked what Overpass
 * would do with them, and it passed throughout.
 *
 * Order is the other contract: `parseOverpassCounts` matches results back to
 * tags by position and by nothing else.
 */
export function categoryCountsQuery(
  boxes: readonly BoundingBox[],
  tags: readonly string[],
): string {
  const lines = [`[out:json][timeout:${OVERPASS_TIMEOUT_S}];`];
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag)) {
      throw new Error(
        `Category tag ${JSON.stringify(tag)} is not an OSM tag=value pair; ` +
          `it would be built into invalid Overpass syntax.`,
      );
    }
    const [key, value] = tag.split("=", 2);
    lines.push(`(`);
    for (const box of boxes) {
      lines.push(`  node(${bbox(box)})["${key}"="${value}"];`);
    }
    lines.push(`);`, `out count;`);
  }
  return lines.join("\n");
}

/**
 * Overpass answers "server too busy" with **HTTP 200 and an HTML body**.
 * Recorded live on 2026-08-22. Trusting the status code and handing the body
 * to JSON.parse produces a SyntaxError a long way from its cause, so the body
 * is sniffed before it is parsed.
 */
export function isOverpassJson(body: string): boolean {
  return body.trimStart().startsWith("{");
}

/** FNV-1a, the same shape as toSlug's — stable across Node versions, so an
 * upgrade does not silently re-hit a free service for everything it has. */
export function cacheKey(kind: string, body: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${h.toString(36)}`;
}

export interface OsmClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** `null` disables caching, which is what the tests use. */
  cacheDir?: URL | null;
  userAgent?: string;
  /** Called with each cache hit or miss, for the CLI's progress output. */
  onRequest?: (kind: string, cached: boolean) => void;
}

export interface OsmClient {
  resolvePlace(name: string): Promise<unknown>;
  places(area: AreaRef): Promise<unknown>;
  pois(boxes: readonly BoundingBox[]): Promise<unknown>;
  categoryCounts(
    boxes: readonly BoundingBox[],
    tags: readonly string[],
  ): Promise<unknown>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultCacheDir(): URL {
  return new URL("../../../data/osm-cache/", import.meta.url);
}

export function createOsmClient(options: OsmClientOptions = {}): OsmClient {
  const {
    fetchImpl = fetch,
    sleep = defaultSleep,
    cacheDir = defaultCacheDir(),
    userAgent = USER_AGENT,
    onRequest,
  } = options;

  const lastCall: Record<string, number> = {};
  // Every request runs through one chain, so nothing overlaps by accident —
  // parallelism here would be a policy violation, not an optimisation.
  let queue: Promise<unknown> = Promise.resolve();

  function readCache(key: string): unknown | undefined {
    if (!cacheDir) return undefined;
    let raw: string;
    try {
      raw = readFileSync(new URL(`${key}.json`, cacheDir), "utf8");
    } catch {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      // Writes are not atomic, so an interrupted run leaves a truncated file.
      // Treating that as a miss costs one free request; treating it as data
      // threw a SyntaxError on every subsequent run, with nothing pointing at
      // the cache and no way out but deleting the directory by hand.
      return undefined;
    }
  }

  function writeCache(key: string, body: string): void {
    if (!cacheDir) return;
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(new URL(`${key}.json`, cacheDir), body);
    } catch {
      // A cache that cannot be written is slower, never wrong. Never fatal.
    }
  }

  async function throttle(host: string, minIntervalMs: number): Promise<void> {
    const since = Date.now() - (lastCall[host] ?? 0);
    if (since < minIntervalMs) await sleep(minIntervalMs - since);
    lastCall[host] = Date.now();
  }

  async function request(
    kind: string,
    service: "Nominatim" | "Overpass",
    url: string,
    init: RequestInit,
    cacheBody: string,
  ): Promise<unknown> {
    const key = cacheKey(kind, cacheBody);
    const cached = readCache(key);
    if (cached !== undefined) {
      onRequest?.(kind, true);
      return cached;
    }

    const run = async (): Promise<unknown> => {
      await throttle(
        service,
        service === "Nominatim"
          ? NOMINATIM_MIN_INTERVAL_MS
          : OVERPASS_MIN_INTERVAL_MS,
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, {
          ...init,
          headers: { "User-Agent": userAgent, ...(init.headers ?? {}) },
          signal: controller.signal,
        });
        const body = await response.text();

        if (!response.ok) {
          throw new Error(
            `${service} ${response.status} for ${kind}. ` +
              (response.status === 429
                ? `The public instance is rate-limited; wait a few minutes.`
                : `Body: ${body.slice(0, 200)}`),
          );
        }
        // A 200 is not proof of success: Overpass serves "server too busy" as
        // HTML with a 200. Parsing it would throw far from the real cause.
        if (!isOverpassJson(body)) {
          const isArray = body.trimStart().startsWith("[");
          if (!isArray) {
            throw new Error(
              `${service} returned 200 but the body is not JSON for ${kind} — ` +
                `almost always "the server is probably too busy". Retry in a ` +
                `few minutes; the cache means nothing already fetched is lost.`,
            );
          }
        }

        writeCache(key, body);
        onRequest?.(kind, false);
        return JSON.parse(body);
      } finally {
        clearTimeout(timer);
      }
    };

    queue = queue.then(run, run);
    return queue;
  }

  return {
    resolvePlace(name) {
      const url = new URL(NOMINATIM);
      url.searchParams.set("q", name);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "3");
      url.searchParams.set("polygon_geojson", "1");
      // Simplified on the wire: a full municipal boundary is ~290KB of
      // coordinates for a box that only needs to be right to a few hundred
      // metres. core's BOX_PADDING_DEG compensates in the safe direction.
      url.searchParams.set("polygon_threshold", String(POLYGON_THRESHOLD));
      url.searchParams.set("addressdetails", "1");
      // Without namedetails there is no name:en, and a city whose OSM name is
      // in a non-Latin script produces a config that matches no listing.
      url.searchParams.set("namedetails", "1");
      return request(
        "nominatim",
        "Nominatim",
        url.toString(),
        {},
        url.toString(),
      );
    },

    places(area) {
      const body = placesQuery(area);
      return request("places", "Overpass", OVERPASS, overpassInit(body), body);
    },

    pois(boxes) {
      const body = poisQuery(boxes);
      return request("pois", "Overpass", OVERPASS, overpassInit(body), body);
    },

    categoryCounts(boxes, tags) {
      const body = categoryCountsQuery(boxes, tags);
      return request("counts", "Overpass", OVERPASS, overpassInit(body), body);
    },
  };
}

function overpassInit(query: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }).toString(),
  };
}
