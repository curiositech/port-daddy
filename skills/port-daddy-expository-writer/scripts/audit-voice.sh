#!/usr/bin/env bash
# audit-voice.sh — grep a draft for banned phrases and print offenders with line numbers.
#
# Usage:
#   scripts/audit-voice.sh <draft.md> [<draft2.md> ...]
#
# Exit status:
#   0 — no banned phrases found
#   1 — banned phrases found (count printed to stderr)
#   2 — usage error
#
# Banned phrases are case-insensitive. To allow a hit, add an /* exception: ... */
# comment on the same line; the script reports such lines separately so a human
# can confirm the exception is defensible.

set -uo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <draft.md> [<draft2.md> ...]" >&2
  exit 2
fi

# Phrase lists. Tweak here as the corpus grows.
banned_phrases=(
  "we believe"
  "we think"
  "our mission"
  "in this section"
  "in this piece"
  "in this post"
  "we will see"
  "we will explore"
  "we will cover"
  "let's dive"
  "let us dive"
  "let's explore"
  "let us explore"
  "powerful"
  "robust"
  "seamless"
  "delightful"
  "magical"
  "imagine if"
  "simply,"
  "simply put"
  "just \(do\|run\|type\|use\)"
  "loved by"
  "trusted by"
  "transform your"
  "supercharge"
  "unlock the"
  "built different"
  "reimagined"
  "next-generation"
  "it's that simple"
  "as is well known"
  "clearly,"
  "obviously,"
  "trivially,"
  "left as an exercise"
  "as shown above"
  "as we will see"
  "in some sense"
)

total_hits=0
exception_hits=0

for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "audit-voice: not a file: $file" >&2
    exit 2
  fi

  for phrase in "${banned_phrases[@]}"; do
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      if printf '%s\n' "$line" | grep -qF '/* exception:'; then
        exception_hits=$((exception_hits + 1))
        echo "EXCEPTION  $file:$line"
      else
        total_hits=$((total_hits + 1))
        echo "HIT        $file:$line"
      fi
    done < <(grep -inE "$phrase" "$file" 2>/dev/null || true)
  done
done

echo "" >&2
echo "audit-voice: $total_hits hit(s), $exception_hits exception(s) across $# file(s)" >&2

if [[ $total_hits -gt 0 ]]; then
  exit 1
fi
exit 0
