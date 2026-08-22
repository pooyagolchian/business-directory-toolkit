# The SearchApi wordmark

**These files are SearchApi's trademark, not this project's.** They are here to
credit the engine the crawl runs on, under the SearchApi Developer Ambassador
Program. The MIT licence on this repository covers the code and does not extend
to them: forking this repository does not carry a licence to use SearchApi's
mark, and a fork that keeps the crawler but points it at another provider should
delete this directory rather than inherit it.

This project's own mark is typographic — the word "Directory" set in Instrument
Serif, plus the black "D" in `packages/web/app/icon.svg`. That is deliberate and
is the subject of [ADR 0004](../docs/adr/0004-design-system.md). The wordmark
here is an attribution, and the amendment to that ADR is where the boundary
between the two is written down.

## The files

| File                   | What it is                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `search-api.svg`       | The vendor original, exactly as supplied. Never hand-edited — it is the provenance. |
| `search-api-light.svg` | Generated. Black ink, for a light background.                                       |
| `search-api-dark.svg`  | Generated. White ink, for a dark background.                                        |
| `derive.mjs`           | Regenerates both variants from the original: `node logo/derive.mjs`.                |

Nothing here is served by the site. The web app inlines the same geometry with
`fill="currentColor"` in
[`packages/web/components/search-api-logo.tsx`](../packages/web/components/search-api-logo.tsx),
so one component takes its ink from whichever chrome it sits in — `--muted` at
both sites today — and follows the token swap when dark mode lands. `derive.mjs` prints that JSX body
too, so re-syncing after a vendor logo update is a paste rather than a
transcription.

## Why there are two colour variants at all

Because GitHub is the one place `currentColor` cannot reach. A README image is
an `<img>`, and `currentColor` inside an `<img>`-loaded SVG resolves against the
SVG's own initial value — black — not against the page around it. A single file
would therefore render black-on-near-black for every reader using GitHub's dark
theme. `README.md` picks between the two with a `<picture>` element.

**Do not put that `<a>` and `<picture>` on the same line.** CommonMark only
opens an HTML block when the open tag is alone on its line, and `source` is one
of the tags allowed to interrupt a paragraph — so `<a ...><picture>` together
parses as inline HTML, GitHub hoists the `<source>` out of the `<picture>`,
renders the `<picture>` empty inside the link, and auto-links the bare `<img>`
to the raw SVG. The result looks fine locally and is broken on github.com: the
dark variant is never chosen and the mark no longer links to SearchApi. Verified
both ways against `POST https://api.github.com/markdown`, which is the same
renderer the repository page uses.

## What the derive step changes, and what it must not

`derive.mjs` drops the Sketch export's `<defs>`, its `mask-2` and the `<use>`
that feeds it. That mask is a rectangle from `0,0` to `426.31,87.66`, which is
larger than every shape it masks, so removing it changes no pixel — and it
removes the one thing that would break if two copies of the mark ever met on the
same page: duplicate element IDs. Coordinates are rounded to two decimals, which
at the ~78px this renders at is 0.0018px, and returns close to half the bytes.

It keeps `fill-rule="evenodd"` from the wrapping `<g>`. Measured, that rule
changes nothing here — the four letters with counters wind their inner subpath
against the outer one, so `nonzero` renders identically — but it is what the
source declares, and a future vendor update could ship counters that wind the
other way.

It also **rewrites the intrinsic size to match the viewBox**, which is a bug
fix rather than a tidy-up. The original declares `width="257.2589683389664"`
and `height="63.92396926879883"`, an aspect of 4.02 against the viewBox's 4.85.
Under the default `preserveAspectRatio` that letterboxes the artwork to 83% of
the height it asks for, anywhere the intrinsic size is honoured — an `<img>` in
a README being exactly such a place. Rasterised at 1708×352, the original
covers 118,969 ink pixels where the same geometry with an agreeing viewport
covers 143,359.

The whole derivation is verified rather than asserted: rendering the vendor
original with only its viewport corrected, against the generated variant, gives
zero pixels differing by more than a quarter-channel and 462 of 601,216
(0.08%) differing at all — antialiasing along curve edges, from the rounding.
