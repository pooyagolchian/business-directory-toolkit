import type { RawLocalResult } from "./types.js";

/**
 * Dubai emirate, plus the Hatta exclave, which is administratively Dubai but
 * sits ~130 km away against the Oman border.
 */
const BOUNDING_BOXES = [
  { minLat: 24.75, maxLat: 25.36, minLng: 54.85, maxLng: 55.65 }, // main emirate
  { minLat: 24.7, maxLat: 24.9, minLng: 56.0, maxLng: 56.25 }, // Hatta
] as const;

const DUBAI_CITY_NAMES = new Set(["dubai", "hatta"]);

/**
 * The engine returns city in two forms — "Dubai" and
 * "Dubai - United Arab Emirates" (80/20 across 100 probed results).
 */
function normalizeCity(city: string): string {
  return (city.split(" - ")[0] ?? "").trim().toLowerCase();
}

/**
 * Decide whether a listing belongs in a Dubai directory.
 *
 * City is the primary test, not geography. Dubai and Sharjah form one
 * continuous urban area and the border is not rectangular, so any bounding box
 * loose enough to contain Dubai also contains a large part of Sharjah. The
 * `city` field was present on 100/100 probed results, making it both more
 * available and more accurate than coordinates.
 *
 * Coordinates are kept only as a sanity check, to stop a mislabelled listing
 * from dragging a foreign business into the index.
 */
export function isDubaiListing(record: RawLocalResult): boolean {
  if (record.country_code !== "AE") return false;
  if (!record.city) return false;
  if (!DUBAI_CITY_NAMES.has(normalizeCity(record.city))) return false;

  const gps = record.gps_coordinates;
  // No coordinates is not a reason to lose a record — city and country already
  // agree, and some valid listings simply omit GPS.
  if (!gps) return true;

  return BOUNDING_BOXES.some(
    (box) =>
      gps.latitude >= box.minLat &&
      gps.latitude <= box.maxLat &&
      gps.longitude >= box.minLng &&
      gps.longitude <= box.maxLng,
  );
}
