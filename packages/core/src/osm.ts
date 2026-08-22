/**
 * Reading OpenStreetMap into the shapes the toolkit already understands.
 *
 * Everything here is pure. Fetching from Nominatim and Overpass needs the
 * network and lives in `packages/pipeline/src/osm.ts`; deciding what a response
 * *means* does not, and that is where the failures worth catching live.
 *
 * The failures are quiet ones. A city whose name comes back only in Arabic
 * produces a config that rejects every listing the engine returns. A polygon
 * read in the wrong axis order produces a bounding box that matches nothing. An
 * Overpass count matched to the wrong tag buys the wrong search terms. None of
 * those announce themselves; all of them are only visible after the credits are
 * spent. So each one has a test with the real recorded response behind it.
 */
import { isSupportedCountry } from "libphonenumber-js/max";
import type { CountryCode } from "libphonenumber-js";
import { distanceKm } from "./tiles";
import type { GeoPoint } from "./tiles";
import type { BoundingBox, Density } from "./types";

// ---------------------------------------------------------------------------
// Nominatim
// ---------------------------------------------------------------------------

/** One city, resolved from a name to something crawlable. */
export interface ResolvedPlace {
  /** Best available Latin name, used for `CityConfig.name`. */
  name: string;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string;
  /** The same value, checked against libphonenumber rather than assumed. */
  phoneRegion: CountryCode;
  /** OSM areas come from relations and closed ways, and the two are numbered differently. */
  osmType: "relation" | "way";
  osmId: number;
  boundingBoxes: BoundingBox[];
  /** Everything the engine might call this city, lowercased. */
  names: string[];
}

/**
 * Douglas-Peucker threshold sent to Nominatim as `polygon_threshold`.
 *
 * A municipal boundary at full detail is ~290KB of coordinates; simplified it
 * is ~17KB. Bounding boxes here are a sanity check, not a filter — `isInCity`
 * uses the city name as its primary test — so a boundary accurate to a couple
 * of hundred metres is not merely sufficient, it is indistinguishable in
 * effect from one accurate to a metre.
 */
export const POLYGON_SIMPLIFY_DEG = 0.002;

/**
 * Every derived box is grown by exactly the simplification threshold.
 *
 * Douglas-Peucker guarantees the simplified ring stays within the threshold of
 * the original, so it can only ever cut a corner *inward*. Padding by the same
 * amount guarantees the box never excludes ground the true boundary included.
 * The direction matters and is not symmetric: a box that is slightly too large
 * costs nothing the city-name filter does not already catch, while one that is
 * slightly too small silently drops real businesses at the edge of town.
 */
export const BOX_PADDING_DEG = POLYGON_SIMPLIFY_DEG;

/**
 * Above this many polygons, per-polygon boxes stop being worth reading and
 * collapse to the single overall bounding box.
 *
 * A readability threshold, not a measurement — do not quote it as a finding.
 * The case it exists for is real: Nominatim's Lisbon *district* boundary is a
 * MultiPolygon of 39 pieces, 38 of them four-point slivers for rocks and
 * islets. Collapsing is the safe direction, because `isInCity` matches if ANY
 * box contains the point, so one large box is strictly more permissive.
 */
export const MAX_BOUNDING_BOXES = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True once the string carries something `toSlug` and the engine can both use. */
function hasLatin(value: string): boolean {
  return /[a-z]/.test(value.toLowerCase());
}

function padded(box: BoundingBox): BoundingBox {
  return {
    minLat: box.minLat - BOX_PADDING_DEG,
    maxLat: box.maxLat + BOX_PADDING_DEG,
    minLng: box.minLng - BOX_PADDING_DEG,
    maxLng: box.maxLng + BOX_PADDING_DEG,
  };
}

