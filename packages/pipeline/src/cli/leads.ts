/**
 * Find and rank prospects from your own crawl.
 *
 *   pnpm leads --list-signals
 *   pnpm leads --signal no-website --category Restaurants --min-reviews 20
 *   pnpm leads --signal weak-reputation --format csv --out leads.csv
 *
 * Both `--name value` and `--name=value` are accepted for every flag.
 *
 * Reads data/out/businesses.json. No network, no credits.
 *
 * Exactly one --signal is accepted. Scores are comparable only within a
 * signal: a no-website score and a weak-reputation score describe different
 * products sold to different buyers, so ranking them together is meaningless.
 *
 * FAILING CLOSED IS THE POINT of everything below the imports. A six-lens
 * review found that this CLI's actual failure mode was never a crash — it was
 * exiting 0 with a plausible-looking wrong answer: `--limit=10` silently
 * ignored (the `=` form was never parsed), `--limit 0` silently dropping the
 * cap entirely, a missing suppression list silently producing an unfiltered
 * cold-call list while printing "0 withheld". Every validation here exists to
 * turn one of those into a loud, specific refusal instead.
 */
import { createWriteStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  corpusPrior,
  findLeads,
  parseSuppressionList,
  LEAD_SIGNALS,
  type Business,
  type LeadSignal,
} from "@directory/core";
import { BUSINESS_COLUMNS, CSV_BOM, csvRow } from "../csv";

/**
 * The CSV header row: the shared export contract (`BUSINESS_COLUMNS`) plus
 * the three lead-specific columns. Exported so the smoke test can assert
 * this contract directly — a pure constant needs no subprocess and no local
 * crawl on disk, unlike running the CLI end-to-end would.
 */
export const LEAD_CSV_HEADER = [
  ...BUSINESS_COLUMNS,
  "signal",
  "score",
  "reason",
] as const;

/**
 * Read and parse the suppression list at `path`.
 *
 * This used to treat ENOENT as "no takedowns yet" — reasoning that a fork of
 * this toolkit wouldn't ship one by default. That reasoning was wrong:
 * `git ls-files data/` shows `data/suppression-list.json` IS tracked, so
 * every clone and fork has it. The only way to reach a missing file in a real
 * checkout is that someone deleted it or failed to check it out — precisely
 * when silently continuing is unsafe, not when it's fine. So this function no
 * longer swallows ENOENT: it propagates whatever `readFileSync` or
 * `parseSuppressionList` throws, and the caller (`main`) decides how to
 * report it. `parseSuppressionList` already throws deliberately on malformed
 * input (bad JSON, a non-string entry — see suppression.ts) so a typo
 * introduced while hand-editing a takedown request can't quietly go
 * unnoticed; a missing file now gets the same treatment, matching how
 * `load.ts` treats the same absence as fatal.
 *
 * Exported for the same reason as `LEAD_CSV_HEADER`: this is a piece of the
 * CLI worth unit-testing directly rather than only through a subprocess,
 * since the CLI's own suppression path is fixed relative to the repo root
 * and a test must not write to it.
 */
export function loadSuppressionList(path: string): Set<string> {
  return parseSuppressionList(readFileSync(path, "utf8"));
}

/**
 * Why the businesses file couldn't be loaded, so `main` can react differently
 * to each: a missing file gets pointed at the crawl commands, a corrupt one
 * gets pointed at the free repair (`pnpm load` / `pnpm load --from-archive`)
 * instead of `pnpm crawl --yes`, which spends real SearchApi credits.
 */
export type BusinessesFileErrorKind = "missing" | "corrupt";

export class BusinessesFileError extends Error {
  readonly kind: BusinessesFileErrorKind;
  constructor(message: string, kind: BusinessesFileErrorKind) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Read and parse data/out/businesses.json at `path`.
 *
 * A truncated write from an interrupted `pnpm load` and a genuinely absent
 * file used to look identical to callers — one bare try/catch around
 * `readFileSync` + `JSON.parse` turned both into "No data/out/businesses.json.
 * Run `pnpm crawl --yes`...", which sends someone with a merely-corrupt file
 * to the one command in this repo that spends real money (CLAUDE.md budgets
 * ~2,000 credits for the Dubai crawl) to fix something `pnpm load
 * --from-archive` would solve for free. This function distinguishes the two
 * so `main` can point at the right remedy, and separately validates the
 * parsed value is an array — a non-array JSON file (e.g. `{}`) used to crash
 * deep inside `corpusPrior` with a raw `TypeError: businesses is not
 * iterable`, which is correct in the sense of failing closed but useless as
 * a diagnosis.
 *
 * Kept as a pure function (throws, never exits) rather than folded into
 * `main`, so it can be unit-tested with a temp file instead of the real,
 * gitignored, ~15,000-row dataset that six other sessions may be using.
 */
export function loadBusinesses(path: string): Business[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BusinessesFileError(`${path} does not exist.`, "missing");
    }
    throw new BusinessesFileError(
      `${path} could not be read: ${(error as Error).message}`,
      "corrupt",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new BusinessesFileError(
      `${path} is not valid JSON: ${(error as Error).message}`,
      "corrupt",
    );
  }

