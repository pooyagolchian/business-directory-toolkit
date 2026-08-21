/**
 * Stage 5 — derive review signals.
 *
 *   pnpm reviews --dry-run          request count and credit cost
 *   pnpm reviews --yes --limit 500  spend credits and write the signals
 *
 * WHY THIS IS NOT A REVIEW SCRAPER
 *
 * Two things are never stored, and the difference matters:
 *
 * 1. Reviewer identity. The engine returns names, contributor ids, profile
 *    links and photographs. A reviewer is a private individual, not a
 *    business, and this project indexes business listings only.
 *
 * 2. Review text. It is Google's users' content, and republishing it verbatim
 *    at scale is redistribution — the same reasoning that produced ADR 0002.
 *
 * So text is fetched, analysed in memory, and discarded. What is written is a
 * derived summary: how many reviews, the mean rating, and the handful of terms
 * that distinguish this business from every other one in the corpus. That is
 * original work, it is genuinely unique page content, and it cannot be
 * reassembled into a copy of Google's review corpus.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildCorpusFrequency,
  deriveReviewSignals,
  stripReviewIdentity,
  type Business,
  type ReviewSignals,
} from "@directory/core";

const ENDPOINT = "https://www.searchapi.io/api/v1/search";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const confirmed = argv.includes("--yes");
const limitFlag = argv.indexOf("--limit");
const limit = limitFlag === -1 ? 1000 : Number(argv[limitFlag + 1] ?? 1000);

const root = new URL("../../../../", import.meta.url);
const businessesPath = fileURLToPath(new URL("data/out/businesses.json", root));
const outPath = fileURLToPath(new URL("data/out/review-signals.json", root));

let businesses: Business[];
try {
  businesses = JSON.parse(readFileSync(businessesPath, "utf8")) as Business[];
} catch {
  console.error("No data/out/businesses.json. Run `pnpm load` first.\n");
  process.exit(1);
}

// Most-reviewed first: those are the pages people actually land on, and a
// business with 3 reviews has nothing to derive from anyway.
const targets = businesses
  .filter((b) => (b.reviews ?? 0) >= 10)
  .slice(0, limit);

console.log(`
Review signals
==============
Businesses with >=10 reviews  ${businesses.filter((b) => (b.reviews ?? 0) >= 10).length.toLocaleString()}
Targeting                     ${targets.length.toLocaleString()}
Requests                      ${targets.length.toLocaleString()}  (1 per business)
Credits                       ${targets.length.toLocaleString()}

Reviewer identity and review text are discarded after analysis. Only derived
signals are written.
`);

if (dryRun) {
  console.log("--dry-run: nothing was requested and nothing was spent.\n");
  process.exit(0);
}
if (!confirmed) {
  console.error("Refusing to spend credits without --yes.\n");
  process.exit(1);
}

const apiKey = process.env.SEARCH_API_KEY;
if (!apiKey) {
  console.error("SEARCH_API_KEY is not set.\n");
  process.exit(1);
}

async function fetchReviews(placeId: string) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("engine", "google_maps_reviews");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("hl", "en");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = (await response.json()) as { reviews?: unknown[] };
  // Identity stripped at the boundary, before anything else touches it.
  return (data.reviews ?? [])
    .map(stripReviewIdentity)
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

const perBusiness = new Map<string, Array<{ rating: number; text: string }>>();
const errors: string[] = [];
let requests = 0;

for (const [index, business] of targets.entries()) {
  if (index % 25 === 0) {
    process.stdout.write(`  ${index}/${targets.length}\r`);
  }
  try {
    const reviews = await fetchReviews(business.placeId);
    requests++;
    if (reviews.length > 0) perBusiness.set(business.placeId, reviews);
  } catch (error) {
    requests++;
    errors.push(
      `${business.title}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// The corpus is what makes a term "distinctive" — it has to span every
// business, so it can only be built once all of them are in.
const corpus = buildCorpusFrequency([...perBusiness.values()].flat());

const signals: Record<string, ReviewSignals> = {};
for (const [placeId, reviews] of perBusiness) {
  signals[placeId] = deriveReviewSignals(reviews, corpus);
}

// Review text goes out of scope here and is never written anywhere.
perBusiness.clear();

mkdirSync(fileURLToPath(new URL("data/out/", root)), { recursive: true });
writeFileSync(outPath, JSON.stringify(signals));

const withThemes = Object.values(signals).filter((s) => s.themes.length > 0);

console.log(`
Done
====
Requests issued      ${requests.toLocaleString()}  (= credits spent)
Businesses analysed  ${Object.keys(signals).length.toLocaleString()}
With usable themes   ${withThemes.length.toLocaleString()}
Corpus vocabulary    ${corpus.size.toLocaleString()} terms
Errors               ${errors.length}

Written to data/out/review-signals.json (git-ignored, like all crawl output).
No reviewer identity and no review text was stored.
`);

for (const error of errors.slice(0, 5)) console.log(`  ${error}`);