/** Bounding box of one GeoJSON linear ring, or null if it is degenerate. */
function bboxOfRing(ring: unknown): BoundingBox | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const point of ring) {
    // GeoJSON is [longitude, latitude] — the opposite order to Nominatim's
    // `boundingbox` array, and to every other coordinate in this repository.
    if (!Array.isArray(point) || point.length < 2) continue;
    const lng = point[0];
    const lat = point[1];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  if (!Number.isFinite(minLat) || minLat === maxLat || minLng === maxLng) {
    return null;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Turn a boundary polygon into the bounding boxes a city config carries.
 *
 * A MultiPolygon yields one box per piece, which is how Dubai's detached Hatta
 * exclave — added by hand to `data/cities/dubai.json` — is recovered from open
 * data. Anything the polygon cannot supply falls back to the overall box
 * Nominatim already returned, unpadded, because that one was never simplified.
 */
export function boundingBoxesFrom(
  geojson: unknown,
  fallback: BoundingBox,
): BoundingBox[] {
  if (!isRecord(geojson)) return [fallback];
  const coordinates = geojson.coordinates;

  let polygons: unknown[];
  if (geojson.type === "MultiPolygon" && Array.isArray(coordinates)) {
    polygons = coordinates;
  } else if (geojson.type === "Polygon" && Array.isArray(coordinates)) {
    polygons = [coordinates];
  } else {
    return [fallback];
  }

  // Outer ring only. Holes describe ground inside the boundary that is not
  // part of it, which cannot widen a box and so cannot change the answer.
  const boxes = polygons
    .map((polygon) => (Array.isArray(polygon) ? bboxOfRing(polygon[0]) : null))
    .filter((box): box is BoundingBox => box !== null)
    .map(padded);

  if (boxes.length === 0 || boxes.length > MAX_BOUNDING_BOXES)
    return [fallback];
  return boxes;
}

function quadToBox(value: unknown): BoundingBox | null {
  // Nominatim returns [minLat, maxLat, minLon, maxLon] — as strings.
  if (!Array.isArray(value) || value.length < 4) return null;
  const [minLat, maxLat, minLng, maxLng] = value.map(Number);
  if (![minLat, maxLat, minLng, maxLng].every((n) => Number.isFinite(n))) {
    return null;
  }
  if (minLat! >= maxLat! || minLng! >= maxLng!) return null;
  return {
    minLat: minLat!,
    maxLat: maxLat!,
    minLng: minLng!,
    maxLng: maxLng!,
  };
}

/**
 * Resolve a Nominatim search response to one crawlable place.
 *
 * Relations and closed ways are accepted because both become OSM areas; a
 * `node` is rejected outright. A node result is a labelled point with no
 * boundary, and Nominatim ranks one above the real relation often enough that
 * this is a live case rather than a defensive one — searching "Dubai" returns
 * `node/31248510` second, ahead of the emirate's own boundary.
 */
export function parseNominatimPlace(
  json: unknown,
  query: string,
): ResolvedPlace {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error(
      `OpenStreetMap has no place matching ${JSON.stringify(query)}. ` +
        `Try the local spelling, or add the country — "Lisbon, Portugal".`,
    );
  }

  const areas = json
    .filter(isRecord)
    .filter((r) => r.osm_type === "relation" || r.osm_type === "way");

  if (areas.length === 0) {
    const kinds = [...new Set(json.filter(isRecord).map((r) => r.osm_type))];
    throw new Error(
      `OpenStreetMap returned no boundary for ${JSON.stringify(query)} — ` +
        `only ${kinds.join(", ")}. A point has no area to tile, so there is ` +
        `nothing to crawl. Try a more specific name.`,
    );
  }

  // Nominatim orders by its own importance score, so the first area is the
  // one a person searching that word almost always meant.
  const best = areas[0]!;
  const address = isRecord(best.address) ? best.address : {};
  const namedetails = isRecord(best.namedetails) ? best.namedetails : {};

  const rawCountry = address.country_code;
  const countryCode =
    typeof rawCountry === "string" ? rawCountry.toUpperCase() : "";
  if (!isSupportedCountry(countryCode)) {
    throw new Error(
      `${JSON.stringify(query)} resolved to country code ${JSON.stringify(countryCode)}, ` +
        `which libphonenumber does not recognise. Every phone number in the ` +
        `crawl would fail to normalise.`,
    );
  }

  // Order matters: the Latin form leads, because it is what CityConfig.name
  // shows and what toSlug can actually turn into a URL.
  const candidates = [
    namedetails["name:en"],
    namedetails.int_name,
    best.name,
    address.city,
    address.town,
    address.municipality,
  ]
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.trim())
    .filter((n) => n !== "");

  // The display name keeps OpenStreetMap's own capitalisation. An earlier
  // version lowercased everything and title-cased it back for display, which
  // silently rewrote "Rio de Janeiro" as "Rio De Janeiro", "Washington, D.C."
  // as "Washington, D.c." and "DIFC" as "Difc" — mangling data that arrived
  // correct, in the one field a reader sees. Casing is only flattened for
  // `names`, where isInCity lowercases both sides anyway.
  const display = candidates.find(hasLatin);
  const names = [...new Set(candidates.map((n) => n.toLowerCase()))];

  if (!display) {
    throw new Error(
      `${JSON.stringify(query)} has no Latin name in OpenStreetMap (found ` +
        `${names.map((n) => JSON.stringify(n)).join(", ") || "nothing"}). The ` +
        `engine returns city names in Latin script, so isInCity would reject ` +
        `every listing and the crawl would look like an honest empty result. ` +
        `Add a name:en tag to the OSM boundary, or write the config by hand.`,
    );
  }

  const fallback = quadToBox(best.boundingbox);
  if (!fallback) {
    throw new Error(
      `${JSON.stringify(query)} came back without a usable bounding box.`,
    );
  }

  return {
    name: display,
    countryCode,
    phoneRegion: countryCode as CountryCode,
    osmType: best.osm_type as "relation" | "way",
    osmId: Number(best.osm_id),
    boundingBoxes: boundingBoxesFrom(best.geojson, fallback),
    names,
  };
}

