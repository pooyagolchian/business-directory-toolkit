/**
 * Generating a whole city config from OpenStreetMap.
 *
 * Six stages, four upstream requests, zero SearchApi credits. The output is a
 * `data/cities/<id>.json` that `loadCity` accepts and `pnpm crawl` can run —
 * except that nobody has run it, which is exactly what the `verification`
 * block says. See docs/adr/0014-generate-the-city-registry.md.
 */
import {
  DENSITY_MEASUREMENT_RADIUS_KM,
  ZOOM_FOR_DENSITY,
  assignDensityByRank,
  countNearby,
  deriveCategories,
  parseCityConfig,
  parseNominatimPlace,
  parseOverpassCounts,
  parseOverpassPlaces,
  parseOverpassPois,
  spaceOut,
  tileIdFrom,
} from "@directory/core";
import type {
  BoundingBox,
  CategoryMap,
  CityConfig,
  CityTile,
  Density,
  TileCandidate,
} from "@directory/core";
import { fitToBudget, tilesAffordable } from "./plan";
import type { OsmClient } from "./osm";

/** Written into `verification.generator`, so a bad batch is traceable. */
export const GENERATOR_VERSION = "0.1.0";

/**
 * Below this many surviving centres the generator refuses rather than tiling
 * thinly.
 *
 * OSM `place=*` coverage is excellent in Western Europe and thin in parts of
 * the Gulf and sub-Saharan Africa (ADR 0014). Where it is thin, the honest
 * outcome is an error naming the city — not a config that crawls four points
 * and calls it a city, and not a fabricated grid.
 */
export const MIN_CANDIDATE_TILES = 5;

/**
 * Radius for the POI count that decides a centre's density.
 *
 * Measured, not assumed — see `DENSITY_MEASUREMENT_RADIUS_KM` in
 * packages/core/src/tiles.ts for the sweep that chose it and the 80% agreement
 * it buys against Dubai's 44 hand-placed tiles.
 */
export const DENSITY_RADIUS_KM = DENSITY_MEASUREMENT_RADIUS_KM;

/**
 * How many of the busiest tiles define the area the category mix is measured
 * over.
 *
 * Not an optimisation — the whole-city version does not work. Counting 98 tags
 * across Dubai's full boundary returns **HTTP 504** from the public Overpass
 * instance: the emirate's bounding box reaches from the Gulf coast to the Hatta
 * exclave 130km east and is overwhelmingly desert.
 *
 * Sampling the densest tiles is also the more correct measurement, which is
 * what makes it worth doing rather than merely necessary. A category list is a
 * claim about a city's high street, and empty desert has no opinion about
 * whether a city has tailors. Measuring where the businesses are is the
 * question that was actually being asked.
 */
export const CATEGORY_SAMPLE_TILES = 10;

export interface GenerateOptions {
  name: string;
  budget: number;
  client: OsmClient;
  categoryMap: CategoryMap;
  /** Injected rather than read from the clock, so output is reproducible. */
  today: string;
  id?: string;
  radiusKm?: number;
  /** Share of centres per density class; defaults to Dubai's 15/18/11 shape. */
  shares?: Record<Density, number>;
}

export interface GenerateResult {
  city: CityConfig;
  /** Tiles the budget could not afford, so the choice stays visible. */
  dropped: CityTile[];
  /** Place nodes OSM returned, before spacing. */
  candidatesConsidered: number;
  /** Centres that survived spacing. */
  survivors: number;
  /** Centres skipped for having no Latin name. */
  skipped: number;
}

/** Kilometres per degree of latitude, matching `distanceKm` in core. */
const KM_PER_DEGREE = 111.195;

/**
 * One box covering the given tiles, grown by the measurement radius so the
 * count covers the ground those tiles will actually crawl rather than only
 * their centre points.
 */
function boxAround(
  tiles: readonly { lat: number; lng: number }[],
  padKm: number,
): BoundingBox {
  const lats = tiles.map((t) => t.lat);
  const lngs = tiles.map((t) => t.lng);
  const padLat = padKm / KM_PER_DEGREE;
  const meanLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  // A degree of longitude shortens with latitude, so the same distance is more
  // degrees. Using the latitude pad here would under-cover east-west.
  const padLng = padLat / Math.max(Math.cos((meanLat * Math.PI) / 180), 0.01);

  return {
    minLat: Math.min(...lats) - padLat,
    maxLat: Math.max(...lats) + padLat,
    minLng: Math.min(...lngs) - padLng,
    maxLng: Math.max(...lngs) + padLng,
  };
}

