#!/usr/bin/env bash
# Stamps the current timestamp into the ?v= cache-busting values in
# index.html, so browsers always fetch the latest js/*.js and styles.css.
#
# Run this right before every upload:
#     ./stamp-version.sh
# then upload index.html, styles.css AND the js/ folder.
#
# Only the real <link ... styles.css> and <script ... src="js/..."> tags are
# changed - the explanatory comments in index.html are left alone.

set -euo pipefail
cd "$(dirname "$0")"

FILE="index.html"
VERSION="$(date +%Y%m%d-%H%M%S)"

[ -f "$FILE" ] || { echo "error: $FILE not found next to this script" >&2; exit 1; }

# 'sed -i.bak' + rm works the same on Linux, macOS and Git Bash for Windows.
sed -i.bak -E \
  -e "/<link[^>]*styles\.css/ s/(styles\.css\?v=)[^\"']*/\1${VERSION}/" \
  -e "/<script[^>]*src=\"js\/[^\"]*\.js/ s/(\.js\?v=)[^\"']*/\1${VERSION}/" \
  "$FILE"
rm -f "$FILE.bak"

# Fail loudly if a tag was missed or renamed, so a stale stamp can't slip through.
scripts="$(grep -c '<script[^>]*src="js/' "$FILE" || true)"
[ "$scripts" -gt 0 ] || { echo "error: no <script src=\"js/...\"> tags found in $FILE" >&2; exit 1; }
expected=$((scripts + 1))   # every script tag + the stylesheet
stamped="$(grep -c "?v=${VERSION}" "$FILE" || true)"
if [ "$stamped" -ne "$expected" ]; then
  echo "error: expected to stamp $expected tags in $FILE ($scripts scripts + styles.css), stamped $stamped" >&2
  exit 1
fi
unversioned="$(grep -E '<(script[^>]*src="js/|link[^>]*styles\.css)' "$FILE" | grep -vc '?v=' || true)"
if [ "$unversioned" -ne 0 ]; then
  echo "error: $unversioned local tag(s) in $FILE have no ?v= at all - add ?v=1 to them first" >&2
  exit 1
fi

echo "Stamped ?v=${VERSION} into styles.css and $scripts script tags in $FILE"
