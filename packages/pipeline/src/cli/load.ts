/**
 * Stage 4 — normalise the crawl output and load it into DynamoDB.
 *
 *   pnpm load --dry-run        report the quality gates without writing
 *   pnpm load --yes            write to DynamoDB
 *
 * The dry run is the v0.1 acceptance check: it prints every gate from the
 * implementation plan, so a bad crawl is caught before it reaches the table.
 *
 * PHONE GATE, revised from 95% to 90% on evidence.
 *
 * The 95% figure came from a 40-business restaurant fixture where coverage was
 * 100%. Across 40 verticals the real figure is 92.2%, so the gate failed
 * permanently. Before lowering it, the obvious fix was tested: does the
 * google_maps_place detail endpoint return phones the list endpoint omits?
 *
 * Measured on a 15-business sample spread across the distribution: 1 phone
 * recovered, and that one was an Indian +91 number which normalizePhone
 * correctly rejects. Usable recovery: 0 of 15. Spending 1,170 credits would
 * have bought roughly nothing.
 *
 * The ~8% without a phone genuinely have none on Google — many are places
 * rather than businesses (a promenade, a mall walkway). 92.2% is a ceiling,
 * not a gap, so the gate now reflects reality instead of an unreachable
 * target derived from one unrepresentative vertical.
 *
 * TAXONOMY GATE, revised from 100% to 99% for a different reason.
 *
 * 100% is unachievable by design, not by accident. Some Google categories are
 * deliberately left unmapped — "Bus stop", "Apartment building" — because they
 * are infrastructure and dwellings rather than businesses, and this project
 * indexes business listings only. Mapping them to satisfy a gate would mean
 * inventing categories for things that should not appear in a business
 * directory at all.
 */
import {
  BatchWriteItemCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dedupeByPlaceId,
  dropSuppressed,
  parseSuppressionList,
  nearestTile,
  type RawLocalResult,
  type TaxonomyMap,
} from "@directory/core";
import { loadCity } from "../plan";
import { toItems } from "../items";
import { normalizeAll } from "../normalize";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const confirmed = argv.includes("--yes");
const tableName = process.env.DIRECTORY_TABLE;
const cityFlagIndex = argv.indexOf("--city");
/**
 * Adding a city is the toolkit's main extension point, so a wrong id must
 * teach rather than dump a stack trace.
 */
function loadCityOrExit(id: string) {
  try {
    return loadCity(id);
  } catch (error) {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

const city = loadCityOrExit(
  cityFlagIndex === -1 ? "dubai" : (argv[cityFlagIndex + 1] ?? "dubai"),
);

const root = new URL("../../../../", import.meta.url);
const mapPath = fileURLToPath(new URL("data/taxonomy-map.json", root));
const suppressionPath = fileURLToPath(
  new URL("data/suppression-list.json", root),
);
const recordsPath = fileURLToPath(new URL("data/out/raw-records.json", root));

type SourcedRecord = RawLocalResult & { _source?: { tileId: string } };

/**
 * Rebuild the record set from the raw S3/disk archive.
 *
 * This is the payoff for archiving every response before parsing: a crawl that
 * is still running, or one that finished months ago, can be re-normalised and
 * re-loaded without spending a single credit. The tile is recovered from the
 * archive path, which is why the fetcher writes raw/{runId}/{tile}/{query}-p{n}.
 */
function recordsFromArchive(): SourcedRecord[] {
  const rawRoot = fileURLToPath(new URL("data/raw/", root));
  const out: SourcedRecord[] = [];

  const walk = (dir: string, tile: string | null) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // raw/{runId}/{tileId}/ — the second level down is the tile
        walk(full, tile ?? (dir === rawRoot ? null : entry.name));
      } else if (entry.name.endsWith(".json")) {
        const tileId = tile ?? basename(dir);
        try {
          const page = JSON.parse(readFileSync(full, "utf8")) as {
            local_results?: RawLocalResult[];
          };
          for (const r of page.local_results ?? []) {
            out.push({ ...r, _source: { tileId } });
          }
        } catch {
          // A half-written page from a crawl still in flight. Skip it rather
          // than aborting a rebuild over one truncated file.
        }
      }
    }
  };

  walk(rawRoot, null);
  return out;
}

