# ADR 0004 — Monochrome design system on Tailwind v4 + shadcn/ui

- **Status:** Accepted · revised 2026-08-21 · amended 2026-08-22
- **Date:** 2026-08-20

## Context

The directory is ~10,000 mostly-identical pages: a business name, a category, an
area, a phone number, some hours. Content density is the entire product. A
directory lives or dies on whether a page is _scannable_, not on whether it is
decorated.

There is also a constraint most directory designs ignore: the content is
**bilingual**. Listing titles arrive as `Shamiat Restaurant مطعم شاميات - Dubai`.
A type system that only considers Latin script will render half the corpus badly.

## Decision

**Tailwind CSS v4 + shadcn/ui, in strict black-and-white monochrome, with
typography carrying the entire visual identity.**

### Colour

No brand hue. Neutral ramp only — pure black through pure white — plus the
minimum functional colour the interface genuinely requires (a focus ring, and a
single accent for destructive/error states, which are accessibility
requirements rather than decoration).

Monochrome is a deliberate fit here, not minimalism for its own sake:

- Category badges across ~150 categories would need 150 distinguishable colours.
  In monochrome they are typographic instead, and stay legible at any count.
- Ratings, open/closed state, and price tier all read through weight and
  contrast rather than competing hues.
- It removes the single most common way a programmatic-SEO site looks cheap.

Tailwind v4 is **CSS-first**: tokens are declared with `@theme` in the
stylesheet, not in a `tailwind.config.js`. Define the neutral ramp once there and
let shadcn components inherit it. Dark mode is a token swap, not a second design.

### Typography

Typography is the design, so it gets a real budget:

| Role             | Face                     | Why                                                                     |
| ---------------- | ------------------------ | ----------------------------------------------------------------------- |
| Display/headings | **Instrument Serif**     | Editorial character; makes a business name feel like a title            |
| Body/UI          | **IBM Plex Sans**        | Tall x-height, open apertures, and the Latin sibling of the Arabic face |
| Arabic           | **IBM Plex Sans Arabic** | Real weight range and a genuine match to Latin body text                |
| Numerals/data    | **IBM Plex Mono**        | Tabular figures for phone numbers, ratings, and cost tables             |

Load via `next/font` for self-hosting and zero layout shift. Phone numbers and
ratings must use tabular figures so columns align down a listing page.

Arabic gets a real face rather than a fallback. Bilingual titles should set
correctly inline, with `dir="auto"` on user-facing title elements. The Arabic
face is also appended to the Latin stacks, not only bound to `:lang(ar)` —
bilingual titles carry `dir="auto"` but no `lang`, so the Arabic run is resolved
by per-character font fallback and would otherwise drop to a system default.

**Instrument Serif is display-only.** It is a high-contrast face whose hairlines
thin out below roughly 22px, so it sets headings and the wordmark and nothing
else. Rows in a results list are scanned rather than read, and they use the sans
at 600 instead.

The scale is defined once, centrally, in the `@theme` block — including a
`line-height` for every step. Leading is the largest single readability lever
here and the one that never stays consistent when it is set per call-site.
Steps are tight (~1.13) through the reading sizes and open up (~1.22) through
the display sizes, so the jump between a heading and its body does the work a
colour change would normally do.

### Revision — 2026-08-21

The first implementation shipped a body scale that was too small to read: most
content sat at 12–14px, and a hard-coded 10px appeared 21 times, carrying the
category and area on every listing row. Rebuilt around a 17px base. Two changes
worth recording because they are easy to reintroduce:

- `-webkit-font-smoothing: antialiased` was removed. It thins every stem by
  roughly a subpixel, which is the wrong trade in a design whose entire
  hierarchy is stroke weight and size.
- `--muted` moved from ink-500 to ink-600 (4.65:1 → 6.5:1) and `--field-border`
  from ink-300 to ink-400 (2.15:1 → 3.4:1). This document originally claimed
  that "meeting WCAG AA takes effort to _fail_". That held for the
  black-on-white body text and quietly did not hold for the secondary text and
  field borders built on the mid ramp; the Good list below has been corrected
  and the failure moved to the Bad list, where it belongs.
