/**
 * Decide whether `pnpm dataset:push` may replace the remote dataset.
 *
 * The push is the last step before a dataset becomes the live site (ADR 0015),
 * so it is the last place a shrunken directory can be stopped. A business that
 * falls out of `businesses.json` loses a page that search engines have already
 * indexed. Carry-over (ADR 0016) is meant to make that rare, but it can be
 * skipped, misconfigured, or fed the wrong file — and every one of those looks
 * like a normal, green push.
 *
 * 95% because the honest week-to-week movement is small: carry-over keeps the
 * set stable, and a real decline from closures arrives a few records at a
 * time. A drop of more than one record in twenty is a pipeline fault until
 * an operator says otherwise with `--allow-shrink`.
 *
 * Kept apart from dataset.mjs, and free of I/O, so the threshold is tested
 * without AWS.
 */
export const SHRINK_FLOOR_PERCENT = 95;

function assertCount(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${name} must be a non-negative integer; got ${JSON.stringify(value)}.`,
    );
  }
}

/**
 * @param {{ remote: number | null, next: number, allowShrink: boolean }} input
 *   `remote` is the record count of the published businesses.json, or null
 *   when there is none yet.
 * @returns {{ allowed: boolean, reason: "first-push" | "within-threshold" | "override" | "refused", message: string }}
 */
export function shrinkVerdict({ remote, next, allowShrink }) {
  assertCount("next", next);
  if (remote === null) {
    return {
      allowed: true,
      reason: "first-push",
      message: `No published businesses.json yet — first push of ${next.toLocaleString("en-US")} records.`,
    };
  }
  assertCount("remote", remote);

  // Integer arithmetic, so the boundary is exact by construction rather than
  // by an argument about how 0.95 rounds. Exactly 95% is allowed.
  const belowFloor = next * 100 < remote * SHRINK_FLOOR_PERCENT;
  const percent =
    remote === 0 ? "n/a" : `${((100 * next) / remote).toFixed(1)}%`;
  const summary =
    `new ${next.toLocaleString("en-US")} records vs ` +
    `${remote.toLocaleString("en-US")} published (${percent})`;

  if (!belowFloor) {
    return { allowed: true, reason: "within-threshold", message: summary };
  }
  if (allowShrink) {
    return {
      allowed: true,
      reason: "override",
      message: `Shrinking on purpose (--allow-shrink): ${summary}.`,
    };
  }
  return {
    allowed: false,
    reason: "refused",
    message:
      `Refusing to publish a smaller directory: ${summary}, below the ` +
      `${SHRINK_FLOOR_PERCENT}% floor.\n\n` +
      `  Every business that drops out loses an indexed page. If the load ran\n` +
      `  without --carry-over, re-run it with the published dataset. If the\n` +
      `  drop is real and intended, push again with --allow-shrink.`,
  };
}