  if (!Array.isArray(parsed)) {
    throw new BusinessesFileError(
      `${path} is valid JSON but not an array of businesses.`,
      "corrupt",
    );
  }

  return parsed as Business[];
}

/**
 * Every flag this CLI understands. `--list-signals` is a bare switch; every
 * other flag requires a value. Kept as one list so an unknown flag can be
 * checked against it AND used to suggest the closest real one — a typo like
 * `--categories` or `--min-review` otherwise returns the complete unfiltered
 * list at exit 0, which is indistinguishable from a working filter that
 * happened to match everything.
 */
const KNOWN_FLAGS = [
  "--list-signals",
  "--signal",
  "--category",
  "--area",
  "--min-reviews",
  "--min-rating",
  "--limit",
  "--format",
  "--out",
] as const;
const KNOWN_FLAG_SET = new Set<string>(KNOWN_FLAGS);

interface FlagToken {
  name: string;
  value: string | undefined;
}

/**
 * Split argv into `--name`/value pairs, accepting both `--name value` and
 * `--name=value`.
 *
 * The original parser only matched the space form via `argv.indexOf`, so
 * `--limit=10` was never found at all — `flag("--limit")` returned
 * `undefined`, the cap silently dropped, and the CLI printed a confident
 * "3,820 leads" at exit 0. Both forms are common enough (`--format=csv --out
 * leads.csv` is a natural thing to type) that only supporting one is a trap,
 * not a simplification.
 */
function tokenize(argv: readonly string[]): FlagToken[] {
  const tokens: FlagToken[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;

    const eq = arg.indexOf("=");
    if (eq !== -1) {
      tokens.push({ name: arg.slice(0, eq), value: arg.slice(eq + 1) });
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      tokens.push({ name: arg, value: next });
      i++; // consumed as this flag's value, not a flag of its own
    } else {
      tokens.push({ name: arg, value: undefined });
    }
  }
  return tokens;
}

/** Cheap edit distance, used only to suggest a fix for an unknown flag against nine known ones. */
function levenshtein(a: string, b: string): number {
  const dp: number[] = [];
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0] ?? i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j] ?? 0;
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j] ?? 0, dp[j - 1] ?? 0);
      prev = temp;
    }
  }
  return dp[b.length] ?? Math.max(a.length, b.length);
}

