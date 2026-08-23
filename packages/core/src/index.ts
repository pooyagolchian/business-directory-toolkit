export { normalizePhone } from "./phone";
export type { NormalizedPhone, PhoneType } from "./phone";

export { toSlug } from "./slug";

export { isInCity, parseCityConfig, verificationState } from "./city";

export { nearestTile } from "./nearest";

export {
  DENSITY_MEASUREMENT_RADIUS_KM,
  DENSITY_SHARES,
  MEASURED_DENSITY_THRESHOLDS,
  MIN_POIS_FOR_DENSE,
  assignDensityByRank,
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

export {
  BOX_PADDING_DEG,
  MAX_BOUNDING_BOXES,
  POLYGON_SIMPLIFY_DEG,
  ZOOM_FOR_DENSITY,
  boundingBoxesFrom,
  countNearby,
  parseNominatimPlace,
  parseOverpassCounts,
  parseOverpassPlaces,
  parseOverpassPois,
  tileIdFrom,
} from "./osm";
export type { OsmPlaceNode, OsmPoi, ResolvedPlace } from "./osm";

export {
  MAX_CATEGORIES,
  MIN_CATEGORY_COUNT,
  TIER_SHARES,
  deriveCategories,
  parseCategoryMap,
} from "./categories";
export type { CategoryMap } from "./categories";

export { serializeJsonLd } from "./jsonld";

export { corpusPrior, rankScore } from "./rank";

export {
  ACCESSIBILITY_LABELS,
  ACCESSIBILITY_VALUES,
  PRESENCE_KEYS,
  PRESENCE_LABELS,
  RATING_STEPS,
  REVIEW_STEPS,
  SEARCH_PARAMS,
  SORT_KEYS,
  SORT_LABELS,
  canonicalAmenity,
  facetSearch,
  filterToQuery,
  hasActiveFilter,
  paginate,
  parseFilter,
  parsePage,
  parseSortKey,
  sortBusinesses,
  toCategorySlug,
  toggleFilter,
} from "./facets";
export type {
  BusinessFilter,
  FacetGroup,
  FacetGroups,
  FacetValue,
  FacetedResult,
  PageSlice,
  PresenceKey,
  QueryValue,
  SearchQuery,
  SortKey,
} from "./facets";

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

export { applyTaxonomy, distinctCategories, matchesCategory } from "./taxonomy";

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
