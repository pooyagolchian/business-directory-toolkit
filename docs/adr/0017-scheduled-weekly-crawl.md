# ADR 0017 — Refresh the dataset with a scheduled weekly crawl, and keep the deploy human

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

The site now tells readers its listings are refreshed weekly. Nothing in the
repository did that. Every crawl so far has been `pnpm crawl --yes` typed on a
laptop, followed by `pnpm load` and a manual `pnpm dataset:push`
([ADR 0015](./0015-ship-the-dataset-to-ci-through-private-s3.md)), and ADR 0015
already lists the consequence in its own Bad section: "nothing links
`pnpm load` to `pnpm dataset:push`, so CI can keep deploying a months-old
dataset indefinitely and every run will look green." A weekly promise kept by
memory would not survive the first week it was forgotten.

What a run costs, from figures already in this repository:

| figure                  | value     | source                              |
| ----------------------- | --------- | ----------------------------------- |
| requests per full crawl | **1,400** | v0.1 crawl actuals, `CLAUDE.md`     |
| page-1 jobs for Dubai   | 1,250     | `pnpm crawl --city dubai --dry-run` |
| worst case, full depth  | 3,170     | same dry run                        |
| total SearchApi budget  | 100k      | `CLAUDE.md`                         |
| weekly, per year        | ~73k      | 1,400 × 52                          |
| weekly, per month       | ~6k       | 73k ÷ 12                            |

So a year of weekly runs is ~73% of the total credit budget, before any other
spend. That is affordable, and it is also the largest recurring cost this
project has ever had, which is why it gets a decision record.

`CLAUDE.md` hard rule 3 says "never spend API credits in tests or CI." This
workflow lives in `.github/workflows/` and spends credits, so the tension has
to be resolved in writing rather than left for someone to notice. The rule
exists to keep _verification_ free and safe for forks: a pull request must
never be able to spend. That still holds — `ci.yml` is unchanged and never sees
a credential. `crawl.yml` is an operations job, the same category as
`deploy.yml`, and it is fenced off from the paths the rule protects.

## Decision

**A scheduled GitHub Actions workflow, `.github/workflows/crawl.yml`, crawls
Dubai every Sunday at 02:00 UTC with a hard cap of 1,500 requests, publishes the
refreshed dataset, and _requests_ a production deploy that still waits for a
human.**

```
on: schedule "0 2 * * 0"  +  workflow_dispatch (dry_run: boolean)

crawl   environment: crawl · id-token: write · contents: read
  check configuration → crawl --dry-run (to the job summary)
  → OIDC → dataset:pull → keep it as carry-over
  → crawl --yes --budget 1500
  → OIDC again → archive data/raw/<runId> to RawArchive
  → refuse if 0 unique businesses
  → classify --dry-run → classify --yes only if anything is new
  → load --carry-over → dataset:push

taxonomy-pr     contents: write   push crawl/taxonomy-<run_id> for review
trigger-deploy  actions: write    gh workflow run deploy.yml -f stage=production
```

The parts that carry the weight:

- **The cap is the consent.** `--yes` exists so that no one spends credits by
  accident. Here a human cannot type it every week, so the decision to spend is
  made once, in this record and in the header comment of `crawl.yml`, and
  bounded by `BUDGET: "1500"`. `runCrawl()` in `packages/pipeline/src/fetch.ts`
  stops at the cap rather than overrunning it. The dry run still runs first on
  every invocation and writes the plan to the job summary, so the stated cost is
  on the run page before anything is spent.
- **Keys live in one place.** `SEARCH_API_KEY` and `ANTHROPIC_API_KEY` exist
  only as secrets of the `crawl` GitHub Environment, whose deployment branch
  policy admits `main` alone. There is no repository-level copy (checked with
  `gh secret list` on 2026-11-23: none). Each key is placed in the `env` of the
  one step that uses it, and no step runs with `set -x`.
- **AWS by OIDC only, with a role that is not the deploy role.** The deploy
  role is scoped to provisioning the whole stack. The crawl role, `github-actions-directory-crawl`,
  can do three things: get and put objects under the dataset bucket's `dubai/`
  prefix, list that prefix, and put objects under `raw/` in the production
  `RawArchive` bucket. It cannot delete anything. The policies are
  `infra/iam/crawl-role-trust-policy.json` and
  `infra/iam/crawl-role-permissions.json`.