- **Arabic was never actually rendering in the Arabic face.** The section above
  says "Arabic gets a real face rather than a fallback"; it had not been true in
  practice. `next/font` folds a synthetic `local(Arial)` fallback into the
  variable it returns, and unlike every real face it emits, that one carries no
  `unicode-range` — so it matched the Arabic run in bilingual titles before the
  stack reached IBM Plex Sans Arabic. Fixed by naming the real families in
  `--font-sans` / `--font-display` so the Arabic face sits ahead of the
  catch-all; `adjustFontFallback: false` does not work, because Turbopack
  ignores it. The full reasoning is in `globals.css`.

  This is worth a standing check rather than a one-off note, because nothing
  about it is visible in the CSS you wrote — only in what the browser chose.
  `CSS.getPlatformFontsForNode` over CDP reports the faces that actually
  rendered; a bilingual title must come back as IBM Plex Sans + IBM Plex Sans
  Arabic, never Arial or Times New Roman.

### Components

shadcn/ui, vendored into the repo rather than installed as a dependency. It is
copy-in source, so components can be trimmed to the monochrome tokens instead of
carrying a theme the design does not use.

## Consequences

**Good:**

- Fast. Monochrome plus self-hosted fonts keeps Core Web Vitals healthy across
  10,000 pages, which is directly an SEO ranking input for Milestone 3
- Accessible by default _for body text_: pure black on white starts at 21:1
  contrast. See the Bad list for where that stopped being true
- Cheap to extend. A new category or page type needs no new colour decisions
- Distinctive. Local directories are overwhelmingly blue-and-orange template work

**Bad:**

- No colour means no colour-coding, so information hierarchy rests entirely on
  scale, weight, and spacing. Sloppy spacing has nowhere to hide
- **The 21:1 claim held for body text and quietly did not hold for anything
  built on the mid ramp.** `--muted` shipped at 4.65:1 and `--field-border` at
  2.15:1 — the second is below AA for non-text contrast — and nothing caught
  either until the ramp was re-measured on 2026-08-21. A design whose selling
  point is that failing AA takes effort is a design nobody thinks to measure
- **Four font families is a real payload**, carried on every one of ~10,000
  pages, against a Good-list entry that claims the design is fast. Arabic loads
  on pages that contain no Arabic, because a bilingual title cannot be
  identified before render
- Photography from Google listings will fight a monochrome shell. Thumbnails
  need consistent treatment or they become the loudest thing on the page

## What this contradicts in the repository

`CLAUDE.md`'s Design section still lists the type stack as "Instrument Serif
(display) · Geist Sans (body) · IBM Plex Sans Arabic (Arabic) · Geist Mono".
That was the original choice and it is no longer what ships: `layout.tsx` and
`globals.css` load IBM Plex Sans and IBM Plex Mono, which is what the table
above records and what the Arabic fix in the 2026-08-21 revision depends on —
the Latin body face is the sibling of the Arabic face on purpose. The table here
is correct; `CLAUDE.md` is stale.

## Alternatives considered

- **Colour-coded categories.** Rejected: does not survive ~150 categories, and
  it is the standard directory look.
- **A single brand accent hue.** Deferred. Easy to add later as one token; hard
  to remove once pages are indexed with it.

## Amendment, 2026-08-22 — colour as magnitude

The home page now carries an interactive statistics section whose lead chart is
a rating-against-review-count grid, in the shape of GitHub's contribution
graph. It uses colour, and the ruling above says the design has none. Both are
true, because they are about different jobs.

What this ADR rejected is colour as **identity**: one hue per category, across
~150 categories, none of them distinguishable from the next. That reasoning is
unchanged and still binding. What the grid needs is colour as **magnitude** —
one hue, light to dark, encoding "how many businesses are in this cell". A
sequential scale needs exactly one hue no matter how much data it covers, so
the argument that killed category colours does not reach it.

