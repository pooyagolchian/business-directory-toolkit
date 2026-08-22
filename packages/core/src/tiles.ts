/**
 * Tile selection — the pure half of generating a city config.
 *
 * Fetching candidate centres from OpenStreetMap needs the network. Deciding
 * which of them survive does not, and that is where all the risk lives: a
 * generator that places tiles badly spends someone's credits on the wrong
 * ground, and nothing downstream can recover from it.
 *
 * The one thing that makes this testable offline is that
 * `data/cities/dubai.json` already holds 44 tiles placed by a human. That file
 * is labelled ground truth, it costs nothing to read, and every threshold here
 * is answerable against it.
 */
import type { Density } from "./types";

/** A latitude/longitude pair in WGS84 degrees. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Kilometres in one degree of latitude on the mean-radius sphere. */
const KM_PER_DEGREE = 111.195;

/**
 * Distance between two points, in kilometres.
 *
 * Equirectangular rather than haversine, for the same reason `nearestTile`
 * gives: at city scale the error is metres, against gaps measured in hundreds
 * of them. The furthest pair this ever sees is Dubai to its Hatta exclave at
 * ~78km, where the approximation is still well inside a percent.
 *
 * The `cos(meanLat)` term is not optional. A degree of longitude is ~11%
 * shorter at Dubai's 25°N than at the equator, and ignoring it would overstate
 * every east-west gap — which means dropping tiles that are genuinely far
 * enough apart, silently, in the direction of less coverage.
 */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const meanLat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const dLat = (b.lat - a.lat) * KM_PER_DEGREE;
  const dLng = (b.lng - a.lng) * KM_PER_DEGREE * Math.cos(meanLat);
  return Math.hypot(dLat, dLng);
}

export interface DensityThresholds {
  /** At or above this many POIs, a centre is `dense`. */
  dense: number;
  /** At or above this many POIs, a centre is `medium`; below it, `sparse`. */
  medium: number;
}

/**
 * PROVISIONAL, and named so it cannot be quoted as measured.
 *
 * These are placeholders. Turning them into real numbers means counting OSM
 * `shop` + `amenity` + `office` nodes around each of Dubai's 44 hand-placed
 * tiles and fitting the thresholds that best reproduce its known 15 dense /
 * 18 medium / 11 sparse split. That needs one Overpass pass, which needs the
 * network, which has not been run — so nothing in this repository should print
 * these as a finding until it has.
 */
export const PROVISIONAL_DENSITY_THRESHOLDS: DensityThresholds = {
  dense: 150,
  medium: 40,
};

/**
 * Turn a POI count into the density label that drives pagination depth.
 *
 * Both thresholds are inclusive, so a value sitting exactly on a boundary buys
 * the deeper crawl. Density feeds `PAGE_CAP`, which is the credit bill, and of
 * the two ways to be wrong at a boundary, under-crawling a real centre is the
 * one you cannot detect afterwards — the businesses simply are not there.
 */
export function classifyDensity(
  poiCount: number,
  thresholds: DensityThresholds = PROVISIONAL_DENSITY_THRESHOLDS,
): Density {
  if (poiCount >= thresholds.dense) return "dense";
  if (poiCount >= thresholds.medium) return "medium";
  return "sparse";
}

/** Minimum kilometres between two kept tiles, by the candidate's density. */
export type SpacingFloors = Record<Density, number>;

/**
 * Floors chosen to preserve every hand-placed Dubai tile, with margin.
 *
 * Measured nearest-neighbour minima in `data/cities/dubai.json` are 0.785km
 * (dense), 0.614km (medium) and 2.04km (sparse). These floors sit below each,
 * so applying them to Dubai's own tiles drops none of them.
 *
 * **`dense` and `medium` share a floor deliberately.** Spacing is not monotonic
 * with density: the tightest pair in the whole city is Media City to Internet
 * City at 0.614km, and both are `medium` — tighter than any dense pair. A rule
 * that assumed busier means closer would have merged two distinct business
 * districts a human deliberately kept apart.
 *
 * `sparse` is wider because a sparse tile is crawled at zoom 13 and covers far
 * more ground than a dense tile at zoom 15, so two sparse centres a kilometre
 * apart are largely crawling each other's area.
 *
 * These are floors, not targets. Nothing here reproduces Dubai's spacing; it
 * only guarantees the rule would not have destroyed it.
 */
export const SPACING_FLOORS: SpacingFloors = {
  dense: 0.5,
  medium: 0.5,
  sparse: 1.5,
};

/** A candidate tile centre, before spacing decides whether it survives. */
export interface TileCandidate extends GeoPoint {
  id: string;
  name: string;
  density: Density;
  /** `shop` + `amenity` + `office` nodes within the measurement radius. */
  poiCount: number;
}

/**
 * Thin a cluster of candidate centres down to ones that do not crawl each
 * other's ground.
 *
 * Greedy, busiest first, so a cluster collapses onto its actual centre rather
 * than onto whichever node OpenStreetMap happened to list first. Ties break on
 * `id`, because ADR 0001's reproducibility claim — that a published crawl can
 * be rebuilt from the committed config — is only true if this is deterministic.
 *
 * Returns survivors in acceptance order (busiest first), not input order.
 */
export function spaceOut(
  candidates: readonly TileCandidate[],
  floors: SpacingFloors = SPACING_FLOORS,
): TileCandidate[] {
  const ordered = [...candidates].sort(
    (a, b) => b.poiCount - a.poiCount || a.id.localeCompare(b.id),
  );

  const kept: TileCandidate[] = [];
  for (const candidate of ordered) {
    // The floor belongs to the candidate being tested rather than to the pair.
    // A sparse centre covers more ground, so it has to clear a wider gap to
    // earn its place — while a dense centre may sit close to anything.
    const floor = floors[candidate.density];
    if (kept.every((k) => distanceKm(candidate, k) >= floor)) {
      kept.push(candidate);
    }
  }
  return kept;
}