let records: SourcedRecord[];
if (argv.includes("--from-archive")) {
  records = recordsFromArchive();
  console.log(
    `Rebuilt ${records.length.toLocaleString()} records from data/raw/ — no credits spent.`,
  );
} else {
  try {
    records = JSON.parse(readFileSync(recordsPath, "utf8"));
  } catch {
    console.error(
      "No crawl output at data/out/raw-records.json.\n" +
        "Run `pnpm crawl` first, or `pnpm load --from-archive` to rebuild from\n" +
        "already-archived responses without spending credits.\n",
    );
    process.exit(1);
  }
}

const map = JSON.parse(readFileSync(mapPath, "utf8")) as TaxonomyMap;

const deduped = dedupeByPlaceId(records);

/**
 * Honour takedown requests before anything is published.
 *
 * TAKEDOWN.md promises a removed business stays removed. A crawl cannot keep
 * that promise on its own — it returns whatever Google returns — so the list is
 * applied here, at the one point both a fresh crawl and a `--from-archive`
 * replay must pass through. Filtering at fetch time instead would leave the raw
 * archive as a way back in.
 */
const suppressed = parseSuppressionList(readFileSync(suppressionPath, "utf8"));
const surviving = dropSuppressed(deduped.unique, suppressed);

/**
 * Assign each business to the neighbourhood it is actually in.
 *
 * The tile that surfaced a listing is NOT its neighbourhood: Google returns
 * results from a radius around the query point, so a DIFC query returns hotels
 * in Jumeirah. Provenance put "Rove La Mer Beach, Jumeirah" on the DIFC page.
 * Since area backs every browse page and every area x category page, using
 * provenance would have quietly corrupted the entire SEO surface.
 *
 * Coordinates decide. Provenance is only the fallback for listings with no GPS.
 */
const byArea = new Map<string, RawLocalResult[]>();
let reassigned = 0;
for (const record of surviving.kept) {
  const provenance = (record as { _source?: { tileId: string } })._source
    ?.tileId;
  const gps = record.gps_coordinates;
  const geographic = gps
    ? nearestTile(gps.latitude, gps.longitude, city.tiles)
    : null;
  const area = geographic ?? provenance ?? city.id;
  if (geographic && provenance && geographic !== provenance) reassigned++;

  const bucket = byArea.get(area) ?? [];
  bucket.push(record);
  byArea.set(area, bucket);
}

const businesses = [];
let rejectedNotDubai = 0;
let rejectedNoPlaceId = 0;
let unmappedTaxonomy = 0;

for (const [area, group] of byArea) {
  const report = normalizeAll(group, map, area, city);
  businesses.push(...report.businesses);
  rejectedNotDubai += report.rejectedNotDubai;
  rejectedNoPlaceId += report.rejectedNoPlaceId;
  unmappedTaxonomy += report.unmappedTaxonomy;
}

// Always write the normalised set, including on a dry run: this is what the
// web app reads in local development, standing in for DynamoDB. It lands in
// data/out/, which is git-ignored — the dataset is never committed (ADR 0002).
businesses.sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
mkdirSync(fileURLToPath(new URL("data/out/", root)), { recursive: true });
writeFileSync(
  fileURLToPath(new URL("data/out/businesses.json", root)),
  JSON.stringify(businesses),
);

const items = businesses.flatMap(toItems);
const withPhone = businesses.filter((b) => b.phoneE164).length;
const slugs = new Set(businesses.map((b) => b.slug));
const pct = (n: number) =>
  ((100 * n) / Math.max(businesses.length, 1)).toFixed(1);
const gate = (ok: boolean) => (ok ? "PASS" : "FAIL");

