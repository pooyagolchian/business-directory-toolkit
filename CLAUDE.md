# Directory from Scratch — agent instructions

An MIT-licensed **open-source toolkit for building a local business directory
for any city**, built on SearchApi's Google Maps engine and developed in public
as part of the SearchApi Developer Ambassador Program.
`directory.pooyagolchian.com` is its reference deployment, not the product —
see `docs/adr/0005-toolkit-not-directory.md`.

Three milestones: **v0.1** pipeline → **v0.2** search → **v1.0** programmatic SEO.

**A city is data, not code.** `data/cities/<id>.json` carries tiles, categories,
bounding boxes, country code and phone region. Nothing downstream hard-codes a
city. Users bring their own SearchApi key and crawl their own city — which is
also why ADR 0002 (never ship the dataset) _drives_ the programme's lead metric
rather than suppressing it: the proposal states that clicks and signups lead
every monthly report, with stars and forks explicitly behind them.

---

## Hard rules

These are not preferences. Breaking any of them is a defect, regardless of what
was asked.

1. **Never commit secrets.** `.env` is git-ignored. Deployed credentials live in
   SSM via `npx sst secret set`. If a key reaches a commit, stop and treat it as
   a live incident (see `SECURITY.md`).
2. **Never commit crawled data.** `data/raw/` and `data/out/` stay ignored. The
   takedown promise in `TAKEDOWN.md` is unenforceable once records are in public
   git history. See `docs/adr/0002-do-not-redistribute-the-dataset.md`.
3. **Never spend API credits in tests or CI.** Tests read recorded fixtures from
   `fixtures/`. A test that makes a network call is a broken test.
4. **Never widen a crawl without saying what it costs.** Any change to
   `data/cities/<id>.json` must state the new request count.
5. **Business listings only.** No residential numbers, no personal data. Decline
   changes that would collect either.
6. **TDD is mandatory** for `packages/core`. Write the test, watch it fail, then
   implement. See the workflow below.

---

## Workflow: AI-DLC over Superpowers

This project follows AWS's **AI-Driven Development Life Cycle** (Inception →
Construction → Operations), executed through the Superpowers skills. AI-DLC's
core loop — _plan, ask clarifying questions, implement only after human
validation_ — is exactly the Superpowers approval gate, so the two compose
directly.

Work is measured in **bolts** (hours to days), not sprints. An epic is a **Unit
of Work**.

| AI-DLC phase     | Use these skills                                                                 | Produces                                       |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Inception**    | `superpowers:brainstorming` → `superpowers:writing-plans`                        | A spec in `docs/superpowers/specs/`, plus ADRs |
| **Construction** | `superpowers:test-driven-development`, `superpowers:subagent-driven-development` | Tested code, green suite                       |
| **Operations**   | `superpowers:verification-before-completion`, then `sst deploy`                  | Deployed stack, measured costs                 |

**Persistent context is a deliverable.** AI-DLC depends on each phase enriching
the next, so decisions get written to the repo — ADRs in `docs/adr/`, specs in
`docs/superpowers/specs/` — not left in a chat transcript.

**The approval gate is real.** Do not start implementing because the design
seems obvious. Present it, wait for a yes.

---

## Measured API facts — do not re-probe

Probed live on 2026-08-20. These cost credits to learn; treat them as settled
and do not spend more re-deriving them.

| Fact                             | Value                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Result ceiling per query         | **~200** — `page=11` returns zero. Tiling is mandatory.                                                                |
| Results per page                 | 20                                                                                                                     |
| Unique yield per request         | **10.9 measured over a full crawl.** The ~17.5 in-query figure overestimated by 38% — cross-category overlap dominates |
| Cross-category duplicate rate    | **~45%** — a business tagged with several categories is returned by each one's query                                   |
| Cross-tile overlap               | **0** measured between Downtown and Deira — tiles are disjoint                                                         |
| Phone format returned            | Local, never E.164 — `04 577 6680`, `052 253 3290`                                                                     |
| Free geo filters on every result | `country_code`, `city`, `timezone`                                                                                     |
| Category mess                    | Up to 9 `types[]` strings on a single business                                                                         |
| `types[]` ordering               | **Alphabetical, not ranked** — 85% of tails sorted. Carries no relevance signal                                        |
| Category saturation              | **15,246 businesses → 1,788 distinct** (0.117). Final marginal 4.3 per 100. 8.5x fewer LLM items. ADR 0006             |
| v0.1 crawl actuals               | 1,400 requests → 15,246 unique → 14,981 in Dubai. 0 errors                                                             |
| Area from provenance is wrong    | **52% of businesses** sat in a different tile than the query that found them. Assign by coordinates                    |
| Titles                           | Often bilingual — `Shamiat Restaurant مطعم شاميات - Dubai`                                                             |

