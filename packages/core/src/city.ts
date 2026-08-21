import type { CityConfig, RawLocalResult } from "./types.js";

/**
 * The engine returns city in two forms — "Dubai" and
 * "Dubai - United Arab Emirates" (80/20 across 100 probed results). Same
 * pattern holds for other countries, so the split is generic.
 */
function normalizeCity(city: string): string {
  return (city.split(" - ")[0] ?? "").trim().toLowerCase();
}

/**
 * Decide whether a listing belongs to the configured city.
 *
 * City name is the primary test, not geography. Adjacent cities frequently
 * form one continuous urban area with a non-rectangular border — Dubai and
 * Sharjah are the case that proved it, since any box loose enough to contain
 * Dubai also contains much of Sharjah. The `city` field was present on 100/100
 * probed results, making it both more available and more accurate than
 * coordinates.
 *
 * Bounding boxes are kept only as a sanity check, to stop a mislabelled
 * listing from dragging a foreign business into the index.
 */
export function isInCity(record: RawLocalResult, city: CityConfig): boolean {
  if (record.country_code !== city.countryCode) return false;
  if (!record.city) return false;

  const accepted = new Set(city.cityNames.map((n) => n.toLowerCase()));
  if (!accepted.has(normalizeCity(record.city))) return false;

  const gps = record.gps_coordinates;
  // No coordinates is not a reason to lose a record — city and country already
  // agree, and some valid listings simply omit GPS.
  if (!gps) return true;
  if (city.boundingBoxes.length === 0) return true;

  return city.boundingBoxes.some(
    (box) =>
      gps.latitude >= box.minLat &&
      gps.latitude <= box.maxLat &&
      gps.longitude >= box.minLng &&
      gps.longitude <= box.maxLng,
  );
}
