# Brand

The xtandard-links mark is the xtandard **X** — a chevron (`>`, a request passing through) crossed
by a second stroke — where the upper-right stroke is a **two-link chain**. It sits on the family's
near-black rounded tile between faint `< >` brackets with orbit lines, like
[xtandard-flags](https://github.com/xantiagoma/xtandard-flags) (a flag) and
[xtandard-webhooks](https://github.com/xantiagoma/xtandard-webhooks) (a hook). It uses the family's
**lime**; the chain is what makes it links.

Everything lives in [`docs/assets/`](assets/). The SVGs are the masters and are themselves generated
from the geometry in [`scripts/brand/`](../scripts/brand/); every PNG and ICO is rendered from the
masters. Rebuild after any change:

```sh
sh scripts/brand-assets.sh          # masters + rasters + the copies in site/public and src/ui/public
sh scripts/brand-assets.sh --check  # everything present, copies equal to docs/assets
```

It needs `uv` (fonttools + uharfbuzz for the wordmark outlines), `rsvg-convert` (librsvg) and
`magick` (ImageMagick 7); `oxipng` is used when installed.

## Files

| File                                                                  | What it is                                                                                  | Use it for                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `logo.svg`                                                            | App icon: the mark on the near-black tile with brackets, orbit lines and a soft shadow      | The master for every square raster                                                                                                  |
| `logo.png` (1024), `logo-256.png`, `logo-128.png`                     | App icon rasters                                                                            | README/npm header (`logo-128.png`, or `logo-256.png` at `width="128"`), avatars, the GitHub repository picture, the GHCR image logo |
| `symbol.svg`, `symbol.png` (256 high)                                 | The X + chain alone, transparent                                                            | Inline UI (the admin navbar), places that draw their own surface                                                                    |
| `lockup-horizontal-dark.svg` / `.png` (2×)                            | Symbol + wordmark, `xtandard-` in near-white                                                | Headers on dark backgrounds (README in GitHub dark mode, the docs site in dark mode)                                                |
| `lockup-horizontal-light.svg` / `.png` (2×)                           | Symbol (deeper lime) + wordmark, `xtandard-` in ink                                         | Headers on light backgrounds (README in light mode, npm, the docs site)                                                             |
| `lockup-stacked-{dark,light}.svg` / `.png` (2×)                       | Symbol left, `xtandard-` over `links`                                                       | Square-ish slots: slides, sidebars, stickers                                                                                        |
| `monochrome-white.svg`, `monochrome-black.svg`                        | One-colour horizontal lockup                                                                | Photos and busy backgrounds (white); one-colour print (black)                                                                       |
| `favicon.svg`, `favicon.ico` (16/32/48), `apple-touch-icon.png` (180) | The tile + mark without orbit, brackets and shadow, with a bolder chain that survives 16 px | Browser tabs: the docs site and the admin UI                                                                                        |
| `social.svg`, `social.png` (1280×640)                                 | Social card: icon, wordmark, tagline, `bun add` line                                        | The GitHub social preview (Settings → General → Social preview, uploaded by hand) and the docs site's `og:image`                    |

### Where each file goes

- **README header**: a `<picture>` choosing `lockup-horizontal-dark.png` / `-light.png` with
  `prefers-color-scheme`. The README ships to npm, which does not ship `docs/`, so the header uses
  absolute `raw.githubusercontent.com` URLs.
- **Docs site** (`site/`): the light/dark lockups as the Starlight logo, `favicon.svg` + `favicon.ico`
  - `apple-touch-icon.png` in the head, `social.png` as `og:image`/`twitter:image`.
- **Admin UI and analytics widget** (`src/ui/`): `symbol.svg` in the navbar next to the title (unless
  the host passes `logoUrl`), the favicon set in `index.html`. The React embeds render inside the
  host's page and show no favicon.
- **Container image**: no OCI logo annotation exists; upload `logo-256.png` where a registry asks.

## Palette

| Token                 | Hex                   | Role                                                |
| --------------------- | --------------------- | --------------------------------------------------- |
| `xl-lime-hi`          | `#D2F55A`             | Gradient start (top left) on dark                   |
| `xl-lime`             | `#A6E22A`             | Gradient middle; the brand colour in one word       |
| `xl-lime-deep`        | `#79BC12`             | Gradient end (bottom right) on dark                 |
| `xl-lime-light-start` | `#A9DE2C`             | Symbol gradient start on light backgrounds          |
| `xl-lime-on-light`    | `#5E9E08`             | Symbol gradient end on light backgrounds            |
| `xl-word-on-light`    | `#79B713` → `#4C8A06` | `links` in light lockups                            |
| `xl-word-on-dark`     | `#D2F55A` → `#8CD11C` | `links` in dark lockups                             |
| `xl-tagline`          | `#C4EE5C`             | Social-card tagline                                 |
| `xl-ink`              | `#0F1215`             | Tile and dark page background, `xtandard-` on light |
| `xl-orbit`            | `#4E5459`             | Brackets, orbit lines and dots                      |
| `xl-slate`            | `#8B939C`             | Secondary text on ink (the social-card command)     |
| `xl-paper`            | `#FAFAFA`             | `xtandard-` on dark                                 |

Lime is an artwork colour, not a text colour on white: for links and buttons on light surfaces use
`xl-lime-on-light` (or darker); on dark surfaces `xl-lime` reads well. The UI keeps the siblings'
neutral palette and uses lime as its accent.

## Wordmark

`xtandard-links` in **Urbanist** Black (900), tracking −1.2%, shaped with HarfBuzz and converted to
paths (no font needed to render the SVGs). `xtandard-` is ink on light and paper on dark; `links` is
always a lime gradient. The social card adds Urbanist SemiBold (600) for the tagline and
**JetBrains Mono** Regular for the command. Both fonts are SIL Open Font License 1.1; the SVGs carry
glyph outlines, not font software (credited in [NOTICE](../NOTICE)).

## Geometry

Icon space is 1024 × 1024, corner radius 224 (21.9%), the family's tile, rim, orbit and shadow.

- **Chevron**: `(292,300) (400,300) (588,512) (400,724) (292,724) (480,512)`; corners rounded by a
  22-unit same-paint stroke.
- **Lower-right stroke**: continues the chevron's upper diagonal past a 62-unit horizontal gap.
- **Chain**: two stadium rings (178 × 96, stroke 33) along the chevron's lower diagonal (−48.4°),
  starting after the same gap; ring B sits 60% of a ring's length further along. At the two
  crossings each ring passes under the other once (9-unit cut), so the links interlock. The favicon
  uses a 44-unit stroke and a 13-unit cut.
- **Brackets**: `<` and `>` 34-unit strokes in `xl-orbit`, centred vertically at x 168–232 and 856–920.

**Clear space**: a ring's width (about 10% of the symbol's height) on every side of the symbol or a
lockup; 10% of the tile's width outside the app icon.

**Minimum sizes**: app icon 48 px (use the favicon below that), symbol 20 px high, horizontal lockup
20 px high, stacked lockup 48 px high.

## Do and don't

Do: use dark lockups on dark backgrounds and light lockups on light ones (`<picture>` +
`prefers-color-scheme` on GitHub); use the app icon wherever a square avatar is expected; use the
monochrome lockups on photos and in one-colour print.

Don't: recolour the mark (it is lime, like the family; no blue — that is xtandard-image's), flatten
or reverse the gradients, set the wordmark in another font or as live text, put the dark lockup on a
light background, stretch/rotate/outline the symbol, or swap the chain for another glyph.
