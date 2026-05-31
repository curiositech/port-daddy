#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: bash scripts/install-soehne-trial.sh /path/to/klim-test-fonts.zip-or-folder" >&2
  exit 64
fi

source_path="$1"
if [[ ! -f "$source_path" && ! -d "$source_path" ]]; then
  echo "Söhne trial package not found: $source_path" >&2
  exit 66
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$repo_root/website-v2/public/fonts/soehne-trial"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$dest"

if [[ -d "$source_path" ]]; then
  search_root="$source_path"
elif command -v ditto >/dev/null 2>&1; then
  ditto -x -k "$source_path" "$tmp"
  search_root="$tmp"
else
  unzip -q "$source_path" -d "$tmp"
  search_root="$tmp"
fi

copy_first() {
  local output="$1"
  local style="$2"
  local width="$3"
  local mono="$4"
  shift 4
  local pattern
  local found=""

  while IFS= read -r -d '' file; do
    local lower
    lower="$(basename "$file" | tr '[:upper:]' '[:lower:]')"
    if [[ "$style" == "upright" && ( "$lower" == *"kursiv"* || "$lower" == *"italic"* ) ]]; then
      continue
    fi
    if [[ "$width" == "standard" && ( "$lower" == *"schmal"* || "$lower" == *"breit"* ) ]]; then
      continue
    fi
    if [[ "$mono" == "no-mono" && "$lower" == *"mono"* ]]; then
      continue
    fi
    if [[ "$mono" == "mono-only" && "$lower" != *"mono"* ]]; then
      continue
    fi
    local ok=1
    for pattern in "$@"; do
      if [[ "$lower" != *"$pattern"* ]]; then
        ok=0
        break
      fi
    done
    if [[ "$ok" -eq 1 ]]; then
      found="$file"
      break
    fi
  done < <(find "$search_root" -type f \( -iname '*sohne*.woff2' -o -iname '*soehne*.woff2' -o -iname '*söhne*.woff2' \) -print0)

  if [[ -z "$found" ]]; then
    echo "Missing trial file for $output; searched for: $*" >&2
    return 1
  fi

  cp "$found" "$dest/$output"
  echo "installed $output from $(basename "$found")"
}

copy_first "TestSohne-Buch.woff2" "upright" "standard" "no-mono" "buch" || copy_first "TestSohne-Buch.woff2" "upright" "standard" "no-mono" "book" || copy_first "TestSohne-Buch.woff2" "upright" "standard" "no-mono" "regular"
copy_first "TestSohne-Kraftig.woff2" "upright" "standard" "no-mono" "kraft" || copy_first "TestSohne-Kraftig.woff2" "upright" "standard" "no-mono" "kräft" || copy_first "TestSohne-Kraftig.woff2" "upright" "standard" "no-mono" "medium"
copy_first "TestSohne-Halbfett.woff2" "upright" "standard" "no-mono" "halb" || copy_first "TestSohne-Halbfett.woff2" "upright" "standard" "no-mono" "semi" || copy_first "TestSohne-Halbfett.woff2" "upright" "standard" "no-mono" "bold"

copy_first "TestSohneMono-Buch.woff2" "upright" "standard" "mono-only" "buch" || copy_first "TestSohneMono-Buch.woff2" "upright" "standard" "mono-only" "book" || copy_first "TestSohneMono-Buch.woff2" "upright" "standard" "mono-only" "regular"
copy_first "TestSohneMono-Kraftig.woff2" "upright" "standard" "mono-only" "kraft" || copy_first "TestSohneMono-Kraftig.woff2" "upright" "standard" "mono-only" "kräft" || copy_first "TestSohneMono-Kraftig.woff2" "upright" "standard" "mono-only" "medium"
copy_first "TestSohneMono-Halbfett.woff2" "upright" "standard" "mono-only" "halb" || copy_first "TestSohneMono-Halbfett.woff2" "upright" "standard" "mono-only" "semi" || copy_first "TestSohneMono-Halbfett.woff2" "upright" "standard" "mono-only" "bold"

echo "Söhne trial fonts installed in $dest"
