#!/usr/bin/env bash
# count-analogies.sh — heuristic analogy counter for an expository draft.
#
# This is a *signal*, not a proof. It catches drafts where the author forgot
# the analogy gear. It will not catch every analogy and it will sometimes
# flag a non-analogy. The threshold to clear is "one analogy per major
# section" — concretely, one analogy per ~500 words.
#
# Usage:
#   scripts/count-analogies.sh <draft.md>
#
# Heuristic signals:
#   - "like a", "like the", "as if", "the way", "imagine a"
#   - "X is the Y of Z" patterns (X is the bouncer / daydream / gnat / etc.)
#   - section-level h2/h3 followed by a paragraph containing any of the above
#
# Exit status:
#   0 — density at or above threshold
#   1 — density below threshold (count printed)
#   2 — usage error

set -uo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <draft.md>" >&2
  exit 2
fi

file="$1"
if [[ ! -f "$file" ]]; then
  echo "count-analogies: not a file: $file" >&2
  exit 2
fi

word_count=$(wc -w < "$file" | tr -d ' ')
analogy_patterns=(
  "\\blike a\\b"
  "\\blike the\\b"
  "\\bas if\\b"
  "\\bthe way [a-z]"
  "\\bimagine a\\b"
  "\\bimagine the\\b"
  "\\bpicture a\\b"
  "\\bpicture the\\b"
  "\\bthink of it as\\b"
  "\\bis the [a-z]+ of\\b"
  "\\bis a kind of\\b"
  "\\bsame [a-z]+ as\\b"
)

hits=0
for pattern in "${analogy_patterns[@]}"; do
  pattern_hits=$(grep -icE "$pattern" "$file" 2>/dev/null || echo 0)
  hits=$((hits + pattern_hits))
done

# Threshold: ≥ 1 per ~500 words.
threshold=$((word_count / 500))
[[ $threshold -lt 1 ]] && threshold=1

echo "count-analogies: $hits analogy-shaped phrases in $word_count words (threshold: $threshold)"

if [[ $hits -lt $threshold ]]; then
  echo "count-analogies: BELOW THRESHOLD — engage Tell #4 (wild analogies)" >&2
  exit 1
fi
exit 0