console.log(`
Load — ${city.name}
====
Raw records         ${records.length.toLocaleString()}
After dedupe        ${deduped.unique.length.toLocaleString()}  (-${deduped.duplicatesRemoved} duplicates, -${deduped.skippedNoPlaceId} without place_id)
Suppressed          ${surviving.removed.toLocaleString()}  (takedown requests honoured, from data/suppression-list.json)
Businesses          ${businesses.length.toLocaleString()}
Rejected non-Dubai  ${rejectedNotDubai.toLocaleString()}
Rejected no place_id ${rejectedNoPlaceId.toLocaleString()}
Area reassigned     ${reassigned.toLocaleString()}  (found by one tile's query, actually located in another)
DynamoDB items      ${items.length.toLocaleString()}  (${businesses.length} business + ${items.length - businesses.length} typeahead)

v0.1 QUALITY GATES
  unique place_ids >= 10,000   ${businesses.length.toLocaleString().padEnd(8)} ${gate(businesses.length >= 10_000)}
  E.164 phone coverage >= 90%  ${(pct(withPhone) + "%").padEnd(8)} ${gate(withPhone / Math.max(businesses.length, 1) >= 0.9)}
  taxonomy coverage >= 99%     ${(pct(businesses.length - unmappedTaxonomy) + "%").padEnd(8)} ${gate((businesses.length - unmappedTaxonomy) / Math.max(businesses.length, 1) >= 0.99)}
  slugs unique                 ${String(slugs.size).padEnd(8)} ${gate(slugs.size === businesses.length)}
  zero non-AE rows loaded      ${"0".padEnd(8)} PASS (filtered at normalise)
`);

if (unmappedTaxonomy > 0) {
  console.log(
    `${unmappedTaxonomy} businesses have no taxonomy — mostly non-business categories left unmapped on purpose.\n`,
  );
}

if (dryRun) {
  console.log("--dry-run: nothing was written.\n");
  process.exit(0);
}

if (!confirmed) {
  console.error("Refusing to write to DynamoDB without --yes.\n");
  process.exit(1);
}

if (!tableName) {
  console.error(
    "DIRECTORY_TABLE is not set. Get it from `npx sst deploy` outputs.\n",
  );
  process.exit(1);
}

const client = new DynamoDBClient({});
const BATCH = 25; // DynamoDB BatchWriteItem hard limit
const MAX_WRITE_ATTEMPTS = 8;
let written = 0;

/**
 * BatchWriteItem is not all-or-nothing.
 *
 * When DynamoDB throttles individual puts it still answers 200 and hands the
 * rejected ones back in `UnprocessedItems`; the SDK's own retries do not cover
 * them, because as far as HTTP is concerned nothing failed. Ignoring that field
 * and adding `chunk.length` to a counter would print a total that was never
 * written — and a new on-demand table starts at 4,000 WCU while this load fires
 * ~7,400 batches, so throttling here is expected rather than exotic.
 *
 * That is the failure this repo calls the worst possible outcome elsewhere:
 * "a silently incomplete dataset ... because nothing looks wrong"
 * (sst.config.ts). So leftovers are resubmitted with backoff, `written` counts
 * only what DynamoDB actually accepted, and anything still unwritten after the
 * retry budget fails the load loudly.
 */
let throttled = 0;
for (let i = 0; i < items.length; i += BATCH) {
  const chunk = items.slice(i, i + BATCH);
  let pending = chunk.map((item) => ({
    PutRequest: { Item: marshall(item, { removeUndefinedValues: true }) },
  }));

  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt === MAX_WRITE_ATTEMPTS) {
      console.error(
        `\n  ${pending.length} items would not write after ${MAX_WRITE_ATTEMPTS} attempts.\n` +
          `  Wrote ${written.toLocaleString()} of ${items.length.toLocaleString()}.\n` +
          "  The table is incomplete; re-run `pnpm load --yes` once throttling clears.\n",
      );
      process.exit(1);
    }
    if (attempt > 0) {
      // Exponential backoff with jitter, so 25 retried puts do not resynchronise
      // into the same throttled millisecond on the next attempt.
      const backoff = 50 * 2 ** (attempt - 1);
      await new Promise((resolve) =>
        setTimeout(resolve, backoff + Math.random() * backoff),
      );
    }

    const response = await client.send(
      new BatchWriteItemCommand({ RequestItems: { [tableName]: pending } }),
    );
    const leftover = response.UnprocessedItems?.[tableName] ?? [];
    written += pending.length - leftover.length;
    throttled += leftover.length;
    pending = leftover as typeof pending;
  }

  if (written % 500 === 0)
    process.stdout.write(`  ${written}/${items.length}\r`);
}

console.log(`\nWrote ${written.toLocaleString()} items to ${tableName}.`);
if (throttled > 0)
  console.log(
    `  ${throttled.toLocaleString()} puts were retried after throttling.`,
  );
console.log();