function closestFlag(name: string): string {
  let best: string = KNOWN_FLAGS[0];
  let bestDistance = Infinity;
  for (const candidate of KNOWN_FLAGS) {
    const distance = levenshtein(name, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function reportUnknownFlag(name: string): never {
  console.error(
    `\nUnknown flag ${name}. Did you mean ${closestFlag(name)}?\n` +
      `Known flags: ${KNOWN_FLAGS.join(", ")}\n`,
  );
  process.exit(1);
}

/**
 * Require a non-empty value for a flag that was actually typed.
 *
 * Two silent-widening bugs collapse into one check here: a flag given with
 * no value at all (`--limit` at the end of argv, or immediately followed by
 * another flag) and a flag given an explicit empty string (`--category ""`
 * from an unset shell variable) both used to sail through — `flag()` handed
 * back `undefined` or `""`, the surrounding `x ? {...} : {}` spread treated
 * either as "flag not given", and the query silently widened to match
 * everything. Both are rejected here instead.
 */
function requireValue(token: FlagToken): string {
  if (token.value === undefined) {
    console.error(`\n${token.name} requires a value.\n`);
    process.exit(1);
  }
  if (token.value === "") {
    console.error(
      `\n${token.name} was given an empty value, which would silently widen ` +
        `the filter to match everything rather than narrow it. Pass a real ` +
        `value or omit the flag entirely.\n`,
    );
    process.exit(1);
  }
  return token.value;
}

interface NumericConstraint {
  min?: number;
  max?: number;
  integer?: boolean;
  /** Human description of the valid range, so the error names what's expected. */
  description: string;
}

/**
 * Validate a numeric flag rather than trusting bare `Number()`.
 *
 * The bug this replaces: `Number()` plus a truthiness gate accepted `0`
 * (falsy, so the cap silently dropped), negative numbers (`--limit -5` became
 * `slice(0, -5)`, silently discarding the 5 LOWEST-scoring leads instead of
 * capping the list), and non-numeric garbage (`--min-rating abc` became
 * `NaN`, and `x < NaN` is always `false`, so the filter matched everything —
 * identical to omitting it, at exit 0).
 */
function parseNumericFlag(
  name: string,
  raw: string,
  constraint: NumericConstraint,
): number {
  const n = Number(raw);
  const bad =
    !Number.isFinite(n) ||
    (constraint.integer === true && !Number.isInteger(n)) ||
    (constraint.min !== undefined && n < constraint.min) ||
    (constraint.max !== undefined && n > constraint.max);
  if (bad) {
    console.error(
      `\n${name} expects ${constraint.description}, got "${raw}".\n`,
    );
    process.exit(1);
  }
  return n;
}

const VALID_FORMATS = new Set(["table", "csv", "json"]);

/**
 * Everything below is side-effecting — argv parsing, file reads, exits — so
 * it lives behind `main()` rather than at module scope. Importing this file
 * (the smoke test does, for `LEAD_CSV_HEADER`, `loadSuppressionList`, and
 * `loadBusinesses`) must not also run the CLI; only invoking it as a script
 * should.
 */
function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--list-signals")) {
    console.log(`\nAvailable signals:\n`);
    console.log(`  no-website        No website listed — web design, agencies`);
    console.log(
      `  weak-reputation   Rated under 3.8 with 20+ reviews — reputation management`,
    );
    console.log(
      `  low-visibility    Fewer than 10 reviews — local SEO, review generation`,
    );
    console.log(
      `  no-hours          No opening hours listed — listing management\n`,
    );
    process.exit(0);
  }

  const tokens = tokenize(argv);

  // Everything below validates INPUT ONLY — no file on disk is read yet. That
  // is deliberate, not incidental: it means every one of these checks can be
  // exercised in CI, where data/out/businesses.json does not exist (ADR
  // 0002), without that absence masking whether the check itself works.
  for (const token of tokens) {
    if (!KNOWN_FLAG_SET.has(token.name)) reportUnknownFlag(token.name);
  }
  for (const token of tokens) {
    if (token.name === "--list-signals") continue; // a bare switch, no value expected
    requireValue(token);
  }

  const flagValue = (name: string): string | undefined =>
    tokens.find((t) => t.name === name)?.value;

  // Counted rather than just read: taking only the first match would
  // silently score "a" while the user believes both were considered.
  // Discarding a flag the user typed is worse than rejecting it outright.
  const signalCount = tokens.filter((t) => t.name === "--signal").length;
  const signal = flagValue("--signal") as LeadSignal | undefined;
  if (signalCount > 1) {
    console.error(
      `\nExactly one --signal is accepted (got ${signalCount}). Scores are ` +
        `not comparable across signals, so combining them would rank two ` +
        `different sales conversations against each other.\n` +
        `Valid signals: ${LEAD_SIGNALS.join(", ")}\n`,
    );
    process.exit(1);
  }
  if (!signal || !LEAD_SIGNALS.includes(signal)) {
    console.error(
      `\n--signal is required and must be one of: ${LEAD_SIGNALS.join(", ")}\n` +
        `Run \`pnpm leads --list-signals\` for what each one means.\n`,
    );
    process.exit(1);
  }

  const limitRaw = flagValue("--limit");
  const limit =
    limitRaw === undefined
      ? undefined
      : parseNumericFlag("--limit", limitRaw, {
          min: 1,
          integer: true,
          description: "a whole number of at least 1",
        });

  const minReviewsRaw = flagValue("--min-reviews");
  const minReviews =
    minReviewsRaw === undefined
      ? undefined
      : parseNumericFlag("--min-reviews", minReviewsRaw, {
          min: 0,
          description: "a number of 0 or more",
        });

  const minRatingRaw = flagValue("--min-rating");
  const minRating =
    minRatingRaw === undefined
      ? undefined
      : parseNumericFlag("--min-rating", minRatingRaw, {
          min: 0,
          max: 5,
          description: "a number between 0 and 5 (Google's rating scale)",
        });

  const category = flagValue("--category");
  const area = flagValue("--area");
  const outPath = flagValue("--out");

  const formatRaw = flagValue("--format");
  const format = (formatRaw ?? "table").toLowerCase();
  if (!VALID_FORMATS.has(format)) {
    // Matches export.ts's own unknown-format handling: exit 1 rather than
    // the silent fallback this CLI used to have, where `--format cvs --out
    // leads.csv` wrote 40 padded terminal rows into a file the user believed
    // held every CSV record.
    console.error(
      `\nUnknown --format "${formatRaw}". Use table, csv, or json.\n`,
    );
    process.exit(1);
  }

  const root = new URL("../../../../", import.meta.url);

  let businesses: Business[];
  try {
    businesses = loadBusinesses(
      fileURLToPath(new URL("data/out/businesses.json", root)),
    );
  } catch (error) {
    if (error instanceof BusinessesFileError && error.kind === "missing") {
      console.error(
        "\nNo data/out/businesses.json. Run `pnpm crawl --yes` then `pnpm load`,\n" +
          "or `pnpm load --from-archive` to rebuild from responses already fetched.\n",
      );
    } else {
      console.error(
        `\n${(error as Error).message}\n\n` +
          "This is a corrupt or truncated file, not a missing one — often the\n" +
          "result of an interrupted `pnpm load`. Re-run `pnpm load` (or `pnpm\n" +
          "load --from-archive` if data/out/raw-records.json is gone too) to\n" +
          "rebuild it for free. This does NOT require `pnpm crawl --yes`, which\n" +
          "spends real SearchApi credits.\n",
      );
    }
    process.exit(1);
  }

  // Suppression is not optional. A missing list used to be treated as an
  // empty one — see the comment on loadSuppressionList for why that was
  // wrong — so its absence is now a hard stop, matching load.ts.
  let suppressed: Set<string>;
  try {
    suppressed = loadSuppressionList(
      fileURLToPath(new URL("data/suppression-list.json", root)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        "\ndata/suppression-list.json is missing. This file IS tracked in git\n" +
          "(`git ls-files data/` confirms every clone and fork has it), so its\n" +
          "absence means something is wrong with this checkout — not that no\n" +
          "takedowns exist yet. Continuing would produce a full, unfiltered\n" +
          'call list while reporting "0 withheld", which looks identical to a\n' +
          "successful filter run. Restore the file — an empty `[]` is the\n" +
          "correct state when there are no takedowns — before running this again.\n",
      );
    } else {
      console.error(
        `\ndata/suppression-list.json could not be loaded: ${(error as Error).message}\n` +
          "A malformed takedown list is a hard stop rather than an empty one,\n" +
          "on purpose: see the comment on loadSuppressionList.\n",
      );
    }
    process.exit(1);
  }

  const result = findLeads(businesses, {
    signal,
    // Built from the WHOLE corpus, not the filtered subset: a prior that
    // rescales per query makes scores incomparable between runs.
    prior: corpusPrior(businesses),
    suppressed,
    ...(category ? { category } : {}),
    ...(area ? { area } : {}),
    ...(minReviews !== undefined ? { minReviews } : {}),
    ...(minRating !== undefined ? { minRating } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });

  const stream = outPath ? createWriteStream(outPath) : process.stdout;

  const TABLE_ROWS = 40;
  if (format === "csv") {
    stream.write(CSV_BOM);
    stream.write(csvRow(LEAD_CSV_HEADER));
    for (const lead of result.leads) {
      stream.write(
        csvRow([
          ...BUSINESS_COLUMNS.map((c) => lead.business[c as keyof Business]),
          lead.signal,
          lead.score.toFixed(3),
          lead.reason,
        ]),
      );
    }
  } else if (format === "json") {
    stream.write(JSON.stringify(result.leads, null, 2) + "\n");
  } else {
    for (const lead of result.leads.slice(0, TABLE_ROWS)) {
      stream.write(
        `${lead.score.toFixed(2).padStart(5)}  ${(lead.business.phoneRaw ?? "no phone").padEnd(16)} ` +
          `${(lead.business.title ?? "").slice(0, 44).padEnd(46)} ${lead.reason}\n`,
      );
    }
  }

  if (outPath) stream.end();

  // The table view hard-caps at 40 rows for a readable terminal screen, but
  // the summary below reports the FULL count regardless of format — so
  // without this line, `--limit 100` in table mode printed 40 rows under a
  // banner reading "100 leads", and the two numbers contradicted each other.
  const truncationNotice =
    format === "table" && result.leads.length > TABLE_ROWS
      ? `\nShowing the top ${TABLE_ROWS} of ${result.leads.length.toLocaleString()} by score — pass --format csv or --format json for the full list.\n`
      : "";

  // Everything below goes to stderr so `pnpm leads --format csv > file.csv`
  // stays clean.
  //
  // The withheld count prints unconditionally, including "0 withheld" — the
  // point of reporting it at all is that the takedown filter is visibly
  // working, not silently trusted. A line that only appears when there is
  // something to hide would read as the filter mattering only when it bites.
  console.error(`
${result.leads.length.toLocaleString()} leads · signal "${signal}" · ${result.considered.toLocaleString()} businesses considered
${result.suppressed.toLocaleString()} withheld by the suppression list (takedown requests).
${truncationNotice}
These are business listings, not permission to contact. Unsolicited commercial
messaging is regulated wherever these businesses operate — this toolkit is not
scoped to one jurisdiction (a city here is data, not code), so check the rules
that apply to YOUR crawl before you use this list.
`);
}

// Run only when executed as a script (`tsx leads.ts` / `pnpm leads`), not when
// imported — the smoke test imports LEAD_CSV_HEADER, loadSuppressionList, and
// loadBusinesses without wanting argv parsed or process.exit called on its
// behalf.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
