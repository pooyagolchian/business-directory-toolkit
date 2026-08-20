import type { TaxonomyMap, TaxonomyNode } from "@directory/core";

/**
 * Claude Haiku 4.5 list pricing, USD per million tokens.
 * Update alongside any model change — these numbers get published.
 */
const PRICE_PER_MTOK = { input: 1.0, output: 5.0 } as const;
const BATCH_DISCOUNT = 0.5;

/**
 * Categories the model has not seen before.
 *
 * This is the project's central cost decision. Google's category vocabulary is
 * finite and saturates; business count does not. By classifying each distinct
 * string exactly once — ever, across every future crawl — the marginal cost of
 * the next 1,000 businesses falls to zero, because they resolve by lookup.
 */
export function categoriesNeedingClassification(
  distinct: string[],
  existing: TaxonomyMap,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const category of distinct) {
    if (existing[category]) continue;
    if (seen.has(category)) continue;
    seen.add(category);
    out.push(category);
  }
  return out;
}

/**
 * Merge model output into the committed map, with the existing entry always
 * winning.
 *
 * `data/taxonomy-map.json` is committed precisely so a wrong mapping can be
 * fixed by pull request. If a re-run overwrote those corrections, contributors
 * would be fixing the same entry forever.
 */
export function mergeTaxonomy(
  existing: TaxonomyMap,
  incoming: TaxonomyMap,
): TaxonomyMap {
  return { ...incoming, ...existing };
}

export function batchCategories(
  categories: string[],
  size: number,
): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < categories.length; i += size) {
    batches.push(categories.slice(i, i + size));
  }
  return batches;
}

/**
 * Build the classification prompt.
 *
 * The existing level-2 vocabulary is passed in deliberately: without it the
 * model invents a fresh l2 per batch and the taxonomy fragments into
 * near-duplicate browse pages ("Restaurants" and "Restaurant" and "Dining"),
 * each generating its own thin SEO page.
 */
export function buildClassificationPrompt(
  categories: string[],
  existingL2: string[] = [],
): string {
  const vocabulary =
    existingL2.length > 0
      ? `\nReuse these existing level-2 values wherever one fits, rather than inventing a near-duplicate:\n${existingL2.map((v) => `- ${v}`).join("\n")}\n`
      : "";

  return `You are building a browse taxonomy for a Dubai, UAE local business directory.

Classify each Google Maps category string into three levels:
- l1: a broad browse heading (aim for 10-15 across the whole directory)
- l2: the page-generating level, e.g. "Restaurants", "Pharmacies"
- l3: an optional refinement, e.g. "Seafood". Omit it if nothing meaningful applies.

Local vocabulary matters. This is Dubai: "Cafeteria" is a specific UAE business
type, shawarma and karak deserve their own l3, and mall-based retail is a real
structural category. Do not force a US-centric taxonomy onto these.
${vocabulary}
Return ONLY a JSON array, no prose:
[{"category": "<exact input string>", "l1": "...", "l2": "...", "l3": "..."}]

Categories to classify:
${categories.map((c) => `- ${c}`).join("\n")}`;
}

/**
 * Parse a model response into a taxonomy map.
 *
 * Throws on unparseable output. Returning an empty map would be
 * indistinguishable from "nothing needed classifying", which would quietly
 * leave the entire corpus untagged and look like success.
 */
export function parseClassification(text: string): TaxonomyMap {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error(
      `No JSON array found in classification response: ${text.slice(0, 200)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error(
      `Malformed classification JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Classification response was not an array");
  }

  const map: TaxonomyMap = {};
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { category, l1, l2, l3 } = entry as Record<string, unknown>;
    // A half-filled entry would create a business with an l1 and no browse
    // page. Drop it so it resurfaces as unmapped on the next run.
    if (
      typeof category !== "string" ||
      typeof l1 !== "string" ||
      typeof l2 !== "string"
    ) {
      continue;
    }
    const node: TaxonomyNode = { l1, l2 };
    if (typeof l3 === "string" && l3.trim() !== "") node.l3 = l3;
    map[category] = node;
  }
  return map;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  batch?: boolean;
}

/** Price a classification run. These figures are published, so show the maths. */
export function estimateCost(usage: TokenUsage): {
  usd: number;
  breakdown: string;
} {
  const multiplier = usage.batch ? BATCH_DISCOUNT : 1;
  const input =
    (usage.inputTokens / 1_000_000) * PRICE_PER_MTOK.input * multiplier;
  const output =
    (usage.outputTokens / 1_000_000) * PRICE_PER_MTOK.output * multiplier;
  const usd = input + output;

  return {
    usd,
    breakdown:
      `${usage.inputTokens.toLocaleString()} in @ $${PRICE_PER_MTOK.input}/Mtok + ` +
      `${usage.outputTokens.toLocaleString()} out @ $${PRICE_PER_MTOK.output}/Mtok` +
      `${usage.batch ? " (Batch API, 50% off)" : ""} = $${usd.toFixed(4)}`,
  };
}
