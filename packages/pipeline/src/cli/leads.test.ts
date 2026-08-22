/**
 * Smoke test only.
 *
 * `findLeads`, `detectSignals`, `leadScore`, and the prior itself are fully
 * covered in packages/core/src/leads.test.ts — this file does not repeat that
 * work. What it proves is that the CLI wires those pieces together
 * correctly, and specifically guards the failure modes a six-lens review
 * found: this CLI's actual bug was never a crash, it was exiting 0 with a
 * plausible-looking WRONG answer (a limit silently dropped, a suppression
 * list silently skipped, an unrecognised flag silently ignored). Asserting
 * only "exits non-zero" cannot tell such a bug apart from the guard being
 * deleted entirely — see the note on the two --signal tests below, which is
 * exactly what a review caught.
 *
 * Every argv-validation check in leads.ts (unknown flags, empty values,
 * --signal, numeric ranges, --format) runs BEFORE any file on disk is read.
 * That ordering is deliberate, not incidental: it means every test below can
 * run in CI, where data/out/businesses.json does not exist (ADR 0002: the
 * dataset is never committed) — each one either exits before that file would
 * be read, or exercises a pure export (loadSuppressionList, loadBusinesses)
 * directly instead of spawning the CLI at all.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { BUSINESS_COLUMNS } from "../csv";
import {
  BusinessesFileError,
  LEAD_CSV_HEADER,
  loadBusinesses,
  loadSuppressionList,
} from "./leads";

const TSX = fileURLToPath(
  new URL("../../../../node_modules/.bin/tsx", import.meta.url),
);
const CLI = fileURLToPath(new URL("./leads.ts", import.meta.url));

function runCli(args: string[]): string {
  return execFileSync(TSX, [CLI, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Run the CLI expecting a non-zero exit, and return its stderr.
 *
 * Asserting on stderr TEXT rather than merely "exits non-zero" is the whole
 * point of this helper. A review found that both --signal guard tests passed
 * even with their guards deleted, because in CI the CLI exits non-zero
 * anyway once it reaches the businesses.json read (that file is gitignored,
 * so it's always absent there) — the assertion never actually exercised the
 * guard it claimed to. Checking the specific message closes that gap: the
 * guard's error text can only appear if the guard itself ran, and it must run
 * before any file read for the message to be reachable at all in CI.
 */
