/**
 * Measure whether AI answer engines cite this deployment — and who they cite
 * instead.
 *
 *   pnpm visibility --dry-run    show the request count and credit cost
 *   pnpm visibility --yes        spend credits and write data/visibility.json
 *
 * WHY THIS EXISTS
 *
 * Every SEO number this repo reports assumes a ranked list of links. A growing
 * share of local-business queries never reaches one: they are answered inline
 * by ChatGPT, Perplexity, Google AI Mode and AI Overviews, from a few cited
 * sources. There is no position 4 on those surfaces — you are cited or you are
 * invisible — and no rank tracker can tell you which, because it is watching a
 * different surface.
 *
 * A baseline of zero is a legitimate result and the expected one for a new
 * deployment. The half that pays from day one is the other half: every response
 * names its sources, so this also reports WHICH domains own the answers to
 * local-business questions in this city.
 *
 * The output is derived query data — queries, engine names, cited URLs, domain
 * tallies. No business listings, no phone numbers, no personal data. That is
 * why data/visibility.json is committed and data/out/businesses.json is not
 * (ADR 0002), and it is the same reasoning that lets data/demand.json ship.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  citationsFrom,
  scoreProbe,
  selectProbes,
  summarise,
  type DemandInput,
  type ProbeResult,
  type VisibilityEngine,
} from "@directory/core";

const ENDPOINT = "https://www.searchapi.io/api/v1/search";

/**
 * One request each. `google_ai_overview` is NOT here on purpose — it needs a
 * prior `google` call for a page_token, so it costs two, and that token expires
 * in under a minute. Different cost, different error contract; it goes behind
 * --ai-overview rather than onto the common path.
 */
const DEFAULT_ENGINES: VisibilityEngine[] = [
  "chatgpt",
  "perplexity",
  "google_ai_mode",
];

const DEFAULT_QUERIES = 20;

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(name);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const dryRun = has("--dry-run");
const confirmed = has("--yes");
const withOverview = has("--ai-overview");
const queryLimit = Number(flag("--queries") ?? DEFAULT_QUERIES);

if (!Number.isInteger(queryLimit) || queryLimit < 1) {
  console.error("\n--queries must be a positive integer.\n");
  process.exit(1);
}

const root = new URL("../../../../", import.meta.url);
const readRoot = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, root)), "utf8");

const site = (
  process.env.DIRECTORY_SITE_URL ?? "https://directory.pooyagolchian.com"
)
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .replace(/^www\./, "");

let demand: DemandInput[];
try {
  demand = JSON.parse(readRoot("data/demand.json")) as DemandInput[];
} catch {
  console.error(
    "\nNo data/demand.json. Run `pnpm demand --yes` first — the probe queries\n" +
      "come from real Google autocomplete demand, not from a list made up here.\n",
  );
  process.exit(1);
}

const probes = selectProbes(demand, queryLimit);
const engines = withOverview
  ? [...DEFAULT_ENGINES, "google_ai_overview" as const]
  : DEFAULT_ENGINES;

// AI Overview is two requests per query: one `google` call for the page_token,
// then the overview itself.
const requests =
  probes.length * DEFAULT_ENGINES.length +
  (withOverview ? probes.length * 2 : 0);

console.log(`
AI visibility — ${site}
${"=".repeat(16 + site.length)}

Queries               ${probes.length}   (most-searched suggestion per category, from data/demand.json)
Engines               ${engines.join(", ")}
Requests              ${requests}${withOverview ? "   (AI Overview needs a page_token call first)" : ""}
Credits               ${requests}

A baseline of zero citations is the expected result for a new deployment. The
domains this reports INSTEAD are the useful half: who owns these answers today.
`);

if (dryRun) {
  console.log("--dry-run: nothing was requested and nothing was spent.\n");
  console.log("Sample probes:");
  for (const p of probes.slice(0, 5))
    console.log(`  ${p.category.padEnd(18)} "${p.query}"`);
  console.log();
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

async function call(params: Record<string, string>): Promise<unknown> {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // The key travels in the header, never the query string, so it cannot land in
  // an access log or an error trace. Same rule as searchapi.ts.
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * AI Overview, in two legs. The page_token expires in under a minute, so the
 * second call goes out immediately after the first — no batching, no retry
 * across the pair. A retry would fail on an expired token rather than on
 * whatever actually went wrong, which is a misleading error to log.
 */
async function aiOverview(query: string): Promise<unknown> {
  const first = (await call({
    engine: "google",
    q: query,
    gl: "ae",
    hl: "en",
  })) as {
    ai_overview?: { page_token?: string };
  };
  const token = first?.ai_overview?.page_token;
  if (!token) return { ai_overview: null };
  return call({ engine: "google_ai_overview", page_token: token });
}

const results: ProbeResult[] = [];
const errors: string[] = [];
let spent = 0;

for (const [index, probe] of probes.entries()) {
  for (const engine of engines) {
    process.stdout.write(
      `  ${index + 1}/${probes.length} ${engine.padEnd(19)} ${probe.query.slice(0, 40).padEnd(40)}\r`,
    );
    try {
      const response =
        engine === "google_ai_overview"
          ? await aiOverview(probe.query)
          : await call({ engine, q: probe.query });
      spent += engine === "google_ai_overview" ? 2 : 1;
      results.push(scoreProbe(probe, engine, citationsFrom(response), site));
    } catch (error) {
      spent += engine === "google_ai_overview" ? 2 : 1;
      errors.push(
        `${engine} "${probe.query}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const summary = summarise(results);

mkdirSync(fileURLToPath(new URL("data/", root)), { recursive: true });
writeFileSync(
  fileURLToPath(new URL("data/visibility.json", root)),
  `${JSON.stringify({ measuredAt: new Date().toISOString(), site, engines, probes: results, summary }, null, 2)}\n`,
);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log(`
Done
====
Probes                ${summary.probes}
Credits spent         ${spent}
Cited                 ${summary.cited}  (${pct(summary.citationRate)})
Probes with 0 sources ${summary.probesWithNoCitations}${summary.probesWithNoCitations > 0 ? "   <- check the response shape has not drifted" : ""}
Errors                ${errors.length}

By engine`);
for (const [engine, b] of Object.entries(summary.byEngine)) {
  console.log(`  ${engine.padEnd(20)} ${b.cited}/${b.probes} cited`);
}

console.log(`
Who owns these answers instead`);
for (const d of summary.topDomains.slice(0, 10)) {
  console.log(
    `  ${d.domain.padEnd(34)} ${String(d.citations).padStart(3)}  ${pct(d.share)}`,
  );
}

console.log(`
Written to data/visibility.json — committed, because it is derived query data
rather than business listings (ADR 0002).

Read the rate with the sample size attached, never as a bare percentage: AI
answers are non-deterministic, so a delta of one or two citations across ${summary.probes}
probes is noise, not movement.
`);

for (const error of errors.slice(0, 5)) console.log(`  ${error}`);