- **The trust policy matches the subject GitHub actually sends.** This
  repository uses immutable OIDC subject claims
  (`GET /repos/.../actions/oidc/customization/sub` →
  `use_immutable_subject: true`), and the deploy run on 2026-11-22 logged
  `sub = repo:pooyagolchian@8122611/business-directory-toolkit@1342134774:environment:production`.
  So the crawl role trusts exactly
  `repo:pooyagolchian@8122611/business-directory-toolkit@1342134774:environment:crawl`,
  with `StringEquals`. The name-only form
  `repo:pooyagolchian/business-directory-toolkit:environment:crawl` would never
  match, and adding it as well would reopen the delete-and-recreate hole that
  immutable claims exist to close. An environment subject carries no branch,
  so the policy also requires `token.actions.githubusercontent.com:ref` to be
  `refs/heads/main`. That is the same rule the environment's branch policy
  enforces, kept on the AWS side too so that loosening a GitHub setting does
  not loosen the role. IAM Access Analyzer raised this as a warning
  (`SPECIFIC_GITHUB_REPO_AND_BRANCH_RECOMMENDED`) on the first draft. The
  final one returns no warnings, only the generic suggestion
  `CONFIRM_AUDIENCE_CLAIM_TYPE`, and the permissions policy returns no
  findings at all.
- **Forks never spend.** The job is guarded with
  `if: github.repository == 'pooyagolchian/business-directory-toolkit'`. A fork
  has no keys anyway, but it should not even start a job that looks like it is
  trying.
- **Two tokens, two jobs.** `contents: write` and `actions: write` sit in
  separate jobs that have no environment, no secrets and no `pnpm install`. A
  compromised dependency running in the crawl job gets an AWS session scoped to
  two prefixes and a read-only `GITHUB_TOKEN`. That is all it gets.
- **The taxonomy goes to review on a branch, not into a pull request.** The
  repository keeps "Allow GitHub Actions to create and approve pull requests"
  off (`can_approve_pull_request_reviews: false`), for the reason set out in
  the comment in `ci.yml`. So `taxonomy-pr` pushes `crawl/taxonomy-<run_id>` and
  posts the compare link as a notice. The map is never committed to `main` by
  automation.
- **Raw responses go to the archive.** They are archived with
  `aws s3 cp --recursive` to the same `raw/{runId}/{tile}/` layout the Lambda
  fetcher writes, and this runs even when the crawl step fails, because by then
  the credits are spent.
- **The deploy stays human.** `gh workflow run` is one of the two events
  `GITHUB_TOKEN` may trigger. `deploy.yml` then stops at the `production`
  environment's required reviewer, exactly as a manual dispatch does.

## Consequences

**Good:**

- The freshness promise on the site is kept by a schedule instead of by
  memory, and ADR 0015's "a months-old dataset indefinitely" failure is now
  bounded to one missed week before somebody sees a red run.
- The `RawArchive` bucket stops being empty. ADR 0015 rejected rebuilding the
  dataset in CI with `pnpm load --from-archive` on exactly that measurement
  ("both `RawArchive` buckets contain 0 objects"). After the first scheduled
  run, that alternative is live again.
- Every run leaves a cost record: the dry-run plan, the requests actually
  spent, unique businesses, the load's fresh/carried/retired/suppressed counts
  and the classify cost, all in the job summary.
- A revoked or exhausted key fails loudly. The crawl CLI exits 0 even when
  every request errors, so the workflow refuses to publish when the crawl
  yields zero unique businesses. Without that check, carry-over would have
  republished last week's data and passed the shrink guard green.

**Bad:**

- **Credits now burn every week without anyone typing `--yes`.** Roughly 1,400
  credits a run, ~73k a year, ~73% of the 100k total. The schedule and the cap
  are the only consent, and a change to either silently changes that
  arithmetic. Nothing enforces that whoever edits the cron also updates this
  record.
