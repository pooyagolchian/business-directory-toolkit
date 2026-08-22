import { isSupportedCountry } from "libphonenumber-js/max";
import type {
  CityConfig,
  CityVerification,
  RawLocalResult,
  VerificationState,
} from "./types";

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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Every value `Density` admits — used for the check and for the error text. */
const DENSITIES = ["dense", "medium", "sparse"] as const;
const TIERS = ["broad", "standard", "niche"] as const;

/** Google Maps zoom runs 0-21. `_template.json` uses 13 (sparse) to 15 (dense). */
const MIN_ZOOM = 0;
const MAX_ZOOM = 21;

function label(source?: string): string {
  return source ? `City config "${source}"` : "City config";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

function requireText(value: unknown, field: string, source?: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${label(source)}: ${field} must be a non-empty string; got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function requireCoord(
  value: unknown,
  field: string,
  max: number,
  where: string,
  source?: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `${label(source)}: ${where}${field} must be a number; got ${JSON.stringify(value)}.`,
    );
  }
  if (value < -max || value > max) {
    throw new Error(
      `${label(source)}: ${where}${field} is ${value}, outside the valid range +/-${max}.`,
    );
  }
  return value;
}

/** Dates are compared and sorted as strings, so the format has to be fixed. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireIsoDate(
  value: unknown,
  field: string,
  source?: string,
): string {
  const text = requireText(value, field, source);
  if (!ISO_DATE.test(text)) {
    throw new Error(
      `${label(source)}: ${field} must be an ISO date (yyyy-mm-dd); got ${JSON.stringify(text)}.`,
    );
  }
  return text;
}

function requireCount(value: unknown, field: string, source?: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label(source)}: ${field} must be a non-negative whole number; got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/**
 * Validate the provenance block, when there is one.
 *
 * Absence is legal and is handled by `verificationState`, not here — a config
 * with no provenance is a hand-written config, which is exactly the case
 * ADR 0005 exists to keep frictionless. What is not legal is a provenance block
 * that claims something incoherent, because the whole point of carrying
 * evidence instead of a boolean is that the evidence can be checked.
 */
function parseVerification(
  value: unknown,
  source: string | undefined,
): CityVerification {
  if (!isRecord(value)) {
    throw new Error(
      `${label(source)}: verification must be an object; got ${JSON.stringify(value)}.`,
    );
  }

  if (value.status === "generated") {
    return {
      status: "generated",
      source: requireText(value.source, "verification.source", source),
      generatedAt: requireIsoDate(
        value.generatedAt,
        "verification.generatedAt",
        source,
      ),
      generator: requireText(value.generator, "verification.generator", source),
    };
  }

  if (value.status === "verified") {
    const crawledAt = requireIsoDate(
      value.crawledAt,
      "verification.crawledAt",
      source,
    );
    const requests = requireCount(
      value.requests,
      "verification.requests",
      source,
    );
    const uniqueBusinesses = requireCount(
      value.uniqueBusinesses,
      "verification.uniqueBusinesses",
      source,
    );
    const inCity = requireCount(value.inCity, "verification.inCity", source);

    // inCity is a subset of uniqueBusinesses by construction: the v0.1 crawl
    // found 15,246 and 14,981 of them were actually in Dubai. The reverse is
    // not a rounding error, it is an incoherent claim, and a registry whose
    // headline evidence does not add up is worth less than no evidence at all.
    if (inCity > uniqueBusinesses) {
      throw new Error(
        `${label(source)}: verification.inCity (${inCity}) exceeds verification.uniqueBusinesses (${uniqueBusinesses}).`,
      );
    }

    return {
      status: "verified",
      crawledAt,
      requests,
      uniqueBusinesses,
      inCity,
    };
  }

  throw new Error(
    `${label(source)}: verification.status ${JSON.stringify(value.status)}; expected "verified" or "generated".`,
  );
}

/**
 * Validate a city config, rejecting anything malformed.
 *
 * `loadCity` used to end `JSON.parse(raw) as CityConfig`. That cast was fine
 * while one hand-written file existed, and becomes a hazard the moment configs
 * are generated in bulk, because most of the ways a config can be wrong do not
 * announce themselves. The worst is a density typo: `PAGE_CAP[tile.density]`
 * misses, `maxPages` falls to 0, and `buildCrawlPlan` skips the tile in
 * silence. One bad tile in forty-four costs a neighbourhood of coverage and
 * prints nothing. A wrong `countryCode` or an inverted bounding box is worse —
 * `isInCity` then rejects every record, and the crawl yields an empty directory
 * that is indistinguishable from a crawl which honestly found nothing.
 *
 * So this throws rather than returning a partial config, on the same reasoning
 * as `parseSuppressionList`: a half-valid city and a valid city look identical
 * from the outside, and only one of them is safe. Here the tell arrives after
 * the credits are already spent.
 *
 * Unknown fields are preserved, not rejected — `data/cities/dubai.json` carries
 * a `note` explaining its tiling, and a parser that refused it would fail the
 * repository's own config.
 */
