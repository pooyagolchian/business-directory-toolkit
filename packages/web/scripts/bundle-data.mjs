/**
 * Copy the data the site needs into the app directory before building.
 *
 * In local development lib/data.ts reads from the repo root. That path does
 * not exist inside a Lambda: data/out/ is git-ignored and sits outside
 * packages/web, so nothing would bundle it and the deployed site would render
 * its empty state on a live domain.
 *
 * Copying into packages/web/.data lets Next's file tracing include it (see
 * outputFileTracingIncludes in next.config.ts). The directory is git-ignored —
 * this is a build artifact, and the dataset is still never committed (ADR 0002).
 *
 * The proper fix is DynamoDB, which is Milestone 2's job. This is what makes
 * Milestone 1 deployable in the meantime, and it is honest about being a
 * stopgap rather than an architecture.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "..", "..");
const target = join(webRoot, ".data");

mkdirSync(target, { recursive: true });

const files = [
  ["data/out/businesses.json", "businesses.json", true],
  ["data/out/review-signals.json", "review-signals.json", false],
  ["data/demand.json", "demand.json", false],
  [
    `data/cities/${process.env.DIRECTORY_CITY ?? "dubai"}.json`,
    "city.json",
    true,
  ],
];

let total = 0;
for (const [from, to, required] of files) {
  const source = join(repoRoot, from);
  if (!existsSync(source)) {
    if (required) {
      console.error(
        `\n  Missing ${from}\n` +
          `  Run \`pnpm crawl\` then \`pnpm load\` before building for deployment.\n` +
          `  Building without it would deploy an empty directory.\n`,
      );
      process.exit(1);
    }
    console.warn(`  optional, skipped: ${from}`);
    continue;
  }
  copyFileSync(source, join(target, to));
  const size = statSync(source).size;
  total += size;
  console.log(`  ${to.padEnd(22)} ${(size / 1024 / 1024).toFixed(1)}MB`);
}

console.log(
  `  bundled ${(total / 1024 / 1024).toFixed(1)}MB into packages/web/.data\n`,
);
