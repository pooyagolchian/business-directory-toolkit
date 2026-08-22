/**
 * Move the built dataset between a private S3 bucket and `data/out/`.
 *
 * This exists because two decisions in this repository are both correct and,
 * together, made production undeployable.
 *
 * ADR 0002 forbids committing the crawl output: the takedown promise in
 * TAKEDOWN.md is unenforceable once records are in public git history. ADR 0009
 * needs `data/out/businesses.json` present at build time, because the site
 * bundles it into the server function. A fresh CI checkout therefore has the
 * requirement and not the file, and `packages/web/scripts/bundle-data.mjs`
 * exits 1 rather than deploying an empty directory to a live domain.
 *
 * So the dataset travels through a private bucket in the same AWS account the
 * stack deploys into. It is never in git, never public, and the deploy role
 * fetches it with the same short-lived OIDC credentials it deploys with.
 * See docs/adr/0015-ship-the-dataset-to-ci-through-private-s3.md.
 *
 *   pnpm dataset:push    # after pnpm load, from a machine that has the data
 *   pnpm dataset:pull    # in CI, before the build
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `required` mirrors `packages/web/scripts/bundle-data.mjs` exactly. If the two
 * ever disagree, CI downloads a dataset the build then rejects — so the shape
 * of that list is duplicated deliberately rather than imported, and this
 * comment is the reason someone editing one should edit the other.
 */
const FILES = [
  {
    path: "data/out/businesses.json",
    required: true,
    // A JSON array of normalised businesses.
    shape: "array",
    sample: (record) => Boolean(record?.placeId),
    expected: "records with a placeId",
  },
  {
    path: "data/out/review-signals.json",
    required: false,
    // Keyed by place_id, NOT an array — an earlier version of this script
    // assumed every file was an array and rejected a perfectly good file.
    shape: "record",
    sample: (entry) => typeof entry?.reviewsAnalysed === "number",
    expected: "entries with a reviewsAnalysed count",
  },
];

const command = process.argv[2];
const uri = process.env.DATASET_S3_URI?.replace(/\/+$/, "");

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!uri) {
  die(
    `DATASET_S3_URI is not set.\n\n` +
      `  It must be an s3:// prefix in the same AWS account the stack deploys\n` +
      `  into, holding the output of \`pnpm load\`. In CI it comes from the\n` +
      `  repository variable of the same name.\n\n` +
      `  Create the bucket once, with public access blocked:\n\n` +
      `    aws s3api create-bucket --bucket <name> --region us-east-1\n` +
      `    aws s3api put-public-access-block --bucket <name> \\\n` +
      `      --public-access-block-configuration \\\n` +
      `      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"\n\n` +
      `  Then: gh variable set DATASET_S3_URI --body "s3://<name>/dubai"`,
  );
}

if (!uri.startsWith("s3://")) {
  die(`DATASET_S3_URI must start with s3:// — got ${JSON.stringify(uri)}.`);
}

/**
 * Reject a file that is not what the build expects.
 *
 * The failure this prevents is the one ADR 0009 was written about: a dataset
 * that is present but wrong builds a site that renders an empty state, and an
 * empty directory on a live domain looks exactly like a working one to
 * everything except a reader.
 */
function verify(absolute, file) {
  const bytes = statSync(absolute).size;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    die(`${file.path} is not valid JSON (${bytes} bytes): ${error.message}`);
  }

  const isArray = Array.isArray(parsed);
  if (file.shape === "array" && !isArray) {
    die(`${file.path} should be a JSON array; got ${typeof parsed}.`);
  }
  if (
    file.shape === "record" &&
    (isArray || typeof parsed !== "object" || parsed === null)
  ) {
    die(`${file.path} should be a JSON object keyed by place_id.`);
  }

  const entries = isArray ? parsed : Object.values(parsed);
  if (entries.length === 0) {
    die(
      `${file.path} is empty. Deploying it would publish an empty directory — ` +
        `the failure ADR 0009 exists to prevent.`,
    );
  }
  if (!file.sample(entries[0])) {
    die(
      `${file.path} does not look like pipeline output: expected ` +
        `${file.expected}. Refusing rather than building a site from it.`,
    );
  }
  return { bytes, records: entries.length };
}

function s3(args) {
  try {
    execFileSync("aws", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    die(
      `aws ${args.slice(0, 2).join(" ")} failed:\n  ${stderr || error.message}`,
    );
  }
}

if (command === "push") {
  // Everything is verified BEFORE anything is uploaded. Uploading as it went
  // meant a rejected second file left S3 holding a fresh businesses.json
  // beside a stale review-signals.json — a half-published dataset that the
  // next deploy would consume without noticing.
  const ready = [];
  for (const file of FILES) {
    const absolute = join(repoRoot, file.path);
    if (!existsSync(absolute)) {
      if (file.required) {
        die(
          `Missing ${file.path}. Run \`pnpm crawl\` then \`pnpm load\` first — ` +
            `there is nothing to publish.`,
        );
      }
      console.log(`  skipped  ${file.path} (absent, optional)`);
      continue;
    }
    ready.push({ file, absolute, ...verify(absolute, file) });
  }

  for (const { file, absolute, bytes, records } of ready) {
    s3(["s3", "cp", absolute, `${uri}/${file.path.split("/").pop()}`]);
    console.log(
      `  pushed   ${file.path}  ${(bytes / 1e6).toFixed(1)} MB, ${records.toLocaleString()} records`,
    );
  }
  console.log(`\nDataset published to ${uri}\n`);
  process.exit(0);
}

if (command === "pull") {
  mkdirSync(join(repoRoot, "data/out"), { recursive: true });
  for (const file of FILES) {
    const absolute = join(repoRoot, file.path);
    const name = file.path.split("/").pop();
    try {
      execFileSync("aws", ["s3", "cp", `${uri}/${name}`, absolute], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      if (file.required) {
        die(
          `Could not fetch ${name} from ${uri}.\n\n` +
            `  ${error.stderr?.toString().trim() || error.message}\n\n` +
            `  Someone with the crawl output must run \`pnpm dataset:push\` ` +
            `before this stage can be deployed.`,
        );
      }
      console.log(`  skipped  ${name} (not published, optional)`);
      continue;
    }
    const { bytes, records } = verify(absolute, file);
    console.log(
      `  pulled   ${file.path}  ${(bytes / 1e6).toFixed(1)} MB, ${records.toLocaleString()} records`,
    );
  }
  console.log(`\nDataset ready in data/out/\n`);
  process.exit(0);
}

die(
  `Usage: node scripts/dataset.mjs push|pull   (got ${JSON.stringify(command ?? "")})`,
);