The scope is narrow and worth writing down, because "we added a green" is
exactly the kind of decision that spreads:

- Five steps, declared in `globals.css` as `--color-level-0` … `--color-level-4`,
  mapped through `--chart-level-*` and `--chart-mark*` in the semantic layer.
  Components never touch the palette steps directly.
- **Charts only.** Not links, not buttons, not badges, not category chips, not
  state. The deferred brand accent above is still deferred, and this is not it.
- Level 0 is the neutral `#ebedf0`, deliberately outside the green ramp: an
  empty cell means "no businesses", which is a different statement from "a few",
  and must not read as the palest value.
- The values are GitHub's own contribution palette, kept literally rather than
  re-derived. Recognisability is the point — readers already know how to read
  this grid, and that familiarity is worth more than a bespoke green.

Two consequences accepted knowingly:

- GitHub's palest green does not clear WCAG 1.4.11's 3:1 against paper. The grid
  therefore never encodes by colour alone: every non-empty cell prints its own
  count, every cell carries a hairline edge, and the section keeps its table
  view. Colour is the at-a-glance channel, not the only one.
- The ramp is light-mode only for now, matching the rest of the app. GitHub's
  dark counterpart (`#161b22`, `#0e4429`, `#006d32`, `#26a641`, `#39d353`) is
  the intended set when dark mode lands, and the tokens are already layered so
  that it is a swap rather than a rewrite.

## Amendment, 2026-08-22 — one borrowed mark

The site header and the README now carry SearchApi's wordmark, and
`chrome.tsx` said in as many words that there is no mark. Both are true,
because they are about different things.

What this ADR rejected is a mark as **identity** — a logo standing in for the
project, competing with a masthead that was given a full type step precisely so
it could be the one fixed thing on every page. That reasoning is unchanged and
still binding: this project's own mark is still the word "Directory" in
Instrument Serif, and the favicon is still the typographic "D". What the header
now carries is a mark as **attribution**: a statement about which engine the
data came from, which is a claim only SearchApi's own mark can make, and which
the design has no typographic way to say. The argument that killed a logo for
this project does not reach a credit to someone else's.

The scope is narrow and worth writing down, because "we added a logo" is
exactly the kind of decision that spreads:

- **Attribution only.** Beside the masthead behind a rule, and in the footer
  where the word "SearchApi" already was. Not a favicon, not an OG image, not
  an app icon, not a hero. `packages/web/app/icon.svg` stays the "D".
- It always links to `https://www.searchapi.io/` and always sits next to the
  words that name the relationship — "Built on", "Data via" — so it reads as a
  credit rather than as ownership.
- Inlined as `fill="currentColor"` in one component, so it takes its ink from
  whichever chrome it sits in rather than carrying a colour prop or a second
  asset. Both sites are `--muted` today — that is what keeps the credit
  subordinate to a masthead set in full ink — and the mark follows the token
  swap when dark mode lands.
- The mark is a trademark and the MIT grant does not cover it. `logo/README.md`
  says so, the Licence section of `README.md` says so, and a fork pointed at
  another provider is expected to delete `logo/`.

Three consequences accepted knowingly:

- The design is no longer purely typographic. That was a real property and it
  is now qualified rather than true, which is why this is an amendment and not
  a footnote.
- The credit is hidden below the `sm` breakpoint. At 375px the masthead and nav
  already use the full column, and the footer credit — which wraps — is what
  carries the attribution on a phone. A credit nobody can read is worse than
  one that appears at a width that fits it.
- The geometry ships inline in the HTML of every page, twice, rather than as
  one cached request. That is deliberate — `next.config.ts` treats an extra
  origin hit on a normal pageview as a bug when the origin is ~250ms away — and
  it turned out to be cheaper than the argument for it needed: measured on
  `/areas`, the two copies are 11,036 bytes of markup raw (2 × 5,518), but they
  add **417 bytes** to the gzipped response, because the second copy is a
  byte-identical duplicate and path data compresses well. Rounding coordinates
  to two decimals in `derive.mjs` is what keeps the raw figure that low.
