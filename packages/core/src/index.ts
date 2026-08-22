export { normalizePhone } from "./phone";
export type { NormalizedPhone, PhoneType } from "./phone";

export { toSlug } from "./slug";

export { isInCity, parseCityConfig, verificationState } from "./city";

export { nearestTile } from "./nearest";

export {
  PROVISIONAL_DENSITY_THRESHOLDS,
  SPACING_FLOORS,
  classifyDensity,
  distanceKm,
  spaceOut,
} from "./tiles";
export type {
  DensityThresholds,
  GeoPoint,
  SpacingFloors,
  TileCandidate,
} from "./tiles";

export { serializeJsonLd } from "./jsonld";

export { corpusPrior, rankScore } from "./rank";

export { buildFaq, faqJsonLd } from "./faq";
export type { FaqEntry, FaqInput } from "./faq";

export { extractAmenities } from "./amenities";
export type { Amenities } from "./amenities";
export type { RankPrior } from "./rank";

export { RATING_BANDS, ratingDistribution } from "./distribution";
export type { RatingBand, RatingBin, RatingDistribution } from "./distribution";

export { REVIEW_BUCKETS, buildChartDataset, sliceDataset } from "./pivot";
export type {
  ChartDataset,
  ChartFilter,
  ChartSlice,
  ReviewBucket,
} from "./pivot";

export {
  MIN_BUSINESSES_PER_THEME,
  MIN_CATEGORY_CONCENTRATION,
  keepGeneralisableThemes,
  keepTopicalThemes,
} from "./generalise";
export type { CategorisedBusiness } from "./generalise";

export {
  buildCorpusFrequency,
  deriveReviewSignals,
  stripReviewIdentity,
} from "./reviews";
export type { AnonymousReview, ReviewSignals } from "./reviews";

export { dropSuppressed, parseSuppressionList } from "./suppression";
export type { Identifiable, SuppressionResult } from "./suppression";

export { dedupeByPlaceId } from "./dedupe";
export type { DedupeResult } from "./dedupe";

export { applyTaxonomy, distinctCategories } from "./taxonomy";

export {
  detectSignals,
  establishment,
  findLeads,
  isContactable,
  leadScore,
  LEAD_SIGNALS,
  signalStrength,
} from "./leads";
export type { Lead, LeadOptions, LeadResult, LeadSignal } from "./leads";

export type {
  BoundingBox,
  Business,
  CityCategory,
  CityConfig,
  CityTile,
  CityVerification,
  Density,
  GeneratedProvenance,
  RawLocalResult,
  TaxonomyMap,
  TaxonomyNode,
  Tier,
  VerificationState,
  VerifiedProvenance,
} from "./types";
