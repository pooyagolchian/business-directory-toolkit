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
 * Fitted against Dubai's 44 hand-placed tiles on 2026-08-22.
 *
 * The Overpass pass that this file used to say had not been run, has been run:
 * 24,541 `shop` + `amenity` + `office` nodes covering every one of the 44
 * tiles, counted within `DENSITY_MEASUREMENT_RADIUS_KM` of each centre, swept
 * against the known 15 dense / 18 medium / 11 sparse split.
 *
 *   fitted     radius 1.5km, dense >= 440, medium >= 52   35/44 = 80%
 *   the guess  radius 0.75km, dense >= 150, medium >= 40   30/44 = 68%
 *
 * The previous values were placeholders and are kept here as the comparison
 * rather than deleted, because 68% is what an unmeasured guess bought and that
 * is the number worth remembering.
 *
 * **What the 20% of disagreement is made of matters more than the 80%.**
 * Every error is exactly one class wide — 2 dense read as medium, 4 medium as
 * dense, 3 sparse as medium. Nothing is off by two, so no tile is ever crawled
 * five pages deep when a human said one, or one page deep when a human said
 * five. The failure mode is a modest cost error, never a missing neighbourhood.
 *
 * A human still beats this, and the generator does not pretend otherwise. The
 * medium/dense boundary is where the disagreement concentrates, which is
 * exactly where a person is applying knowledge that a POI count does not carry
 * — that Media City and Internet City are two business districts and not one.
 */
export const MEASURED_DENSITY_THRESHOLDS: DensityThresholds = {
  dense: 440,
  medium: 52,
};

/**
 * Radius the POI count is taken over, in kilometres.
 *
 * Fitted alongside the thresholds rather than assumed. 1.5km beat 1.0, 0.75
 * and 0.5 against the hand labels, which was not the expected answer: 0.75 was
 * chosen initially because Dubai's tightest dense pair sits 0.78km apart and a
 * wider radius double-counts a neighbour's businesses. The measurement says
 * that double-counting is not the problem — separating a genuinely busy
 * district from a merely busy street is, and that needs a wider window.
 */
export const DENSITY_MEASUREMENT_RADIUS_KM = 1.5;

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
  thresholds: DensityThresholds = MEASURED_DENSITY_THRESHOLDS,
): Density {
  if (poiCount >= thresholds.dense) return "dense";
  if (poiCount >= thresholds.medium) return "medium";
  return "sparse";
}

/**
 * Share of a city's centres in each density class.
 *
 * Dubai's own hand-labelled shape: 15 dense, 18 medium, 11 sparse of 44.
 */
export const DENSITY_SHARES: Record<Density, number> = {
  dense: 15 / 44,
  medium: 18 / 44,
  sparse: 11 / 44,
};

/**
 * No rank makes empty ground worth a deep crawl.
 *
 * The rank split is relative by design, but "the busiest centre in a village"
 * and "the busiest centre in Dubai" are not the same purchase. A centre below
 * this many POIs is held to `medium` at best whatever its rank, so a hamlet
 * with three shops cannot buy five pages of `broad` queries per category.
 *
 * Set at the measured `medium` threshold rather than a new number, because
 * that value was already fitted against the hand labels.
 */
export const MIN_POIS_FOR_DENSE = MEASURED_DENSITY_THRESHOLDS.medium;

/**
 * Assign density by rank within the city, not by an absolute POI count.
 *
 * **This is a correction to the absolute thresholds above, made after measuring
 * both.** Fitted absolute thresholds score 35/44 against Dubai's hand labels
 * and rank scores 34/44 — one tile apart, which is noise at this sample size.
 * They are not close at all on a second city: applied to Lisbon, the
 * Dubai-fitted thresholds called **43 of 50** centres `dense`, because Lisbon
 * is compact and superbly mapped while Dubai is sprawling. An absolute POI
 * count does not measure how busy a place is; it measures how busy a place is
 * *compared to Dubai*, which is precisely the hard-coded city ADR 0005 exists
 * to forbid.
 *
 * So the thresholds stay in this file as the measurement that produced them,
 * and the generator uses rank. Density here means "where this city's
 * businesses are concentrated, relative to the rest of this city" — which is
 * what it has to mean for `PAGE_CAP` to be a sensible way of spending a budget
 * anywhere. Note that this is a genuine shift from `PAGE_CAP`'s own comment,
 * which describes density as how likely an area is to hold 100+ businesses:
 * that reading is still true for a large city and is optimistic for a village.
 *
 * Ties break on `id` so a regenerated config diffs cleanly.
 */
export function assignDensityByRank(
  candidates: readonly { id: string; poiCount: number }[],
  shares: Record<Density, number> = DENSITY_SHARES,
): Map<string, Density> {
  const ranked = [...candidates].sort(
    (a, b) => b.poiCount - a.poiCount || a.id.localeCompare(b.id),
  );
  const n = ranked.length;
  // At least one dense centre in any non-empty city: a city where nothing is
  // crawled deeply plans almost nothing, and PAGE_CAP gives sparse tiles zero
  // pages for standard and niche categories alike.
  const dense =
    n === 0 ? 0 : Math.min(n, Math.max(1, Math.round(n * shares.dense)));
  const sparse = Math.min(Math.round(n * shares.sparse), n - dense);
  const mediumEnd = n - sparse;

  const out = new Map<string, Density>();
  ranked.forEach((candidate, i) => {
    let density: Density =
      i < dense ? "dense" : i < mediumEnd ? "medium" : "sparse";
    // The absolute guard, applied only downward.
    if (density === "dense" && candidate.poiCount < MIN_POIS_FOR_DENSE) {
      density = "medium";
    }
    out.set(candidate.id, density);
  });
  return out;
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
