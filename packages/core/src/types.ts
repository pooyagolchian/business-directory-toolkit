/**
 * A single entry from the SearchApi Google Maps engine `local_results` array.
 *
 * Every field is optional. The engine omits fields per listing rather than
 * returning nulls — 2 of 100 probed Dubai restaurants had no `phone` at all —
 * so nothing here can be assumed present.
 */
export interface RawLocalResult {
  position?: number;
  place_id?: string;
  data_id?: string;
  ludocid?: string;
  kgmid?: string;
  title?: string;
  description?: string;
  address?: string;
  /** Observed in two forms: "Dubai" and "Dubai - United Arab Emirates". */
  city?: string;
  country_code?: string;
  timezone?: string;
  /** Local format, never E.164. e.g. "04 577 6680". */
  phone?: string;
  rating?: number;
  reviews?: number;
  website?: string;
  domain?: string;
  gps_coordinates?: { latitude: number; longitude: number };
  /** The primary category string. */
  type?: string;
  /** All category strings. Observed up to 9 on one business. */
  types?: string[];
  open_state?: string;
  hours?: string;
  open_hours?: Record<string, string>;
  thumbnail?: string;
  images?: string[];
}

/** A resolved position in the three-level taxonomy. `l3` is optional by design. */
export interface TaxonomyNode {
  l1: string;
  l2: string;
  l3?: string;
}

/** `data/taxonomy-map.json`: one Google category string → one taxonomy node. */
export type TaxonomyMap = Record<string, TaxonomyNode>;
