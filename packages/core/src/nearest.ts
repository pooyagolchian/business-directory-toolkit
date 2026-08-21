import type { CityTile } from "./types.js";

/**
 * Assign a business to the tile it is geographically closest to.
 *
 * Not the tile whose query happened to surface it. Google returns results from
 * a radius around the query point, so a search centred on DIFC will happily
 * return a hotel in Jumeirah — and using provenance as the neighbourhood put
 * "Rove La Mer Beach, Jumeirah" on the DIFC page. Since the area is what the
 * browse pages and the area x category pages are built on, provenance would
 * have quietly corrupted the whole SEO surface.
 *
 * Equirectangular approximation rather than haversine: at city scale the error
 * is metres, and the cost is one cos() for the whole call instead of six
 * trig operations per tile.
 */
export function nearestTile(
  lat: number,
  lng: number,
  tiles: CityTile[],
): string | null {
  if (tiles.length === 0) return null;

  // A degree of longitude shrinks toward the poles — ~11% shorter than a
  // degree of latitude at Dubai's 25°N. Ignoring that misassigns businesses
  // sitting between two tiles.
  const lngScale = Math.cos((lat * Math.PI) / 180);

  let bestId: string | null = null;
  let bestDistance = Infinity;

  for (const tile of tiles) {
    const dLat = tile.lat - lat;
    const dLng = (tile.lng - lng) * lngScale;
    // Squared distance is enough for a comparison, so skip the square root.
    const distance = dLat * dLat + dLng * dLng;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = tile.id;
    }
  }

  return bestId;
}