- **A run that hits the cap always starves the same tiles.** `buildCrawlPlan()`
  in `packages/pipeline/src/plan.ts` emits jobs tile-major, in the order the
  tiles appear in `data/cities/dubai.json`. `runCrawl()` paginates each job to
  depth before starting the next, and returns as soon as the budget is spent.
  The headroom is about 100 requests over the v0.1 figure, against a dry-run
  worst case of 3,170. A week that paginates deeper than v0.1 leaves the
  _last_ tiles in the file uncrawled, and they are the same tiles every time.
  The carry-over window (`--max-unseen-days 56`) and the 5% shrink guard in
  `pnpm dataset:push` both come from a change being built in parallel with
  this one, and the two lines that use them are marked `TODO(confirm flags)`
  in `crawl.yml`. As drafted, those tiles' businesses are carried for eight
  weeks and then retired. Either the push trips the shrink guard, or the loss
  stays under 5% and those listings disappear quietly. The workflow emits a
  warning on "Stopped on budget: YES". It does not fail.
- **Production gets a taxonomy no human has reviewed.** When classify finds new
  categories, the map it writes is used by `pnpm load` in the same run, and the
  resulting dataset is pushed and offered for deploy before anyone has looked
  at `crawl/taxonomy-<run_id>`. The production reviewer is approving model
  output they have not been shown.
- **Until that branch is merged, every week pays again.** The next scheduled
  run checks out `main`, whose map lacks the new entries, so it re-classifies
  the same categories and opens another branch for the same diff. An
  unattended review queue costs money as well as attention.
- **The schedule can switch itself off.** "In a public repository, scheduled
  workflows are automatically disabled when no repository activity has
  occurred in 60 days"
  ([GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).
  Pushing to S3 is certainly not repository activity. Whether the occasional
  `crawl/taxonomy-*` branch push counts is not documented, and it only happens
  in weeks with new categories. In a quiet stretch the site would keep
  promising weekly freshness while nothing ran. Nothing in the repository
  watches for this.
- **The crawl's duration has never been measured in CI.** Requests are
  sequential, each with a 30-second timeout and up to three retries. The step
  timeout is 240 minutes and the job timeout 300, which are ceilings rather
  than estimates. The AWS session is re-assumed after the crawl so that a long
  run does not outlive its one-hour credentials.
- **The role names a bucket with a generated suffix.** The production
  `RawArchive` bucket is `directory-from-scratch-production-rawarchivebucket-remsarbx`.
  SST chose the suffix, so the permissions file and the `RAW_ARCHIVE_S3_URI`
  variable both carry it by hand. Production is `protect`ed and `retain`ed in
  `sst.config.ts`, so the name should not change, but if it ever does the
  archive step fails with AccessDenied, after the credits are spent.
- **It is one more copy for `TAKEDOWN.md` to honour.** Raw responses in S3
  include any business later suppressed. The suppression list is applied on the
  load path ([ADR 0007](./0007-enforce-the-takedown-promise.md)), so they cannot
  come back through `--from-archive`, but they are still stored, and there is no
  lifecycle rule expiring them.

## Alternatives considered

- **Monthly.** About 1,400 × 12 ≈ 17k credits a year instead of ~73k. Rejected
  because it breaks the weekly promise the site already makes. It is the
  obvious fallback if the budget tightens: change the cron and this record, and
  nothing else.
- **The Lambda fetcher via SQS.** `sst.config.ts` already defines `CrawlQueue`,
  its DLQ and a fetch handler that archives to `RawArchive`, and ADR 0015 names
  a Lambda-run crawl as what would make `--from-archive` rebuilds the normal
  path. Deferred, not rejected. It needs a scheduler, a way to know when the
  queue has drained, and somewhere to run classify and load afterwards, which
  is a second pipeline to build. The Actions job runs the same CLI an operator
  runs, with the same output, which is what makes this record's numbers
  comparable to v0.1's.
- **Deploy automatically after the push.** Rejected. The `production` reviewer
  is the only point where a human sees a run's counts before readers see its
  data, and the Bad list above, an unreviewed taxonomy and a quiet sub-5% loss,
  is the case for keeping them.
- **Open the taxonomy pull request from the workflow.** Rejected for now. It
  needs "Allow GitHub Actions to create and approve pull requests" turned on,
  which `ci.yml` argues against, and a pull request created with `GITHUB_TOKEN`
  gets its CI runs in an approval-required state anyway. A pushed branch and a
  compare link cost one click.
- **Reuse the deploy role.** Rejected. It can provision the whole stack. A crawl
  job that runs `pnpm install` and holds two third-party API keys is the last
  place that should be able to assume it.