function idFrom(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function generateCityConfig(
  options: GenerateOptions,
): Promise<GenerateResult> {
  const {
    name,
    budget,
    client,
    categoryMap,
    today,
    radiusKm = DENSITY_RADIUS_KM,
    shares,
  } = options;

  // 1. Resolve the name to a boundary, a country and a set of names.
  const place = parseNominatimPlace(await client.resolvePlace(name), name);

  // 2. Candidate centres: locally-named neighbourhood nodes, placed by people
  //    who live there. `_template.json` is explicit that an even grid wastes
  //    requests on water, desert and airports.
  const nodes = parseOverpassPlaces(
    await client.places({ osmType: place.osmType, osmId: place.osmId }),
  );

  // 3. One bulk POI fetch for the whole city; density is counted locally.
  const pois = parseOverpassPois(await client.pois(place.boundingBoxes));

  // 4. Count businesses around each candidate, then rank the city against
  //    itself. Absolute thresholds were measured first and rejected: fitted to
  //    Dubai they called 43 of Lisbon's 50 centres dense, because they encode
  //    Dubai's sprawl rather than any general notion of busy. See
  //    assignDensityByRank in packages/core/src/tiles.ts.
  const taken = new Set<string>();
  const counted: Array<Omit<TileCandidate, "density">> = [];
  let skipped = 0;
  for (const node of nodes) {
    let id: string;
    try {
      id = tileIdFrom(node.name, taken);
    } catch {
      // One node nobody has given a Latin name must not cost a whole city —
      // but it must not become an opaque /area/ hash either (ADR 0011).
      skipped++;
      continue;
    }
    counted.push({
      id,
      name: node.name,
      lat: node.lat,
      lng: node.lng,
      poiCount: countNearby(node, pois, radiusKm),
    });
  }

  const withDensity = (
    set: readonly Omit<TileCandidate, "density">[],
  ): TileCandidate[] => {
    const assigned = assignDensityByRank(set, shares);
    return set.map((c) => ({ ...c, density: assigned.get(c.id)! }));
  };

  // 5. Thin clusters that would crawl each other's ground. Busiest first.
  //    Density is needed here because a sparse centre has to clear a wider gap
  //    than a dense one, so it is assigned provisionally and then again at the
  //    end, once the set that actually ships is known.
  const spaced = spaceOut(withDensity(counted));

  if (spaced.length < MIN_CANDIDATE_TILES) {
    throw new Error(
      `OpenStreetMap has too few mapped neighbourhoods for ${JSON.stringify(name)}: ` +
        `${nodes.length} place nodes, ${counted.length} candidate centres, ` +
        `${spaced.length} left after spacing — fewer than the ${MIN_CANDIDATE_TILES} ` +
        `needed to tile a city.\n\n` +
        `The generator will not fall back to an even grid: a fabricated tile ` +
        `set is invented data wearing a generator's credibility, and a grid ` +
        `spends requests on water, desert and airports.\n\n` +
        `Either the city is genuinely under-mapped — in which case mapping it ` +
        `helps everyone — or it resolved to the wrong boundary. Check ` +
        `openstreetmap.org/${place.osmType}/${place.osmId}.`,
    );
  }

  // 6. Categories, measured over the commercial core rather than copied from
  //    another city — and rather than over the whole boundary, which returns
  //    HTTP 504 for a city with a large empty hinterland. Ranking by POI count
  //    rather than by density keeps this independent of the density pass,
  //    which has not run on the final set yet.
  const sample = [...spaced]
    .sort((a, b) => b.poiCount - a.poiCount)
    .slice(0, CATEGORY_SAMPLE_TILES);
  const tags = Object.keys(categoryMap);
  const counts = parseOverpassCounts(
    await client.categoryCounts([boxAround(sample, radiusKm)], tags),
    tags,
  );
  const categories = deriveCategories(counts, categoryMap);

  if (categories.length === 0) {
    throw new Error(
      `No category in data/category-map.json has enough presence in ` +
        `${JSON.stringify(name)} to be worth crawling. A config with no ` +
        `categories plans zero jobs and would look like a working crawl that ` +
        `honestly found nothing.`,
    );
  }

  // 7. Decide how many tiles the budget holds BEFORE assigning density, then
  //    keep that many of the busiest centres.
  //
  //    Doing it the other way round is what the first version did, and it was
  //    wrong in a way the output made obvious: Dubai's 321 mapped
  //    neighbourhood nodes leave 276 after spacing, ranking puts ~34% of them
  //    in the expensive `dense` class, and fitToBudget then discarded 258
  //    tiles. The config shipped with 18 tiles where a human had placed 44 for
  //    a comparable budget — the money had gone on depth in a few places
  //    instead of breadth across the city.
  const affordable = tilesAffordable(budget, categories);
  const chosen = [...spaced]
    .sort((a, b) => b.poiCount - a.poiCount || a.id.localeCompare(b.id))
    .slice(0, affordable);

  const tiles: CityTile[] = withDensity(chosen).map((c) => ({
    id: c.id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    zoom: ZOOM_FOR_DENSITY[c.density],
    density: c.density,
  }));

  // fitToBudget still runs, and still has the last word. tilesAffordable works
  // from an expected cost, so a city whose density split lands above average
  // can still overshoot; this is the guarantee, not the estimate.
  const fit = fitToBudget(tiles, categories, budget);

  const city: CityConfig = {
    id: options.id ?? idFrom(place.name),
    name: place.name,
    countryCode: place.countryCode,
    phoneRegion: place.phoneRegion,
    cityNames: place.names,
    boundingBoxes: place.boundingBoxes,
    tiles: fit.tiles,
    categories,
    verification: {
      status: "generated",
      source: "openstreetmap",
      generatedAt: today,
      generator: GENERATOR_VERSION,
    },
  };

  // A generated config that its own loader would reject is a bug that must
  // surface here, not at crawl time with credits on the line.
  parseCityConfig(JSON.stringify(city), city.id);

  return {
    city,
    dropped: fit.dropped,
    candidatesConsidered: nodes.length,
    survivors: spaced.length,
    skipped,
  };
}
