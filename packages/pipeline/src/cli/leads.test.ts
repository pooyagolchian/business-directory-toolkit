/**
 * Smoke test only.
 *
 * `findLeads`, `detectSignals`, `leadScore`, and the prior itself are fully
 * covered in packages/core/src/leads.test.ts — this file does not repeat that
 * work. What it proves is that the CLI wires those pieces together: an
 * unrecognised invocation exits cleanly with the signal list, and a real run
 * emits the exact header row a spreadsheet needs to open the file correctly
 * (BUSINESS_COLUMNS plus signal, score, reason — the export columns are the
 * shared contract with `pnpm export`, so a drift here would silently break
 * anyone building tooling on top of both).
 *
 * The CLI resolves data/out/businesses.json relative to its own file location
 * (see leads.ts), not a path this test can redirect — so the header-row check
 * runs against whatever local crawl is on disk. That file is gitignored
 * (ADR 0002: the dataset is never committed), so a fresh checkout or CI has
 * none; the test skips rather than fabricate a fixture at a path meant only
 * for a real crawl, and rather than write one and risk clobbering a crawl a
 * concurrent session is using.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { BUSINESS_COLUMNS } from "../csv";

const TSX = fileURLToPath(
  new URL("../../../../node_modules/.bin/tsx", import.meta.url),
);
const CLI = fileURLToPath(new URL("./leads.ts", import.meta.url));
const DATA = fileURLToPath(
  new URL("../../../../data/out/businesses.json", import.meta.url),
);

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

  test.skipIf(!existsSync(DATA))(
    "CSV header is the export columns plus signal, score, reason",
    () => {
      const stdout = runCli([
        "--signal",
        "no-website",
        "--format",
        "csv",
        "--limit",
        "1",
      ]);
      // Strip the UTF-8 BOM the writer prepends for Excel before reading the
      // header line back out.
      const header = stdout.replace(/^\uFEFF/, "").split("\n")[0];
      expect(header).toBe(
        [...BUSINESS_COLUMNS, "signal", "score", "reason"].join(","),
      );
    },
  );
});
