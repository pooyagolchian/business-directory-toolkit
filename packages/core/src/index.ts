export { normalizePhone } from "./phone.js";
export type { NormalizedPhone, PhoneType } from "./phone.js";

export { toSlug } from "./slug.js";

export { isInCity } from "./city.js";

export { nearestTile } from "./nearest.js";

export { dedupeByPlaceId } from "./dedupe.js";
export type { DedupeResult } from "./dedupe.js";

export { applyTaxonomy, distinctCategories } from "./taxonomy.js";

export type {
  BoundingBox,
  Business,
  CityCategory,
  CityConfig,
  CityTile,
  Density,
  RawLocalResult,
  TaxonomyMap,
  TaxonomyNode,
  Tier,
} from "./types.js";
