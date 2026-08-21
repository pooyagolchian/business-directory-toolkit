/**
 * Stage 3 — classify the distinct category vocabulary.
 *
 *   pnpm classify --dry-run   report what would be sent and what it would cost
 *   pnpm classify --yes       call the model and update data/taxonomy-map.json
 *
 * The model only ever sees a category string once, across every crawl this
 * project will ever run. A re-run over a bigger corpus that introduces no new
 * categories costs nothing at all.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  distinctCategories,
  type RawLocalResult,
  type TaxonomyMap,
} from "@directory/core";
import {
  batchCategories,
  buildClassificationPrompt,
  categoriesNeedingClassification,
  estimateCost,
  mergeTaxonomy,
  parseClassification,
} from "../classify";

const MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 50;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const confirmed = argv.includes("--yes");

const root = new URL("../../../../", import.meta.url);
const mapPath = fileURLToPath(new URL("data/taxonomy-map.json", root));
const recordsPath = fileURLToPath(new URL("data/out/raw-records.json", root));

let records: RawLocalResult[];
try {
  records = JSON.parse(readFileSync(recordsPath, "utf8")) as RawLocalResult[];
} catch {
  console.error(
    `No crawl output at data/out/raw-records.json. Run \`pnpm crawl\` first.\n`,
  );
  process.exit(1);
}

const existing = JSON.parse(readFileSync(mapPath, "utf8")) as TaxonomyMap;
const distinct = distinctCategories(records);
const todo = categoriesNeedingClassification(distinct, existing);
const batches = batchCategories(todo, BATCH_SIZE);

console.log(`
Classify
========
Businesses in corpus     ${records.length.toLocaleString()}
Distinct categories      ${distinct.length.toLocaleString()}
Already mapped           ${(distinct.length - todo.length).toLocaleString()}
Need classification      ${todo.length.toLocaleString()}
Requests to the model    ${batches.length}

Ratio: ${(distinct.length / Math.max(records.length, 1)).toFixed(3)} distinct categories per business.
This is the number that decides whether classifying categories instead of
businesses actually pays off. Publish it whichever way it lands.
`);

if (todo.length === 0) {
  console.log(
    "Nothing to classify — the committed map already covers this corpus.",
  );
  console.log("Marginal cost of this crawl's taxonomy: $0.0000\n");
  process.exit(0);
}

if (dryRun) {
  const sample = buildClassificationPrompt(todo.slice(0, BATCH_SIZE), []);
  console.log(
    `Estimated prompt size: ~${Math.round(sample.length / 4).toLocaleString()} tokens per batch`,
  );
  console.log("--dry-run: nothing was sent and nothing was spent.\n");
  process.exit(0);
}

if (!confirmed) {
  console.error("Refusing to call the model without --yes.\n");
  process.exit(1);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set.\n");
  process.exit(1);
}

const client = new Anthropic({ apiKey });
const knownL2 = [...new Set(Object.values(existing).map((n) => n.l2))].sort();

let discovered: TaxonomyMap = {};
let inputTokens = 0;
let outputTokens = 0;

for (const [index, batch] of batches.entries()) {
  process.stdout.write(
    `  batch ${index + 1}/${batches.length} (${batch.length} categories)… `,
  );

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8_000,
    messages: [
      { role: "user", content: buildClassificationPrompt(batch, knownL2) },
    ],
  });

  inputTokens += response.usage.input_tokens;
  outputTokens += response.usage.output_tokens;

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const parsed = parseClassification(text);
  discovered = { ...discovered, ...parsed };
  console.log(`${Object.keys(parsed).length} mapped`);
}

// Existing entries always win: the committed map carries human corrections.
const merged = mergeTaxonomy(existing, discovered);
const sorted = Object.fromEntries(
  Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(mapPath, `${JSON.stringify(sorted, null, 2)}\n`);

const cost = estimateCost({ inputTokens, outputTokens });
const stillUnmapped = todo.filter((c) => !merged[c]);

console.log(`
Done
====
Newly mapped        ${Object.keys(discovered).length}
Map total           ${Object.keys(merged).length}
Still unmapped      ${stillUnmapped.length}${stillUnmapped.length ? ` — ${stillUnmapped.slice(0, 5).join(", ")}` : ""}

Cost                ${cost.breakdown}
Per 1,000 businesses $${((cost.usd / Math.max(records.length, 1)) * 1000).toFixed(4)}

Re-running over a larger crawl costs nothing for categories already in the map.

Next: pnpm load
`);