function runCliExpectFailure(args: string[]): {
  status: number | null;
  stderr: string;
} {
  try {
    execFileSync(TSX, [CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      status?: number | null;
      stderr?: string;
    };
    return { status: err.status ?? null, stderr: err.stderr ?? "" };
  }
  throw new Error(
    `Expected the CLI to exit non-zero for ${JSON.stringify(args)}, but it exited 0.`,
  );
}

describe("pnpm leads", () => {
  test("--list-signals exits 0 and names every signal", () => {
    const stdout = runCli(["--list-signals"]);
    for (const signal of [
      "no-website",
      "weak-reputation",
      "low-visibility",
      "no-hours",
    ]) {
      expect(stdout).toContain(signal);
    }
  });

  describe("the --signal guards (finding 3)", () => {
    // These two tests used to assert only `.toThrow()` (a non-zero exit).
    // Deleting BOTH guards in leads.ts and re-running this file still left
    // both tests green, because in CI (no data/out/businesses.json) the CLI
    // exits non-zero anyway once it reaches the file read a few lines later
    // — the assertion was satisfied by an unrelated failure, not by the
    // guard. Asserting on the guard's own stderr text closes that gap: this
    // text is only reachable if the guard itself fired, and it is emitted
    // before any file read (see the module doc comment), so it is reachable
    // in CI too. Verified by temporarily deleting each guard and confirming
    // these two tests go red for "did not throw" rather than staying green.

    test("an unknown --signal exits non-zero naming the valid ones", () => {
      const { status, stderr } = runCliExpectFailure(["--signal", "nonsense"]);
      expect(status).not.toBe(0);
      expect(stderr).toContain("--signal is required and must be one of:");
      for (const signal of [
        "no-website",
        "weak-reputation",
        "low-visibility",
        "no-hours",
      ]) {
        expect(stderr).toContain(signal);
      }
    });

    test("two --signal flags exits non-zero rather than silently using the first", () => {
      const { status, stderr } = runCliExpectFailure([
        "--signal",
        "no-website",
        "--signal",
        "no-hours",
      ]);
      expect(status).not.toBe(0);
      expect(stderr).toContain("Exactly one --signal is accepted (got 2)");
    });
  });

  describe("flag parsing (finding 1: --name=value, finding 4: unknown flags and empty values)", () => {
    // Every case below is validated before any file read (see the module doc
    // comment), so each is provable in CI without data/out/businesses.json —
    // that absence would otherwise mask whether the check under test ran at
    // all.

    test("--name=value is parsed, not silently ignored", () => {
      // Before the fix, `flag()` only matched the `--name value` form via
      // `argv.indexOf`, so `--limit=0` was never recognised as `--limit` at
      // all — the CLI would have gone on to read (and fail on, in CI)
      // data/out/businesses.json instead of ever validating the limit.
      // Getting the LIMIT VALIDATION error below proves the `=` form was
      // both recognised and validated.
      const { stderr } = runCliExpectFailure([
        "--signal",
        "no-website",
        "--limit=0",
      ]);
      expect(stderr).toContain(
        '--limit expects a whole number of at least 1, got "0"',
      );
    });

    test("--format=value is parsed, and an unrecognised format is rejected (findings 1 + 5)", () => {
      // The literal repro a review ran: `--format cvs --out leads.csv` wrote
      // 40 padded terminal rows into a file whose name promised full CSV.
      // Using the `=` form here also proves finding 1 for this flag.
      const { stderr } = runCliExpectFailure([
        "--signal",
        "no-website",
        "--format=cvs",
      ]);
      expect(stderr).toContain('Unknown --format "cvs"');
    });

    test("an unknown flag is rejected with the closest known flag named", () => {
      const { stderr } = runCliExpectFailure([
        "--signal",
        "no-website",
        "--categories",
        "Restaurants",
      ]);
      expect(stderr).toContain("Unknown flag --categories");
      expect(stderr).toContain("Did you mean --category?");
    });

    test("a singular --min-review typo is rejected, not silently unfiltered", () => {
      const { stderr } = runCliExpectFailure([
        "--signal",
        "no-website",
        "--min-review",
        "20",
      ]);
      expect(stderr).toContain("Unknown flag --min-review");
      expect(stderr).toContain("Did you mean --min-reviews?");
    });

    test("an empty flag value is rejected rather than silently widening the filter", () => {
      // `--category ""` from an unset shell variable used to pass straight
      // through: the empty string is falsy in the old `flag(x) ? {...} : {}`
      // check, so the category filter was silently dropped entirely.
      const { stderr } = runCliExpectFailure([
        "--signal",
        "no-website",
        "--category",
        "",
      ]);
      expect(stderr).toContain("--category was given an empty value");
    });
  });

  describe("numeric flag validation (finding 2)", () => {
    test.each([
      ["--limit", "0", "a whole number of at least 1"],
      ["--limit", "-5", "a whole number of at least 1"],
      ["--limit", "abc", "a whole number of at least 1"],
      ["--min-reviews", "abc", "a number of 0 or more"],
      ["--min-reviews", "-1", "a number of 0 or more"],
      ["--min-rating", "abc", "a number between 0 and 5"],
      ["--min-rating", "9", "a number between 0 and 5"],
      ["--min-rating", "-1", "a number between 0 and 5"],
    ] as const)("%s %s is rejected: expects %s", (flag, value, expected) => {
      const { status, stderr } = runCliExpectFailure([
        "--signal",
        "no-website",
        flag,
        value,
      ]);
      expect(status).not.toBe(0);
      expect(stderr).toContain(`${flag} expects ${expected}`);
    });
  });

  test("CSV header is the export columns plus signal, score, reason", () => {
    // Asserted against the exported constant directly, not by spawning the
    // CLI and parsing its output: that would require a real
    // data/out/businesses.json to get past the file read, which does not
    // exist in CI. The header itself is a pure value, independent of any
    // crawl — this runs unconditionally.
    expect(LEAD_CSV_HEADER).toEqual([
      ...BUSINESS_COLUMNS,
      "signal",
      "score",
      "reason",
    ]);
  });

  describe("loadSuppressionList (finding 6)", () => {
    // Written to the OS temp dir via node:os.tmpdir(), not the repo's own
    // scratchpad-under-.superpowers convention — this is a unit test that
    // must clean up after itself regardless of where Vitest is invoked from,
    // and must never touch the tracked data/suppression-list.json.
    let dir: string;

    test("a missing file throws (ENOENT) rather than returning an empty set", () => {
      // This used to be the opposite: a missing file mapped to an empty
      // set, on the reasoning that "a fork of this toolkit doesn't ship one
      // by default." That reasoning was wrong — `git ls-files data/` shows
      // data/suppression-list.json IS tracked, so every clone and fork has
      // it. The only way to reach a missing file in a real checkout is that
      // someone deleted it or failed to check it out, which is exactly when
      // silently treating it as "no takedowns" is unsafe: it would produce a
      // full, unfiltered call list while printing "0 withheld" — identical
      // to a successful filter run.
      dir = mkdtempSync(join(tmpdir(), "leads-suppression-"));
      const missing = join(dir, "does-not-exist.json");
      expect(() => loadSuppressionList(missing)).toThrowError(
        expect.objectContaining({ code: "ENOENT" }),
      );
      rmSync(dir, { recursive: true, force: true });
    });

    test("malformed JSON throws rather than silently emptying the list", () => {
      // This is the exact failure a review verified live: invalid JSON in
      // the suppression file made the CLI run clean and print "0 withheld"
      // while a business that should have been suppressed reappeared at
      // rank #1. A missing file is now also a hard stop (above); a corrupt
      // one already was, and must remain one.
      dir = mkdtempSync(join(tmpdir(), "leads-suppression-"));
      const corrupt = join(dir, "suppression-list.json");
      writeFileSync(corrupt, "{ not valid json");
      expect(() => loadSuppressionList(corrupt)).toThrow();
      rmSync(dir, { recursive: true, force: true });
    });

    test("a well-formed list containing a non-string entry also throws", () => {
      // parseSuppressionList's own validation (a number where a place_id
      // string belongs) must not be swallowed either — only ENOENT used to
      // be treated as "no list", and even that no longer is.
      dir = mkdtempSync(join(tmpdir(), "leads-suppression-"));
      const badEntry = join(dir, "suppression-list.json");
      writeFileSync(badEntry, JSON.stringify(["ChIJvalid", 42]));
      expect(() => loadSuppressionList(badEntry)).toThrow();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("loadBusinesses (finding 8)", () => {
    let dir: string;

    test("a missing file is reported as missing, not corrupt", () => {
      dir = mkdtempSync(join(tmpdir(), "leads-businesses-"));
      const missing = join(dir, "businesses.json");
      expect(() => loadBusinesses(missing)).toThrowError(
        expect.objectContaining({ kind: "missing" }),
      );
      rmSync(dir, { recursive: true, force: true });
    });

    test("a truncated JSON file is reported as corrupt, not missing", () => {
      // The exact failure a review found: a bare try/catch around
      // readFileSync + JSON.parse turned a truncated write from an
      // interrupted `pnpm load` into "No data/out/businesses.json. Run
      // `pnpm crawl --yes`..." — sending someone with a merely-corrupt file
      // to the one command in this repo that spends real SearchApi credits,
      // to fix something `pnpm load --from-archive` would solve for free.
      dir = mkdtempSync(join(tmpdir(), "leads-businesses-"));
      const truncated = join(dir, "businesses.json");
      writeFileSync(truncated, '[{"placeId": "abc", "title": "Truncat');
      expect(() => loadBusinesses(truncated)).toThrowError(
        expect.objectContaining({ kind: "corrupt" }),
      );
      rmSync(dir, { recursive: true, force: true });
    });

    test("valid JSON that is not an array is reported as corrupt", () => {
      // Before this check existed, a non-array JSON file (e.g. a lone `{}`)
      // crashed deep inside corpusPrior with a raw
      // `TypeError: businesses is not iterable` — closed, but not a
      // diagnosis anyone could act on.
      dir = mkdtempSync(join(tmpdir(), "leads-businesses-"));
      const notAnArray = join(dir, "businesses.json");
      writeFileSync(notAnArray, JSON.stringify({ foo: "bar" }));
      expect(() => loadBusinesses(notAnArray)).toThrowError(
        expect.objectContaining({ kind: "corrupt" }),
      );
      rmSync(dir, { recursive: true, force: true });
    });

    test("a well-formed array of businesses loads without throwing", () => {
      dir = mkdtempSync(join(tmpdir(), "leads-businesses-"));
      const valid = join(dir, "businesses.json");
      writeFileSync(valid, JSON.stringify([{ placeId: "abc", title: "X" }]));
      expect(loadBusinesses(valid)).toEqual([{ placeId: "abc", title: "X" }]);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  test("BusinessesFileError carries its kind for the caller to branch on", () => {
    const error = new BusinessesFileError("test message", "corrupt");
    expect(error.kind).toBe("corrupt");
    expect(error.message).toBe("test message");
    expect(error).toBeInstanceOf(Error);
  });
});
