/**
 * Smoke test only.
 *
 * `findLeads`, `detectSignals`, `leadScore`, and the prior itself are fully
 * covered in packages/core/src/leads.test.ts — this file does not repeat that
 * work. What it proves is that the CLI wires those pieces together
 * correctly, and specifically guards the two failure modes a review found:
 * a malformed suppression list must stop the run rather than silently empty
 * it, and more than one --signal must be rejected rather than silently
 * scoring the first.
 *
 * Nothing here depends on data/out/businesses.json. That file is gitignored
 * (ADR 0002: the dataset is never committed), so CI has none — every test
 * below either exits before that file would be read, or exercises a pure
 * export directly instead of spawning the CLI at all.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { BUSINESS_COLUMNS } from "../csv";
import { LEAD_CSV_HEADER, loadSuppressionList } from "./leads";

const TSX = fileURLToPath(
  new URL("../../../../node_modules/.bin/tsx", import.meta.url),
);
const CLI = fileURLToPath(new URL("./leads.ts", import.meta.url));

function runCli(args: string[]): string {
  return execFileSync(TSX, [CLI, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"], // stderr dropped: only stdout is under test
  });
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

  test("an unknown --signal exits non-zero", () => {
    expect(() => runCli(["--signal", "nonsense"])).toThrow();
  });

  test("two --signal flags exits non-zero rather than silently using the first", () => {
    // This check happens before any file is read, so it needs no dataset —
    // real or fixture — to exercise in CI.
    expect(() =>
      runCli(["--signal", "no-website", "--signal", "no-hours"]),
    ).toThrow();
  });

  test("CSV header is the export columns plus signal, score, reason", () => {
    // Asserted against the exported constant directly, not by spawning the
    // CLI and parsing its output: that would require a real
    // data/out/businesses.json to get past the file read, which does not
    // exist in CI. The header itself is a pure value, independent of any
    // crawl \u2014 this runs unconditionally.
    expect(LEAD_CSV_HEADER).toEqual([
      ...BUSINESS_COLUMNS,
      "signal",
      "score",
      "reason",
    ]);
  });

  describe("loadSuppressionList", () => {
    // Written to the OS temp dir via node:os.tmpdir(), not the repo's own
    // scratchpad-under-.superpowers convention \u2014 this is a unit test that
    // must clean up after itself regardless of where Vitest is invoked from,
    // and must never touch the tracked data/suppression-list.json.
    let dir: string;

    test("a missing file is an empty list, not an error", () => {
      dir = mkdtempSync(join(tmpdir(), "leads-suppression-"));
      const missing = join(dir, "does-not-exist.json");
      expect(loadSuppressionList(missing)).toEqual(new Set());
      rmSync(dir, { recursive: true, force: true });
    });

    test("malformed JSON throws rather than silently emptying the list", () => {
      // This is the exact failure a review verified live: invalid JSON in
      // the suppression file made the CLI run clean and print "0 withheld"
      // while a business that should have been suppressed reappeared at
      // rank #1. A missing file is a legitimate empty state; a corrupt one
      // is not, and must stop the run instead of being treated the same way.
      dir = mkdtempSync(join(tmpdir(), "leads-suppression-"));
      const corrupt = join(dir, "suppression-list.json");
      writeFileSync(corrupt, "{ not valid json");
      expect(() => loadSuppressionList(corrupt)).toThrow();
      rmSync(dir, { recursive: true, force: true });
    });

    test("a well-formed list containing a non-string entry also throws", () => {
      // parseSuppressionList's own validation (a number where a place_id
      // string belongs) must not be swallowed either \u2014 only ENOENT is
      // treated as "no list".
      dir = mkdtempSync(join(tmpdir(), "leads-suppression-"));
      const badEntry = join(dir, "suppression-list.json");
      writeFileSync(badEntry, JSON.stringify(["ChIJvalid", 42]));
      expect(() => loadSuppressionList(badEntry)).toThrow();
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
