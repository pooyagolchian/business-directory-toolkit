import Anthropic from "@anthropic-ai/sdk";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { resources } from "../resources";
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
const MAP_KEY = "taxonomy/taxonomy-map.json";

const s3 = new S3Client({});

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const object = await s3.send(
      new GetObjectCommand({ Bucket: resources.RawArchive.name, Key: key }),
    );
    const body = await object.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Classify the distinct category vocabulary of one crawl run.
 *
 * The model sees each category string exactly once, ever. A later, larger crawl
 * that introduces no new categories costs nothing — that amortisation is the
 * entire point, and the returned figures are what gets published.
 */
export async function handler(event: { runId: string }): Promise<{
  distinct: number;
  newlyMapped: number;
  stillUnmapped: string[];
  usd: number;
}> {
  const listed = await s3.send(
    new ListObjectsV2Command({
      Bucket: resources.RawArchive.name,
      Prefix: `raw/${event.runId}/`,
    }),
  );

  const records: RawLocalResult[] = [];
  for (const object of listed.Contents ?? []) {
    if (!object.Key) continue;
    const page = await readJson<{ local_results?: RawLocalResult[] }>(
      object.Key,
      {},
    );
    records.push(...(page.local_results ?? []));
  }

  const existing = await readJson<TaxonomyMap>(MAP_KEY, {});
  const distinct = distinctCategories(records);
  const todo = categoriesNeedingClassification(distinct, existing);

  if (todo.length === 0) {
    return {
      distinct: distinct.length,
      newlyMapped: 0,
      stillUnmapped: [],
      usd: 0,
    };
  }

  const client = new Anthropic({ apiKey: resources.AnthropicApiKey.value });
  const knownL2 = [...new Set(Object.values(existing).map((n) => n.l2))].sort();

  let discovered: TaxonomyMap = {};
  let inputTokens = 0;
  let outputTokens = 0;

  for (const batch of batchCategories(todo, BATCH_SIZE)) {
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
    discovered = { ...discovered, ...parseClassification(text) };
  }

  // Existing entries win — the stored map carries human corrections.
  const merged = mergeTaxonomy(existing, discovered);
  await s3.send(
    new PutObjectCommand({
      Bucket: resources.RawArchive.name,
      Key: MAP_KEY,
      Body: JSON.stringify(merged, null, 2),
      ContentType: "application/json",
    }),
  );

  const cost = estimateCost({ inputTokens, outputTokens });
  console.log(cost.breakdown);

  return {
    distinct: distinct.length,
    newlyMapped: Object.keys(discovered).length,
    stillUnmapped: todo.filter((c) => !merged[c]),
    usd: cost.usd,
  };
}