Credit budget: 100k total, ~2,000 planned for the v0.1 crawl.

---

## Stack

TypeScript strict + ESM · **Node 24 LTS** (`nodejs24.x`) · pnpm workspaces ·
SST v4 · **`us-east-1`** · Lambda, SQS + DLQ, S3, DynamoDB single-table,
CloudFront + Route 53 · Next.js 16 App Router via OpenNext · Claude Haiku 4.5
(Batch API) for taxonomy · `libphonenumber-js/max` · Vitest.

Region rationale and its latency consequences: `docs/adr/0003-deploy-region.md`.

### Design

**Tailwind CSS v4 + shadcn/ui, strict black-and-white monochrome**, with
typography carrying the visual identity. Tailwind v4 is CSS-first — tokens go in
`@theme` in the stylesheet, not a `tailwind.config.js`. shadcn components are
vendored and trimmed to the neutral ramp.

Type: Instrument Serif (display) · Geist Sans (body) · IBM Plex Sans Arabic
(Arabic) · Geist Mono (tabular figures for phones, ratings, cost tables).

No brand hue. With no colour hierarchy, spacing and type scale carry all the
structure — so spacing errors are immediately visible and must be treated as
bugs. Bilingual titles need `dir="auto"`. Full rationale:
`docs/adr/0004-design-system.md`.

### Layout

| Package             | Role                                                      |
| ------------------- | --------------------------------------------------------- |
| `packages/core`     | Pure domain logic. No I/O, no AWS. Fully TDD'd.           |
| `packages/pipeline` | Offline batch: plan → fetch → normalise → classify → load |
| `packages/search`   | One hot-path Lambda for typeahead                         |
| `packages/web`      | Next.js. Reads DynamoDB directly from Server Components.  |

**There is deliberately no separate API service.** Next.js Server Components
query DynamoDB directly; inserting API Gateway would add a second cold start to
the latency numbers Milestone 2 exists to publish. Typeahead is the one
exception, because per-keystroke requests must not hit an SSR Lambda.

### Commands

```bash
pnpm test           # offline, fixtures only, costs nothing
pnpm typecheck
pnpm plan --list             # every city config in the repo
pnpm plan --city dubai       # build crawl plan, no API calls
pnpm crawl --city dubai --dry-run   # request count + credit cost BEFORE spending
pnpm crawl --city dubai --yes       # spends credits (--yes is required)
pnpm leads --list-signals    # prospect signals, no API calls
npx sst deploy --stage dev
```

Always run `--dry-run` and report the number before a real crawl.

---

## Agents

Specialised agents live in `.claude/agents/`. Prefer them over ad-hoc work:

| Agent               | Use for                                                       |
| ------------------- | ------------------------------------------------------------- |
| `pipeline-engineer` | Crawl stages, dedup, normalisation — the v0.1 core            |
| `taxonomy-curator`  | `data/taxonomy-map.json` quality and category corrections     |
| `data-guardian`     | Pre-commit/pre-release audit of secrets, dataset, takedown    |
| `cost-analyst`      | Credit, token, and AWS spend — the articles' headline metrics |
| `seo-engineer`      | Milestone 3 programmatic pages, sitemaps, schema              |

Run `data-guardian` before any release tag or before making the repo public.

---

## Writing style

This repo is publication material — every file may end up quoted in an article.
Comments should explain _why_, especially where a decision looks odd (the
`/max` phone metadata, the FNV-1a slug suffix, dropping Arabic rather than
transliterating). Prefer a sentence of reasoning over a restatement of the code.