// ---------------------------------------------------------------------------
// Overpass
// ---------------------------------------------------------------------------

/** A locally-named neighbourhood point, before spacing decides if it survives. */
export interface OsmPlaceNode {
  id: number;
  lat: number;
  lng: number;
  /** Latin where OSM offers one; `name:en` beats the local script. */
  name: string;
  /** `suburb`, `quarter`, `neighbourhood`, `borough`, `city_block`. */
  place: string;
}

/** A business-ish node, reduced to the only thing that gets counted. */
export interface OsmPoi {
  lat: number;
  lng: number;
}

function elementsOf(json: unknown): Record<string, unknown>[] {
  if (!isRecord(json) || !Array.isArray(json.elements)) {
    throw new Error(
      `Overpass response has no "elements" array. A 200 from Overpass can ` +
        `still be an HTML error page, so this is a real case, not a guard.`,
    );
  }
  return json.elements.filter(isRecord);
}

/**
 * Read the candidate tile centres.
 *
 * Roughly half of Dubai's 321 place nodes are named only in Arabic in `name`
 * and carry the Latin form in `name:en`. `toSlug` drops Arabic rather than
 * transliterating it, so without the `name:en` preference every one of them
 * would collapse to the same slug stem and the tile ids would be meaningless.
 *
 * Sorted by id so a regenerated config diffs cleanly rather than churning on
 * whatever order Overpass happened to return.
 */
export function parseOverpassPlaces(json: unknown): OsmPlaceNode[] {
  const nodes: OsmPlaceNode[] = [];

  for (const el of elementsOf(json)) {
    if (el.type !== "node") continue;
    const tags = isRecord(el.tags) ? el.tags : {};
    const place = tags.place;
    if (typeof place !== "string") continue;

    const name = [tags["name:en"], tags.int_name, tags.name].find(
      (n): n is string => typeof n === "string" && n.trim() !== "",
    );
    if (!name) continue;

    const lat = el.lat;
    const lng = el.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    nodes.push({ id: Number(el.id), lat, lng, name: name.trim(), place });
  }

  return nodes.sort((a, b) => a.id - b.id);
}

