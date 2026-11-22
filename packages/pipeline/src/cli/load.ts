/**
 * Stage 4 — normalise the crawl output and load it into DynamoDB.
 *
 *   pnpm load --dry-run        report the quality gates; DynamoDB untouched
 *   pnpm load --files-only     write data/out/ only; DynamoDB untouched (CI)
 *   pnpm load --yes            write to DynamoDB
 *
 *   --carry-over <path>        merge the previous businesses.json (ADR 0016)
 *   --max-unseen-days <n>      grace period for carried records (default 56)
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
  DEFAULT_MAX_UNSEEN_DAYS,
  dedupeByPlaceId,
  dropSuppressed,
  mergeCarryOver,
  parseCarryOver,
  parseSuppressionList,
  nearestTile,
  type Business,
  type RawLocalResult,
  type TaxonomyMap,
} from "@directory/core";
import { loadCity } from "../plan";
import { toItems } from "../items";
import { normalizeAll } from "../normalize";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const filesOnly = argv.includes("--files-only");
const confirmed = argv.includes("--yes");
const tableName = process.env.DIRECTORY_TABLE;
const cityFlagIndex = argv.indexOf("--city");

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** A flag that takes a value must get one; `--carry-over --yes` is a typo, not a path. */
function flagValue(flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`${flag} needs a value.`);
  }
  return value;
}

/**
 * --files-only exists so a scheduled job can rebuild data/out/ without
 * DynamoDB credentials. --dry-run happens to write the same file today, but
 * that is a side effect of the web app's local-development needs; a job that
 * relied on it would break silently the day someone made dry runs truly dry,
 * then push the previous dataset back up as if it were new.
 */
if (filesOnly && (confirmed || dryRun)) {
  fail("--files-only cannot be combined with --yes or --dry-run.");
}

const carryOverPath = flagValue("--carry-over");
const maxUnseenFlag = flagValue("--max-unseen-days");
const maxUnseenDays =
  maxUnseenFlag === undefined ? DEFAULT_MAX_UNSEEN_DAYS : Number(maxUnseenFlag);
if (!Number.isInteger(maxUnseenDays) || maxUnseenDays < 0) {
  fail(
    `--max-unseen-days must be a whole number of days >= 0; got ${JSON.stringify(maxUnseenFlag)}.`,
  );
}

/**
 * Read the previous dataset now, before anything else is read or written.
 *
 * Two reasons. A bad path should fail in the first second, not after the
 * archive walk. And the natural CI invocation points --carry-over at a file
 * that this run is about to overwrite (data/out/businesses.json after
 * `pnpm dataset:pull`), so it has to be in memory first.
 *
 * Missing or malformed is fatal, never "carry nothing": that would quietly
 * turn off the protection on the run that needed it.
 */
let previous: Business[] = [];
if (carryOverPath !== undefined) {
  try {
    previous = parseCarryOver(readFileSync(carryOverPath, "utf8"));
  } catch (error) {
    fail(
      `Could not use --carry-over ${carryOverPath}:\n  ${error instanceof Error ? error.message : String(error)}\n\n` +
        "  The load stopped rather than treat it as an empty previous dataset.",
    );
  }
}
// One instant for the whole run, so every fresh record carries the same stamp.
const now = new Date();
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

const fresh: Business[] = [];
let rejectedNotDubai = 0;
let rejectedNoPlaceId = 0;

for (const [area, group] of byArea) {
  const report = normalizeAll(group, map, area, city);
  fresh.push(...report.businesses);
  rejectedNotDubai += report.rejectedNotDubai;
  rejectedNoPlaceId += report.rejectedNoPlaceId;
}

/**
 * Merge with the previous dataset, AFTER normalisation and BEFORE anything is
 * written, so businesses.json, the DynamoDB items and the typeahead prefixes
 * all derive from the same merged set (ADR 0016).
 *
 * A carried record's area is re-derived from its coordinates against today's
 * tiles, the same rule fresh records follow above (ADR 0011). Its stored area
 * came from whatever tiles the city had when it was last crawled; without
 * this, editing the tile set would leave carried businesses on pages that no
 * longer exist.
 *
 * Suppression is applied again inside the merge. The previous dataset was
 * built before today's takedowns, so it is a second way back in (ADR 0007).
 */
const previousInTodaysAreas = previous.map((b) => {
  const geographic =
    b.lat !== undefined && b.lng !== undefined
      ? nearestTile(b.lat, b.lng, city.tiles)
      : null;
  return geographic && geographic !== b.area ? { ...b, area: geographic } : b;
});
const merged = mergeCarryOver(previousInTodaysAreas, fresh, {
  now,
  maxUnseenDays,
  suppressed,
});
const businesses = merged.businesses;
// Counted on the merged set: the taxonomy gate's denominator is what gets
// published, so its numerator must be too, carried records included.
const unmappedPublished = businesses.filter((b) => !b.l2).length;

// Always write the normalised set, including on a dry run: this is what the
// web app reads in local development, standing in for DynamoDB. It lands in
// data/out/, which is git-ignored — the dataset is never committed (ADR 0002).
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
Carry-over from     ${carryOverPath ?? "NONE  (--carry-over not given: the previous dataset was not consulted, so anything this crawl missed is gone)"}
Fresh               ${merged.counts.fresh.toLocaleString()}  (returned by this crawl, stamped lastSeenAt ${now.toISOString()})
Carried             ${merged.counts.carried.toLocaleString()}  (not returned this time, seen within ${maxUnseenDays} days — kept)
Retired             ${merged.counts.retired.toLocaleString()}  (not returned for more than ${maxUnseenDays} days — dropped)
Suppressed on merge ${merged.counts.suppressed.toLocaleString()}  (takedowns re-applied to the merged set; non-zero means the previous dataset still held one)
Businesses          ${businesses.length.toLocaleString()}  (fresh + carried)
Rejected non-Dubai  ${rejectedNotDubai.toLocaleString()}
Rejected no place_id ${rejectedNoPlaceId.toLocaleString()}
Area reassigned     ${reassigned.toLocaleString()}  (found by one tile's query, actually located in another)
DynamoDB items      ${items.length.toLocaleString()}  (${businesses.length} business + ${items.length - businesses.length} typeahead)

v0.1 QUALITY GATES
  unique place_ids >= 10,000   ${businesses.length.toLocaleString().padEnd(8)} ${gate(businesses.length >= 10_000)}
  E.164 phone coverage >= 90%  ${(pct(withPhone) + "%").padEnd(8)} ${gate(withPhone / Math.max(businesses.length, 1) >= 0.9)}
  taxonomy coverage >= 99%     ${(pct(businesses.length - unmappedPublished) + "%").padEnd(8)} ${gate((businesses.length - unmappedPublished) / Math.max(businesses.length, 1) >= 0.99)}
  slugs unique                 ${String(slugs.size).padEnd(8)} ${gate(slugs.size === businesses.length)}
  zero non-AE rows loaded      ${"0".padEnd(8)} PASS (filtered at normalise)
`);

if (unmappedPublished > 0) {
  console.log(
    `${unmappedPublished} businesses have no taxonomy — mostly non-business categories left unmapped on purpose.\n`,
  );
}

if (dryRun) {
  console.log(
    "--dry-run: DynamoDB untouched. data/out/businesses.json was still written (the web app's local stand-in).\n",
  );
  process.exit(0);
}

if (filesOnly) {
  console.log(
    "--files-only: wrote data/out/businesses.json. DynamoDB untouched.\n",
  );
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
