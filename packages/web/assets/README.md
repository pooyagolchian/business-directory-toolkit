# Vendored fonts

These two faces exist **only** for the Open Graph card in
`app/opengraph-image.tsx`. Everything the browser renders is served by
`next/font` from `app/layout.tsx` and does not come from here.

They are duplicated rather than shared because the OG rasteriser and the browser
cannot read the same file. `ImageResponse` uses Satori, which accepts
`ttf`/`otf`/`woff` and **not `woff2`** — and `woff2` is the only format
`next/font` emits. Without an explicit `fonts:` array Satori falls back silently
to its own bundled `Geist-Regular.ttf`, which would ship the card in the exact
typeface `docs/adr/0004-design-system.md` records as considered and rejected.
A wrong-brand card that typechecks clean is worse than a build error.

| File                          | Source                                                                        | Licence                             |
| ----------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| `InstrumentSerif-Regular.ttf` | [google/fonts](https://github.com/google/fonts/tree/main/ofl/instrumentserif) | OFL 1.1 — `OFL-InstrumentSerif.txt` |
| `IBMPlexSans-Regular.ttf`     | [IBM/plex](https://github.com/IBM/plex)                                       | OFL 1.1 — `OFL-IBMPlexSans.txt`     |

Both are OFL 1.1, which permits redistribution inside this repository.

**Static instances, not variable.** The variable `IBMPlexSans[wdth,wght].ttf` is
537 KB on its own, and `ImageResponse` caps the whole bundle — JSX, CSS, fonts,
assets — at 500 KB. These two total ~270 KB. Check that budget before adding a
third face.