/**
 * Read the POI skeletons that density is counted from.
 *
 * `out skel qt` returns id and coordinates and nothing else, which is the whole
 * point: one bulk fetch over the city replaces one Overpass request per
 * candidate centre — sixty-odd requests to a free public service, per city.
 */
export function parseOverpassPois(json: unknown): OsmPoi[] {
  const pois: OsmPoi[] = [];
  for (const el of elementsOf(json)) {
    const lat = el.lat;
    const lng = el.lon;
    if (typeof lat === "number" && typeof lng === "number") {
      pois.push({ lat, lng });
    }
  }
  return pois;
}

/**
 * Count the businesses around a candidate centre.
 *
 * Inclusive at the boundary, matching `classifyDensity`: of the two ways to be
 * wrong on a threshold, under-crawling a real centre is the one you cannot
 * detect afterwards, because the businesses simply are not in the output.
 */
export function countNearby(
  centre: GeoPoint,
  pois: readonly OsmPoi[],
  radiusKm: number,
): number {
  let n = 0;
  for (const poi of pois) {
    if (distanceKm(centre, poi) <= radiusKm) n++;
  }
  return n;
}

/**
 * Pair a batched `out count` response back onto the tags that produced it.
 *
 * Every count element comes back as `{type:"count", id:0}` carrying only
 * totals — nothing in the response says which statement produced it. **Query
 * order is the entire mapping.** A length mismatch is therefore an error and
 * never a zip that silently truncates: a quiet off-by-one here would buy a
 * city the wrong search terms, at one credit per request, with nothing to show
 * that anything went wrong.
 */
export function parseOverpassCounts(
  json: unknown,
  tags: readonly string[],
): Record<string, number> {
  const counts = elementsOf(json).filter((el) => el.type === "count");

  if (counts.length !== tags.length) {
    throw new Error(
      `Overpass returned ${counts.length} counts for ${tags.length} tags. ` +
        `Counts are matched to tags by position and nothing else, so a ` +
        `mismatch cannot be reconciled — it would silently assign every ` +
        `category after the gap to the wrong search term.`,
    );
  }

  const out: Record<string, number> = {};
  counts.forEach((el, i) => {
    const tagBag = isRecord(el.tags) ? el.tags : {};
    const total = Number(tagBag.total);
    out[tags[i]!] = Number.isFinite(total) ? total : 0;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/**
 * Zoom per density, from `data/cities/_template.json`. Higher is a smaller area.
 *
 * The hand-tuned Dubai config does not follow this and never claimed to: it
 * uses zoom 14 for ten medium tiles and 15 for eight others, 13 for five sparse
 * tiles and 14 for six. That disagreement is real, and `pnpm cities calibrate`
 * reports it rather than fitting it away — the same discipline `SPACING_FLOORS`
 * follows. The generator may differ from a human; it may not hide that it did.
 */
export const ZOOM_FOR_DENSITY: Record<Density, number> = {
  dense: 15,
  medium: 14,
  sparse: 13,
};

/**
 * Turn a neighbourhood name into a tile id, resolving collisions.
 *
 * Two things make this stricter than `toSlug`. A tile id must be unique or
 * `parseCityConfig` refuses the whole config, so a collision is resolved here
 * with a counter rather than the hash suffix `toSlug` uses. And a name with no
 * Latin characters is rejected outright instead of becoming an opaque hash,
 * because under ADR 0011 a tile id is simultaneously a browse facet and an
 * indexed `/area/` URL — `/area/business-1a2b3c` is worse than a failure
 * somebody can fix by adding a `name:en` tag upstream.
 */
export function tileIdFrom(name: string, taken: Set<string>): string {
  const base = name
    .normalize("NFKD")
    // Strip combining marks so "Pedrouços" folds to "pedroucos".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (base === "" || !/[a-z0-9]/.test(base)) {
    throw new Error(
      `Tile name ${JSON.stringify(name)} has no Latin characters, so it ` +
        `cannot become a readable URL slug. Add a name:en tag to the OSM ` +
        `node, or drop the tile.`,
    );
  }

  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  // Deterministic: the same input order always yields the same suffix, which
  // is what lets a regenerated config diff cleanly.
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
