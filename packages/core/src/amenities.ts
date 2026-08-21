/**
 * Structured attributes from the engine's `extensions` block.
 *
 * 90% of crawled listings carry one, and the pipeline was discarding all of it
 * — paying for the data and then dropping it on the floor. Re-reading the
 * existing raw archive recovers it for zero credits.
 *
 * Accessibility is the part that earns its place. "Which pharmacies on my route
 * have a wheelchair-accessible entrance" is a question no Dubai directory
 * answers, and for a lot of people it is the only question that matters. The
 * crawl already knew the answer for 10,461 businesses.
 */
export interface Amenities {
  accessibility: string[];
  payments: string[];
  services: string[];
}

/**
 * Group titles the engine uses, mapped to our buckets.
 *
 * Deliberately an allow-list. The engine returns many other groups —
 * "Atmosphere", "Crowd", "Highlights" — that range from subjective to
 * sensitive, and quietly hoovering up every new group the API invents is how a
 * directory ends up publishing something it never decided to publish.
 */
const GROUPS: Record<string, keyof Amenities> = {
  accessibility: "accessibility",
  payments: "payments",
  "service options": "services",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function extractAmenities(extensions: unknown): Amenities {
  const out: Amenities = { accessibility: [], payments: [], services: [] };
  if (!Array.isArray(extensions)) return out;

  const seen: Record<keyof Amenities, Set<string>> = {
    accessibility: new Set(),
    payments: new Set(),
    services: new Set(),
  };

  for (const group of extensions) {
    if (typeof group !== "object" || group === null) continue;
    const { title, items } = group as { title?: unknown; items?: unknown };
    if (typeof title !== "string") continue;

    const bucket = GROUPS[title.toLowerCase()];
    if (!bucket) continue;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const label = (item as { title?: unknown }).title;
      if (typeof label !== "string" || label.trim() === "") continue;
      seen[bucket].add(slugify(label));
    }
  }

  out.accessibility = [...seen.accessibility];
  out.payments = [...seen.payments];
  out.services = [...seen.services];
  return out;
}
