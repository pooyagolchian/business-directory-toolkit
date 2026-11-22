# Development and contributing

Setup details, the CI gates, troubleshooting, and how to contribute.

## Quickstart

**Requirements:** Node 24 (pinned in [`.nvmrc`](../.nvmrc); `package.json`
declares `engines.node >= 24` to match the `nodejs24.x` Lambda runtime) and
pnpm 10. No SearchApi key and no AWS account are needed for anything in the
first block.

```bash
nvm use                  # Node 24, from .nvmrc
corepack enable          # pnpm 10, from package.json's packageManager field
pnpm install
pnpm test                # the whole suite, offline against fixtures/ — 0 credits
pnpm plan --list         # every city config in the repo
pnpm plan --city dubai   # what a crawl would cost, before spending anything
```

`pnpm plan --city dubai` prints the whole cost model and exits without touching
the network: **1,250 requests up front, 3,170 worst case**, against the 2,000
budget hardcoded in [`cli/plan.ts`](../packages/pipeline/src/cli/plan.ts) — plus
the warning that the worst case exceeds it by 1,170.

Everything in this repository is counted in **requests and credits, never in
currency.** One request is one credit, and what a credit costs depends on your
SearchApi plan — that number is not quoted here because nothing in this
repository can source it. Take the request count from `--dry-run` to
[SearchApi's pricing page](https://www.searchapi.io/pricing) and do the
multiplication yourself.

### Then, if you want to actually crawl

This spends money. Every command below that spends requires an explicit `--yes`.

```bash
cp .env.example .env     # then set SEARCH_API_KEY
pnpm crawl --city dubai --dry-run              # still free — prints the bill
pnpm crawl --yes --budget 200 --only downtown  # ⚠ at most 200 credits
pnpm load --dry-run                            # quality gates, 0 credits
```

Deployed environments never read `.env` — credentials come from SSM via
`npx sst secret set SearchApiKey <value> --stage <stage>` and
`npx sst secret set AnthropicApiKey <value> --stage <stage>`.

**`--stage` is not optional in practice.** Without it SST writes to your
personal stage, so a secret you believe you set on `production` is sitting on
`pooya`. Check with `npx sst secret list --stage production`.

Neither secret is needed to serve the site. `SearchApiKey` is linked only to
the SQS crawl fetcher and `AnthropicApiKey` only to the classifier — both
offline batch Lambdas — and nothing under `packages/web` reads either one. A
deploy with both unset succeeds and every page renders.

> **The site cannot be run on a fresh clone.** `pnpm --filter @directory/web dev`
> runs `scripts/bundle-data.mjs` first, and it exits 1 with
> `Missing data/out/businesses.json` when no crawl has happened. That is
> deliberate — see [ADR 0009](./adr/0009-bundle-the-dataset-into-the-lambda.md).

## Development

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm format:check   # the CI gates
pnpm vitest run packages/core                                    # one package
pnpm test:watch                                                  # TDD loop
pnpm --filter @directory/web dev                                 # the site (needs a crawl)
npx sst deploy --stage dev                                       # the stack
```

**TDD is mandatory in `packages/core`.** Write the test, watch it fail, then
implement. It is pure domain logic with no I/O and no AWS, which is exactly what
makes that affordable.

**No test may make a network call.** The whole suite runs offline — 567 tests
across 30 files — and every engine response comes from the four recorded
fixtures in [`fixtures/searchapi/`](../fixtures/searchapi), injected as a
`SearchClient`. The seven recordings in [`fixtures/osm/`](../fixtures/osm) do the
same job for the city generator: Nominatim and Overpass cost no credits, but a
test that depends on a remote service is not deterministic, and determinism is
the rule rather than the saving. A test that opens a socket is a broken test.

CI runs typecheck, lint, test and format check, plus two guard steps that fail
the build outright:

- **`.env` is tracked** → error. If it ever happens, treat it as a live incident
  and rotate the key ([SECURITY.md](../SECURITY.md)).
- **anything matching `^data/(raw|out)/` is committed** → error. The takedown
  promise is unenforceable once records are in public git history.

Every GitHub Action is pinned to a **commit SHA, not a tag** — a tag is a mutable
pointer, which is how the tj-actions compromise reached thousands of
repositories — and [`dependabot.yml`](../.github/dependabot.yml) watches those
pins so they cannot silently rot. No AWS or SearchApi credentials are in scope in
[`ci.yml`](../.github/workflows/ci.yml) at all, so a fork PR cannot spend anything.

## Troubleshooting

| Symptom                                                                            | Cause                                                                                                                                   | Fix                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WARN Unsupported engine: wanted {"node":">=24"}`                                  | Local Node is older than the `nodejs24.x` Lambda runtime the CLIs are written against.                                                  | `nvm use` — [`.nvmrc`](../.nvmrc) pins 24. The CLIs still run on 20 today, but the local runtime should match what deploys.                          |
| `No city config "berlin". Available: dubai.`                                       | `loadCity()` could not read `data/cities/berlin.json`. `plan`, `crawl` and `load` wrap it so the message teaches.                       | `pnpm plan --list`, or copy `_template.json`. Note `pnpm demand --city <bad-id>` skips the wrapper and dumps a raw stack trace instead.              |
| `Refusing to spend credits without --yes.`                                         | Working as designed. A crawl is the only irreversible spend in the project.                                                             | Run the `--dry-run` form, read the printed cost, then re-run with `--yes`. For a first crawl, `--yes --budget 200 --only downtown`.                  |
| `SEARCH_API_KEY is not set. Copy .env.example to .env.`                            | The key is read only **after** the `--yes` gate, so this appears at the last possible moment before spending.                           | `cp .env.example .env`. In AWS the key comes from SSM instead — `.env` is never read there.                                                          |
| `DIRECTORY_TABLE is not set.`                                                      | `pnpm load --yes` needs the table name. It is commented out in `.env.example` because it does not exist until the stack is deployed.    | Take the `table` output from `npx sst deploy`, or prefix: `DIRECTORY_TABLE=<name> pnpm load --yes`. A dry run does not need it.                      |
| `No crawl output at data/out/raw-records.json.`                                    | Stage 3 needs stage 1's output, and `data/out/` is git-ignored so a fresh clone never has it.                                           | Run the crawl — or `pnpm load --from-archive` to rebuild from responses already fetched, for free.                                                   |
| `No data/out/businesses.json.` from `demand` or `reviews`                          | `demand` and `reviews` read the normalised set, not the raw one.                                                                        | `pnpm load --dry-run` writes `businesses.json` even on a dry run, deliberately — a full `--yes` load is not needed to unblock them.                  |
| Uncaught `ENOENT` from `pnpm seed-taxonomy`, no message                            | Unlike `classify` and `load`, it reads `raw-records.json` with a bare `readFileSync` and no `try`/`catch`.                              | Run `pnpm crawl` first. This is a rough edge, not a broken install.                                                                                  |
| Build fails: `Missing data/out/businesses.json … would deploy an empty directory.` | `bundle-data.mjs` marks `businesses.json` and the city config **required**; review signals and demand are optional and warn.            | Run the pipeline before building. The guard exists because a green build that deploys an empty directory looks like success.                         |
| The site renders **"No data yet"**                                                 | `allBusinesses()` caught a read failure on `.data/businesses.json`. This is the honest empty state, not a crash.                        | Crawl → load → rebuild, or set `DIRECTORY_CITY` to a city you have already crawled. If `data/out/` exists, run `pnpm bundle-data` in `packages/web`. |
| `Stopped on budget YES — widen --budget for full depth`                            | `runCrawl()` hit its hard ceiling. Dubai's default 2,000 sits between the 1,250 floor and the 3,170 worst case.                         | Re-run with a larger `--budget` — stating the new number first. Cheaper alternative: reduce tile density in the city file.                           |
| `SearchApi HTTP 429 …` in the failed-requests list                                 | Rate limiting. `searchapi.ts` retries with exponential backoff; non-retryable statuses throw immediately.                               | Nothing is lost — only that job's pagination is abandoned. Re-run the tile with `--only`, or replay everything with `--from-archive` for free.       |
| `N items would not write after 8 attempts.`                                        | DynamoDB throttling. `BatchWriteItem` answers 200 and hands rejected puts back in `UnprocessedItems`.                                   | Wait for the table to scale and re-run `pnpm load --yes` — writes are idempotent puts keyed on `placeId`.                                            |
| `Suppression list must be a JSON array of place_id strings.`                       | `parseSuppressionList()` throws on malformed input rather than returning ∅ — "empty" and "broken" look identical, and only one is safe. | Fix `data/suppression-list.json` to a flat array of `place_id` strings. Never put a name or number in it.                                            |
| An area × category page is missing from the sitemap, or carries a `noindex`        | `MIN_FOR_INDEX = 3`. Working as designed — thousands of one-result pages drag down a whole domain, not just themselves.                 | Nothing, unless the count is wrong. The usual cause is area assignment; `pnpm load` prints the "Area reassigned" count for exactly this reason.      |
| CI fails with `Crawled data must not be committed.`                                | The guard step in `ci.yml` found something under `data/raw/` or `data/out/`.                                                            | Never force-add them. [ADR 0002](./adr/0002-do-not-redistribute-the-dataset.md) is the reasoning; [TAKEDOWN.md](../TAKEDOWN.md) is the consequence.  |

## Contributing

The easiest high-value contribution is fixing a wrong category in
[`data/taxonomy-map.json`](../data/taxonomy-map.json) — a one-line pull request
that improves every business carrying it, and no API key required. Existing
entries always win over both rules and model output, so a human correction is
never overwritten by a re-run. The other free, reviewable lever is adding a
keyword rule to
[`cli/seed-taxonomy.ts`](../packages/pipeline/src/cli/seed-taxonomy.ts) — ordered,
first match wins, so the specific must precede the general.

See [CONTRIBUTING.md](../CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

## Licence

[MIT](../LICENSE) for the code. The data scope is set by
[ADR 0002](./adr/0002-do-not-redistribute-the-dataset.md) and
[TAKEDOWN.md](../TAKEDOWN.md), not by the licence.

The SearchApi wordmark in [`logo/`](../logo) is **not** covered by that MIT
grant. It is SearchApi's trademark, reproduced here to credit the engine this
runs on, and forking the code does not carry a licence to use it — see
[`logo/README.md`](../logo/README.md). Everything else about the design is
typographic on purpose ([ADR 0004](./adr/0004-design-system.md)).
