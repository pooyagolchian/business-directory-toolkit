# ADR 0004 — Monochrome design system on Tailwind v4 + shadcn/ui

- **Status:** Accepted
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

| Role             | Face                     | Why                                                            |
| ---------------- | ------------------------ | -------------------------------------------------------------- |
| Display/headings | **Instrument Serif**     | Editorial character; makes a business name feel like a title   |
| Body/UI          | **Geist Sans**           | Neutral grotesque, excellent at small sizes and dense listings |
| Arabic           | **IBM Plex Sans Arabic** | Real weight range and a genuine match to Latin body text       |
| Numerals/data    | **Geist Mono**           | Tabular figures for phone numbers, ratings, and cost tables    |

Load via `next/font` for self-hosting and zero layout shift. Phone numbers and
ratings must use tabular figures so columns align down a listing page.

Arabic gets a real face rather than a fallback. Bilingual titles should set
correctly inline, with `dir="auto"` on user-facing title elements.

### Components

shadcn/ui, vendored into the repo rather than installed as a dependency. It is
copy-in source, so components can be trimmed to the monochrome tokens instead of
carrying a theme the design does not use.

## Consequences

**Good:**

- Fast. Monochrome plus self-hosted fonts keeps Core Web Vitals healthy across
  10,000 pages, which is directly an SEO ranking input for Milestone 3
- Accessible by default: pure black on white starts at 21:1 contrast, so meeting
  WCAG AA takes effort to _fail_ rather than effort to achieve
- Cheap to extend. A new category or page type needs no new colour decisions
- Distinctive. Local directories are overwhelmingly blue-and-orange template work

**Bad:**

- No colour means no colour-coding, so information hierarchy rests entirely on
  scale, weight, and spacing. Sloppy spacing has nowhere to hide
- Four font families is a real payload; subset aggressively and load Arabic only
  on pages that contain Arabic
- Photography from Google listings will fight a monochrome shell. Thumbnails
  need consistent treatment or they become the loudest thing on the page

## Alternatives considered

- **Colour-coded categories.** Rejected: does not survive ~150 categories, and
  it is the standard directory look.
- **A single brand accent hue.** Deferred. Easy to add later as one token; hard
  to remove once pages are indexed with it.