export function parseCityConfig(json: string, source?: string): CityConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    // A bare SyntaxError says nothing about which of a hundred files broke.
    throw new Error(
      `${label(source)}: is not valid JSON - ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label(source)}: must be a JSON object.`);
  }

  requireText(parsed.id, "id", source);
  requireText(parsed.name, "name", source);

  // isInCity compares countryCode straight against the engine's country_code,
  // so a wrong one silently rejects every listing in the city.
  const countryCode = parsed.countryCode;
  if (typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error(
      `${label(source)}: countryCode must be an ISO-3166 alpha-2 code like "PT"; got ${JSON.stringify(countryCode)}.`,
    );
  }

  // Checked against libphonenumber itself rather than a regex, because this is
  // the value normalizePhone is handed: an unrecognised region there means
  // every phone number in the crawl fails to normalise.
  const phoneRegion = parsed.phoneRegion;
  if (typeof phoneRegion !== "string" || !isSupportedCountry(phoneRegion)) {
    throw new Error(
      `${label(source)}: phoneRegion ${JSON.stringify(phoneRegion)} is not a region libphonenumber recognises.`,
    );
  }

  // The primary listing filter; an empty list matches nothing at all.
  // Case is deliberately not checked: isInCity already lowercases both sides,
  // so rejecting "Lisbon" would refuse a config that demonstrably works.
  if (
    !Array.isArray(parsed.cityNames) ||
    parsed.cityNames.length === 0 ||
    !parsed.cityNames.every((n) => typeof n === "string" && n.trim() !== "")
  ) {
    throw new Error(
      `${label(source)}: cityNames must be a non-empty array of non-empty strings.`,
    );
  }

  // An empty list is legal - isInCity treats boxes as a sanity check and
  // returns true when there are none.
  if (!Array.isArray(parsed.boundingBoxes)) {
    throw new Error(`${label(source)}: boundingBoxes must be an array.`);
  }
  parsed.boundingBoxes.forEach((box, i) => {
    if (!isRecord(box)) {
      throw new Error(
        `${label(source)}: bounding box ${i + 1} must be an object.`,
      );
    }
    const where = `bounding box ${i + 1} `;
    const minLat = requireCoord(box.minLat, "minLat", 90, where, source);
    const maxLat = requireCoord(box.maxLat, "maxLat", 90, where, source);
    const minLng = requireCoord(box.minLng, "minLng", 180, where, source);
    const maxLng = requireCoord(box.maxLng, "maxLng", 180, where, source);
    // An inverted box matches nothing, which reads downstream as "this city has
    // no businesses" rather than as a broken config.
    if (minLat >= maxLat) {
      throw new Error(
        `${label(source)}: ${where}has minLat ${minLat} at or above maxLat ${maxLat}.`,
      );
    }
    if (minLng >= maxLng) {
      throw new Error(
        `${label(source)}: ${where}has minLng ${minLng} at or above maxLng ${maxLng}.`,
      );
    }
  });

  if (!Array.isArray(parsed.tiles) || parsed.tiles.length === 0) {
    throw new Error(`${label(source)}: tiles must be a non-empty array.`);
  }
  const tileIds = new Set<string>();
  parsed.tiles.forEach((tile, i) => {
    if (!isRecord(tile)) {
      throw new Error(`${label(source)}: tile ${i + 1} must be an object.`);
    }
    const id = requireText(tile.id, `tile ${i + 1} id`, source);
    requireText(tile.name, `tile "${id}" name`, source);
    const where = `tile "${id}" `;
    requireCoord(tile.lat, "lat", 90, where, source);
    requireCoord(tile.lng, "lng", 180, where, source);

    if (
      typeof tile.zoom !== "number" ||
      !Number.isInteger(tile.zoom) ||
      tile.zoom < MIN_ZOOM ||
      tile.zoom > MAX_ZOOM
    ) {
      throw new Error(
        `${label(source)}: ${where}has zoom ${JSON.stringify(tile.zoom)}; expected an integer between ${MIN_ZOOM} and ${MAX_ZOOM}.`,
      );
    }

    // The silent-zero bug this parser exists for.
    if (!isOneOf(tile.density, DENSITIES)) {
      throw new Error(
        `${label(source)}: ${where}has density ${JSON.stringify(tile.density)}; expected one of ${DENSITIES.join(", ")}.`,
      );
    }

    // Two tiles sharing an id crawl the same area twice and collapse into one
    // area in the output.
    if (tileIds.has(id)) {
      throw new Error(`${label(source)}: duplicate tile id "${id}".`);
    }
    tileIds.add(id);
  });

  if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
    throw new Error(`${label(source)}: categories must be a non-empty array.`);
  }
  const queries = new Set<string>();
  parsed.categories.forEach((category, i) => {
    if (!isRecord(category)) {
      throw new Error(`${label(source)}: category ${i + 1} must be an object.`);
    }
    const q = requireText(category.q, `category ${i + 1} q`, source);

    // The other half of the silent-zero bug.
    if (!isOneOf(category.tier, TIERS)) {
      throw new Error(
        `${label(source)}: category "${q}" has tier ${JSON.stringify(category.tier)}; expected one of ${TIERS.join(", ")}.`,
      );
    }

    // A repeated query spends every tile's budget on it twice for nothing.
    if (queries.has(q)) {
      throw new Error(`${label(source)}: duplicate category query "${q}".`);
    }
    queries.add(q);
  });

  // Optional: a config with no provenance is a hand-written one, which stays
  // legal. verificationState resolves the absence, and it never resolves it to
  // "verified".
  if (parsed.verification !== undefined) {
    parseVerification(parsed.verification, source);
  }

  // Returned as parsed rather than rebuilt, so unknown fields survive.
  return parsed as unknown as CityConfig;
}

/**
 * Resolve a config's provenance to one of three states.
 *
 * The default is the point of this function. An absent block means nobody has
 * recorded where the config came from, and that resolves to "unknown" — never
 * to "verified". It is the same safe default `dropSuppressed` takes when a
 * record carries no `place_id`: when information is missing, the cautious
 * answer wins, because the cost of being wrong is asymmetric.
 */
export function verificationState(city: CityConfig): VerificationState {
  return city.verification?.status ?? "unknown";
}
