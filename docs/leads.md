# Leads from your own crawl

How to score a crawl you already ran into a ranked list of businesses with a fixable gap, using no extra credits.

## Find leads in your own crawl

The same crawl that builds a directory also answers a commercially useful
question: **which businesses have a fixable gap?**
[`pnpm leads`](../packages/pipeline/src/cli/leads.ts) scores your own
`data/out/businesses.json` against four signals and prints a ranked prospect
list. No new query, no credits — everything it reads is already on disk.

```bash
pnpm leads --list-signals
pnpm leads --signal no-website --category Restaurants --min-reviews 20
pnpm leads --signal weak-reputation --format csv --out data/out/leads.csv
```

| Signal            | Condition                     | Who buys                     | Leads |
| ----------------- | ----------------------------- | ---------------------------- | ----: |
| `no-website`      | No `website` field            | Web design, agencies         | 3,820 |
| `weak-reputation` | Rating < 3.8 with 20+ reviews | Reputation management        |   641 |
| `low-visibility`  | Fewer than 10 reviews         | Local SEO, review generation | 2,259 |
| `no-hours`        | No opening hours listed       | Listing-management services  |   892 |

Counted against the Dubai crawl's 13,811 businesses that carry a usable phone
number, not all 14,981 — see why below.

**These numbers are lower than the design spec's own signal counts** (4,633
businesses with no website at all, for one). That is deliberate, not a
discrepancy: `findLeads` runs `isContactable` before it scores anything and
drops every business with no phone number, because a lead nobody can call is
not a lead. The spec's table counts businesses that _have_ a gap; the table
above counts reachable prospects that have one. Of Dubai's 14,981 businesses,
13,811 (the same 92.2% phone-coverage ceiling documented under
[What the crawl actually measured](./findings.md#what-the-crawl-actually-measured)) clear
that bar, and only those are ever considered.

### One signal per run, always

`--signal` takes exactly one value. Omit it and the CLI exits before touching
any data; pass it twice and the CLI rejects that too, rather than quietly
scoring against whichever came first — discarding a flag someone typed is
worse than failing loudly. Scores are comparable only _within_ a signal: a
`no-website` score and a `weak-reputation` score both happen to be plain
numbers, but they describe different products sold to different buyers — a
web designer and a reputation-management firm are not competing for the same
call list, so ranking the two together would produce an order that means
nothing. Run the command again with a different `--signal` rather than
expecting one combined list.

### Scoring: successful businesses first

```
leadScore = signalStrength × establishment
```

`signalStrength` is how badly a business has the problem, normalised 0–1: a
constant `1.0` for `no-website` and `no-hours` (a business either has one or it
does not — there is no partial), scaled by distance below the threshold for
`weak-reputation` and `low-visibility` (a 2.0-rated business outranks a
3.7-rated one; zero reviews outranks nine).

`establishment` is `reviews / (reviews + m)`, where `m` is the corpus median
review count — 76 for the Dubai crawl. It measures how much evidence of real
trade a business has, and it is the half of the formula a filter cannot
express: the best lead is a **successful** business with a fixable gap, not
merely any business that happens to match one.

**Why not rank by rating.** The obvious health term is `rankScore`, the
credibility-weighted rating this directory sorts by
([`packages/core/src/rank.ts`](../packages/core/src/rank.ts)). It was the
original choice here and it was wrong, in a way only running it revealed. Every
`weak-reputation` lead sits below the corpus mean of 4.49 by definition, and
`rankScore` shrinks a business toward that mean less as its review count grows
— so it _falls_ as a business becomes more established. Measured across the 641
real reputation leads, score correlated with review count at **−0.28**: the more
trade a business had, the further down the call sheet it went. The list was
topped by bank ATMs with 23–37 reviews, and the most-reviewed business on it — a
3.6-rated hospital with 5,562 reviews — sat at **#522 of 641**, past the end of
the default view. After the change that correlation is **+0.08** and the same
hospital ranks **#271**.

It does not jump to first, and should not: at 3.6 it is only just below the 3.8
threshold, so its `signalStrength` is small. That is the formula working — a
severe problem at a mid-sized business outranks a mild problem at a large one.
What changed is that review volume stopped counting _against_ a prospect.

The rule that fixes it generalises, and is worth stating because it is easy to
break twice:

> **The health term must never be a function of the quantity the signal
> measures.** Otherwise the score double-counts the gap and inverts itself.

`weak-reputation` sells against a poor rating, so its health term must not use
rating — hence `establishment`, built from review count. Which is exactly why
`low-visibility` is the one exception below.

**The `low-visibility` exception.** That signal's gap _is_ the review count, so
`establishment` would double-count it in precisely the way `rankScore` did for
`weak-reputation` — the same mistake on the other axis. Its leads are therefore
ranked by gap severity alone, with no health multiplier.

Ties are broken by rating descending (a business with no rating at all sorts
last — unrated is not better than well-rated), then by `placeId`, so the order
is total and identical on every run rather than an artefact of the order the
crawler happened to visit tiles in.

One consequence worth knowing before you work the list: in the Dubai crawl, 481
businesses have no reviews at all, so they tie at the maximum score and fall
through to `placeId` order. They occupy the top of the `low-visibility` list
because they genuinely are the strongest instance of that gap — but their order
_relative to each other_ is arbitrary, not a ranking. Treat that band as a set,
not a queue.

### Suppression is enforced, not assumed

Every lead passes through the same
[`data/suppression-list.json`](../data/suppression-list.json), via
[`dropSuppressed`](../packages/core/src/suppression.ts), before it is ever
scored — a business that filed a takedown request under
[`TAKEDOWN.md`](../TAKEDOWN.md) must never resurface on a cold-call list. The
CLI prints how many were withheld on every run, including "0 withheld": the
point of reporting the number is that the filter stays visibly working, not
that it only speaks up when it has something to hide.

A malformed suppression list — invalid JSON, or an entry that is not a
string — stops the run with a non-zero exit rather than being treated as
empty. Only a _missing_ file reads as "no takedowns yet"; a broken one does
not, because silently swallowing the error would print a clean "0 withheld"
while the business it was meant to suppress quietly reappears at the top of
the call list — the one failure mode this feature cannot afford, because the
output would look correct.

Every entry is trimmed on load
([`parseSuppressionList`](../packages/core/src/suppression.ts)), so a stray
leading or trailing space — the likeliest slip when a `place_id` is
copy-pasted out of a takedown request — still matches. What is **not**
forgiven is case: matching is an exact, case-sensitive string comparison
against `place_id`, because `place_id` is an opaque token Google assigns
rather than something a person types from memory or would notice is wrong.
Hand-editing the wrong case into an entry produces a silent non-match — the
entry sits in the file looking correct, and the business it was meant to
suppress keeps showing up anyway.

### Flags

| Flag                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--signal <name>`           | Required. One of `no-website`, `weak-reputation`, `low-visibility`, `no-hours`.                                                                                                                                                                                                                                                                                                                 |
| `--category <name>`         | Restrict to one `l2`/`l3` category, e.g. `Restaurants`.                                                                                                                                                                                                                                                                                                                                         |
| `--area <slug>`             | Restrict to one area, e.g. `dubai-marina`.                                                                                                                                                                                                                                                                                                                                                      |
| `--min-reviews <n>`         | Drop businesses under this review count.                                                                                                                                                                                                                                                                                                                                                        |
| `--min-rating <n>`          | Drop businesses under this rating.                                                                                                                                                                                                                                                                                                                                                              |
| `--limit <n>`               | Cap the ranked list.                                                                                                                                                                                                                                                                                                                                                                            |
| `--format table\|csv\|json` | `table` (default) prints the top 40 to the terminal. `csv` reuses the export CLI's writer — RFC 4180 quoting, UTF-8 BOM — so it opens correctly in Excel. `json` is the full `Lead[]`.                                                                                                                                                                                                          |
| `--out <path>`              | Write leads straight to a file. This is the only reliable way to get a clean one — `pnpm`'s own banner (the `WARN Unsupported engine`/`> business-directory-toolkit@... leads ...` lines) writes to stdout ahead of the CLI's own output on every invocation, so `pnpm leads --format csv > file.csv` puts that banner inside the file too. `--out` bypasses stdout entirely and never sees it. |
| `--list-signals`            | Print what each signal means and exit 0. Does not need a crawl on disk.                                                                                                                                                                                                                                                                                                                         |

Filters compose: `--signal no-website --category Restaurants --min-reviews 20`
narrows the 13,811 contactable businesses to 1,019 Restaurants with 20+
reviews, of which 321 have no website.

### The consent notice

`pnpm leads` prints this on every run that produces a list — `--list-signals`
exits before reaching this point:

> These are business listings, not permission to contact. Unsolicited
> commercial messaging is regulated wherever these businesses operate — this
> toolkit is not scoped to one jurisdiction (a city here is data, not code), so
> check the rules that apply to YOUR crawl before you use this list.

A phone number surfaced by a crawl is not an opt-in, and the CLI says so every
time rather than once in a README nobody reads before running the tool.
