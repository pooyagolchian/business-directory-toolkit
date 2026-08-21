import {
  applyTaxonomy,
  isInCity,
  normalizePhone,
  toSlug,
  type Business,
  type CityConfig,
  type RawLocalResult,
  type TaxonomyMap,
} from "@directory/core";

export type { Business };

export interface NormalizeReport {
  businesses: Business[];
  rejectedNotDubai: number;
  rejectedNoPlaceId: number;
  /** Kept, but with no taxonomy yet — these are gaps in the category map. */
  unmappedTaxonomy: number;
}

/**
 * Stage 2 — turn one raw engine result into a business record.
 *
 * Returns null only for records that genuinely cannot be used: no `place_id`
 * (nothing to key on) or not in the configured city. A missing phone or an unmapped category
 * is a gap to report, never a reason to discard a listing.
 */
export function normalizeBusiness(
  record: RawLocalResult,
  map: TaxonomyMap,
  area: string,
  city: CityConfig,
): Business | null {
  const placeId = record.place_id;
  if (!placeId) return null;
  if (!isInCity(record, city)) return null;

  const title = record.title ?? "";
  const phone = normalizePhone(record.phone, city.phoneRegion);
  const taxonomy = applyTaxonomy(record, map);

  const business: Business = {
    placeId,
    slug: toSlug(title, placeId),
    title,
    area,
    types: record.types ?? (record.type ? [record.type] : []),
  };

  // Assigned conditionally because `exactOptionalPropertyTypes` distinguishes
  // an absent key from one explicitly set to undefined, and DynamoDB rejects
  // undefined attribute values.
  if (record.address) business.address = record.address;
  if (record.gps_coordinates) {
    business.lat = record.gps_coordinates.latitude;
    business.lng = record.gps_coordinates.longitude;
  }
  if (phone) {
    business.phoneRaw = phone.raw;
    business.phoneE164 = phone.e164;
    business.phoneType = phone.type;
  }
  if (record.website) business.website = record.website;
  if (record.domain) business.domain = record.domain;
  if (typeof record.rating === "number") business.rating = record.rating;
  if (typeof record.reviews === "number") business.reviews = record.reviews;
  if (record.thumbnail) business.thumbnail = record.thumbnail;
  if (record.open_hours) business.openHours = record.open_hours;
  if (record.data_id) business.dataId = record.data_id;
  if (taxonomy) {
    business.l1 = taxonomy.l1;
    business.l2 = taxonomy.l2;
    if (taxonomy.l3) business.l3 = taxonomy.l3;
  }

  return business;
}

/**
 * Normalise a batch, reporting exactly what was dropped and why.
 *
 * A crawl that quietly loses records produces a dataset that looks complete but
 * is not — the worst failure mode, because nothing appears wrong.
 */
export function normalizeAll(
  records: RawLocalResult[],
  map: TaxonomyMap,
  area: string,
  city: CityConfig,
): NormalizeReport {
  const businesses: Business[] = [];
  let rejectedNotDubai = 0;
  let rejectedNoPlaceId = 0;
  let unmappedTaxonomy = 0;

  for (const record of records) {
    if (!record.place_id) {
      rejectedNoPlaceId++;
      continue;
    }
    if (!isInCity(record, city)) {
      rejectedNotDubai++;
      continue;
    }
    const business = normalizeBusiness(record, map, area, city);
    if (!business) continue;
    if (!business.l2) unmappedTaxonomy++;
    businesses.push(business);
  }

  return { businesses, rejectedNotDubai, rejectedNoPlaceId, unmappedTaxonomy };
}
