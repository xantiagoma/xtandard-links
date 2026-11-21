#!/bin/sh
# Rebuilds the brand kit in docs/assets/ (docs/BRAND.md): the SVG masters from the geometry in
# scripts/brand/*.py, then the few required rasters (social card, head icon fallbacks), then the copies the docs site
# and the admin UI serve.
#
#   sh scripts/brand-assets.sh           rebuild everything
#   sh scripts/brand-assets.sh --check   fail when a master, raster or copy is missing or stale
#
# Needs uv (runs the Python generator with fonttools + uharfbuzz), rsvg-convert (librsvg) and
# magick (ImageMagick 7); oxipng is used when present. The wordmark is outlined from Urbanist
# (OFL 1.1) and the social card's command from JetBrains Mono (OFL 1.1); both fonts are downloaded
# from google/fonts into a cache directory, never committed. The SVGs contain only paths.
set -eu
cd "$(dirname "$0")/.."

a=docs/assets
copies='site/public:favicon.svg site/public:favicon.ico site/public:apple-touch-icon.png site/public:social.png site/public:symbol.svg src/ui/public:favicon.svg src/ui/public:favicon.ico src/ui/public:apple-touch-icon.png src/ui/public:symbol.svg'

# Rasters exist only where a format requires one and nobody sees it as an on-page logo:
# the social card (og:image must be raster) and the <head> icon fallbacks. Every logo, symbol
# and lockup shown on a page is the SVG master itself.
rasters='
apple-touch-icon.png logo.svg
social.png social.svg -w 1280 -h 640
favicon.ico favicon.svg
'

if [ "${1:-}" = "--check" ]; then
  status=0
  printf '%s\n' "$rasters" | while read -r out src _; do
    [ -n "$out" ] || continue
    if [ ! -f "$a/$out" ] || [ ! -f "$a/$src" ]; then
      echo "brand-assets: $a/$out or its master $a/$src is missing (run sh scripts/brand-assets.sh)" >&2
      exit 1
    fi
  done || status=1
  for c in $copies; do
    dir=${c%%:*}; f=${c#*:}
    if ! cmp -s "$a/$f" "$dir/$f"; then
      echo "brand-assets: $dir/$f differs from $a/$f (run sh scripts/brand-assets.sh)" >&2
      status=1
    fi
  done
  exit "$status"
fi

for tool in uv rsvg-convert magick; do
  command -v "$tool" >/dev/null || { echo "brand-assets: $tool not found" >&2; exit 1; }
done

fonts="${XDG_CACHE_HOME:-$HOME/.cache}/xtandard-links-brand"
mkdir -p "$fonts"
[ -s "$fonts/Urbanist.ttf" ] ||
  curl -fsSLo "$fonts/Urbanist.ttf" "https://github.com/google/fonts/raw/main/ofl/urbanist/Urbanist%5Bwght%5D.ttf"
[ -s "$fonts/JetBrainsMono.ttf" ] ||
  curl -fsSLo "$fonts/JetBrainsMono.ttf" "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf"

(cd scripts/brand && BRAND_FONTS="$fonts" uv run -q --with fonttools --with uharfbuzz python build.py "../../$a")

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf '%s\n' "$rasters" | while read -r out src args; do
  [ -n "$out" ] || continue
  case "$out" in
    favicon.ico)
      for s in 16 32 48; do rsvg-convert -w "$s" -h "$s" "$a/$src" -o "$tmp/fav-$s.png"; done
      magick "$tmp/fav-16.png" "$tmp/fav-32.png" "$tmp/fav-48.png" "$a/$out"
      ;;
    apple-touch-icon.png)
      # iOS masks the icon itself and shows transparency as black: render full-bleed, no alpha.
      rsvg-convert -w 180 -h 180 "$a/$src" -o "$tmp/touch.png"
      magick "$tmp/touch.png" -background '#0F1215' -flatten -alpha off "$a/$out"
      ;;
    *)
      # shellcheck disable=SC2086 # args is a word list on purpose
      rsvg-convert $args "$a/$src" -o "$a/$out"
      ;;
  esac
done

if command -v oxipng >/dev/null; then oxipng -q -o max "$a/apple-touch-icon.png" "$a/social.png"; fi

for c in $copies; do
  dir=${c%%:*}; f=${c#*:}
  mkdir -p "$dir"
  cp "$a/$f" "$dir/$f"
done
echo "brand-assets: rebuilt $a"
