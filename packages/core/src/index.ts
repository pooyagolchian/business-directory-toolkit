export { normalizePhone } from "./phone";
export type { NormalizedPhone, PhoneType } from "./phone";

export { toSlug } from "./slug";

export { isInCity } from "./city";

export { nearestTile } from "./nearest";

export { serializeJsonLd } from "./jsonld";

export { keepGeneralisableThemes } from "./generalise";

export {
  buildCorpusFrequency,
  deriveReviewSignals,
  stripReviewIdentity,
} from "./reviews";
export type { AnonymousReview, ReviewSignals } from "./reviews";

export { dedupeByPlaceId } from "./dedupe";
export type { DedupeResult } from "./dedupe";

export { applyTaxonomy, distinctCategories } from "./taxonomy";

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
} from "./types";
