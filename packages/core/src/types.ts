import type { CountryCode } from "libphonenumber-js";

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

/**
 * A normalised business — the shape everything downstream reads.
 *
 * Lives in core rather than in the pipeline because the web app consumes it
 * too, and the web package deliberately depends only on core.
 */
export interface Business {
  placeId: string;
  slug: string;
  title: string;
  /** The tile that surfaced this listing; becomes the neighbourhood. */
  area: string;
  address?: string;
  lat?: number;
  lng?: number;
  /** Exactly as the engine returned it, e.g. "04 577 6680". */
  phoneRaw?: string;
  /** Canonical form, e.g. "+97145776680". */
  phoneE164?: string;
  phoneType?: "landline" | "mobile" | "unknown";
  website?: string;
  domain?: string;
  rating?: number;
  reviews?: number;
  l1?: string;
  l2?: string;
  l3?: string;
  types: string[];
  thumbnail?: string;
  openHours?: Record<string, string>;
  dataId?: string;
}

/** `data/taxonomy-map.json`: one Google category string → one taxonomy node. */
export type TaxonomyMap = Record<string, TaxonomyNode>;

/** A rectangle in WGS84 degrees. Cities may need several. */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type Density = "dense" | "medium" | "sparse";
export type Tier = "broad" | "standard" | "niche";

export interface CityTile {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoom: number;
  density: Density;
}

export interface CityCategory {
  q: string;
  tier: Tier;
}

/**
 * Everything the toolkit needs to crawl one city.
 *
 * This is the file a user writes to point the pipeline somewhere new. Nothing
 * downstream hard-codes a city, so adding Riyadh or Manchester is config, not
 * code — see docs/adr/0005-toolkit-not-directory.md.
 */
export interface CityConfig {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2, matched against the engine's `country_code`. */
  countryCode: string;
  /** Region passed to libphonenumber for E.164 normalisation. */
  phoneRegion: CountryCode;
  /**
   * City strings to accept, lowercased. More than one when a city has
   * administratively separate areas (Dubai includes Hatta).
   */
  cityNames: string[];
  /** Sanity check only; `cityNames` is the primary filter. */
  boundingBoxes: BoundingBox[];
  tiles: CityTile[];
  categories: CityCategory[];
}
