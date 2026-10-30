#!/usr/bin/env bash
# Regenerates the icon and link-preview assets in client/public from the sources in client/design.
#   favicon.svg          -> public/favicon.svg (copied)
#   favicon-32.png       32x32 from favicon.svg
#   apple-touch-icon.png 180x180, full-bleed square (no rounded corners, no transparency)
#   icon-512.png         512x512 from favicon.svg
#   og.png               1200x630 from og.html
# Needs Google Chrome in /Applications. Override with CHROME=/path/to/chrome.
set -euo pipefail

DESIGN_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$DESIGN_DIR/../public"
mkdir -p "$PUBLIC_DIR"
PUBLIC_DIR="$(cd "$PUBLIC_DIR" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Headless Chrome writes the screenshot itself. Its exit status can be non-zero even when the PNG is fine,
# so success is judged by the output file.
# shot <html-file> <width> <height> <out-png>
shot() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files --virtual-time-budget=3000 \
    --no-first-run --no-default-browser-check --user-data-dir="$TMP/profile" \
    --window-size="$2,$3" --screenshot="$4" "file://$1" >/dev/null 2>&1 || true
  if [[ ! -s "$4" ]]; then
    echo "Chrome did not produce $4" >&2
    exit 1
  fi
  echo "wrote $4"
}

# icon_page <size> <svg-file-name> <html-out>: a page that shows one square SVG at exactly <size> px
icon_page() {
  cat > "$3" <<HTML
<!doctype html>
<html><head><meta charset="UTF-8"><style>
html,body{margin:0;padding:0;width:$1px;height:$1px;overflow:hidden;background:#0b0820}
img{display:block;width:$1px;height:$1px}
</style></head><body><img src="$2" alt=""></body></html>
HTML
}

# Icons: the favicon SVG itself, copied into public/ so the site can link to it
cp "$DESIGN_DIR/favicon.svg" "$PUBLIC_DIR/favicon.svg"
echo "wrote $PUBLIC_DIR/favicon.svg"

# Apple icons must be full-bleed, so use a copy of the SVG with square badge corners
sed '/id="badge"/s/rx="3"/rx="0"/' "$DESIGN_DIR/favicon.svg" > "$TMP/apple.svg"
cp "$DESIGN_DIR/favicon.svg" "$TMP/favicon.svg"

icon_page 32 favicon.svg "$TMP/favicon-32.html"
icon_page 512 favicon.svg "$TMP/icon-512.html"
icon_page 180 apple.svg "$TMP/apple-touch-icon.html"
shot "$TMP/favicon-32.html" 32 32 "$PUBLIC_DIR/favicon-32.png"
shot "$TMP/apple-touch-icon.html" 180 180 "$PUBLIC_DIR/apple-touch-icon.png"
shot "$TMP/icon-512.html" 512 512 "$PUBLIC_DIR/icon-512.png"

# Link preview: rendered straight from the design source
shot "$DESIGN_DIR/og.html" 1200 630 "$PUBLIC_DIR/og.png"

for f in favicon-32.png apple-touch-icon.png icon-512.png og.png; do
  sips -g pixelWidth -g pixelHeight "$PUBLIC_DIR/$f" | tail -n 2
done
