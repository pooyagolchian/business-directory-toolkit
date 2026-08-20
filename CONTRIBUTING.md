# Contributing

Thanks for looking. This project is built in public, so contributions and
corrections are genuinely welcome.

## The highest-value contribution

**Fix a wrong category mapping.** [`data/taxonomy-map.json`](./data/taxonomy-map.json)
maps Google's raw category strings onto a three-level taxonomy. It was generated
by an LLM, so some entries are wrong. Correcting one is a single-line pull
request that improves every business carrying that category.

```jsonc
{
  "Oyster bar restaurant": {
    "l1": "Food & Drink",
    "l2": "Restaurants",
    "l3": "Seafood", // ← if this is wrong, fix it and open a PR
  },
}
```

No need to run the crawl to make this change.

## Setup

```bash
pnpm install
pnpm test        # offline, uses recorded fixtures, costs nothing
```

You do **not** need a SearchApi key to run the test suite. You only need one to
run a live crawl.

## Ground rules

- **Never commit secrets.** `.env` is git-ignored. If you think you've committed
  a key, stop and read [SECURITY.md](./SECURITY.md).
- **Never commit crawled data.** `data/raw/` and `data/out/` are ignored on
  purpose — see [ADR 0002](./docs/adr/0002-do-not-redistribute-the-dataset.md).
- **Never spend credits in CI.** Tests run against recorded fixtures in
  `fixtures/`. If you need a new fixture, record it once and commit the JSON.
- **Business listings only.** Any change that would collect residential numbers
  or personal data will be declined.

## Workflow

1. Open an issue first for anything larger than a bug fix, so we don't duplicate work
2. Branch from `main`
3. Write the test first — the pure functions in `packages/core` are all TDD'd
4. `pnpm typecheck && pnpm test && pnpm lint` must pass
5. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`)
6. Open the PR against `main`

## Architecture decisions

Significant decisions are recorded in [`docs/adr/`](./docs/adr/). If you're
proposing something that contradicts an ADR, that's fine — but say so in the PR
and explain what changed.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
