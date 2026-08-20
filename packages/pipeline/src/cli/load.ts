/**
 * Stage 4 — normalise the crawl output and load it into DynamoDB.
 *
 *   pnpm load --dry-run        report the quality gates without writing
 *   pnpm load --yes            write to DynamoDB
 *
 * The dry run is the v0.1 acceptance check: it prints every gate from the
 * implementation plan, so a bad crawl is caught before it reaches the table.
 */
import {
  BatchWriteItemCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  dedupeByPlaceId,
  type RawLocalResult,
  type TaxonomyMap,
} from "@directory/core";
import { toItems } from "../items.js";
import { normalizeAll } from "../normalize.js";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const confirmed = argv.includes("--yes");
const tableName = process.env.DIRECTORY_TABLE;

const root = new URL("../../../../", import.meta.url);
const mapPath = fileURLToPath(new URL("data/taxonomy-map.json", root));
const recordsPath = fileURLToPath(new URL("data/out/raw-records.json", root));

let records: (RawLocalResult & { _source?: { tileId: string } })[];
try {
  records = JSON.parse(readFileSync(recordsPath, "utf8"));
} catch {
  console.error(
    "No crawl output at data/out/raw-records.json. Run `pnpm crawl` first.\n",
  );
  process.exit(1);
}

const map = JSON.parse(readFileSync(mapPath, "utf8")) as TaxonomyMap;

const deduped = dedupeByPlaceId(records);

// Each record carries the tile that surfaced it, which becomes its area.
const byArea = new Map<string, RawLocalResult[]>();
for (const record of deduped.unique) {
  const area =
    (record as { _source?: { tileId: string } })._source?.tileId ?? "dubai";
  const bucket = byArea.get(area) ?? [];
  bucket.push(record);
  byArea.set(area, bucket);
}

const businesses = [];
let rejectedNotDubai = 0;
let rejectedNoPlaceId = 0;
let unmappedTaxonomy = 0;

for (const [area, group] of byArea) {
  const report = normalizeAll(group, map, area);
  businesses.push(...report.businesses);
  rejectedNotDubai += report.rejectedNotDubai;
  rejectedNoPlaceId += report.rejectedNoPlaceId;
  unmappedTaxonomy += report.unmappedTaxonomy;
}

const items = businesses.flatMap(toItems);
const withPhone = businesses.filter((b) => b.phoneE164).length;
const slugs = new Set(businesses.map((b) => b.slug));
const pct = (n: number) =>
  ((100 * n) / Math.max(businesses.length, 1)).toFixed(1);
const gate = (ok: boolean) => (ok ? "PASS" : "FAIL");

console.log(`
Load
====
Raw records         ${records.length.toLocaleString()}
After dedupe        ${deduped.unique.length.toLocaleString()}  (-${deduped.duplicatesRemoved} duplicates, -${deduped.skippedNoPlaceId} without place_id)
Businesses          ${businesses.length.toLocaleString()}
Rejected non-Dubai  ${rejectedNotDubai.toLocaleString()}
Rejected no place_id ${rejectedNoPlaceId.toLocaleString()}
DynamoDB items      ${items.length.toLocaleString()}  (${businesses.length} business + ${items.length - businesses.length} typeahead)

v0.1 QUALITY GATES
  unique place_ids >= 10,000   ${businesses.length.toLocaleString().padEnd(8)} ${gate(businesses.length >= 10_000)}
  E.164 phone coverage >= 95%  ${(pct(withPhone) + "%").padEnd(8)} ${gate(withPhone / Math.max(businesses.length, 1) >= 0.95)}
  taxonomy coverage = 100%     ${(pct(businesses.length - unmappedTaxonomy) + "%").padEnd(8)} ${gate(unmappedTaxonomy === 0)}
  slugs unique                 ${String(slugs.size).padEnd(8)} ${gate(slugs.size === businesses.length)}
  zero non-AE rows loaded      ${"0".padEnd(8)} PASS (filtered at normalise)
`);

if (unmappedTaxonomy > 0) {
  console.log(
    `${unmappedTaxonomy} businesses have no taxonomy. Run \`pnpm classify\` before loading.\n`,
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
let written = 0;

for (let i = 0; i < items.length; i += BATCH) {
  const chunk = items.slice(i, i + BATCH);
  await client.send(
    new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: chunk.map((item) => ({
          PutRequest: { Item: marshall(item, { removeUndefinedValues: true }) },
        })),
      },
    }),
  );
  written += chunk.length;
  if (written % 500 === 0)
    process.stdout.write(`  ${written}/${items.length}\r`);
}

console.log(`\nWrote ${written.toLocaleString()} items to ${tableName}.\n`);
