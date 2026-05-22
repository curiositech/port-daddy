#!/usr/bin/env bash
# Generate hero + per-ship inline illustrations for the post:
#   src/data/blog/the-pr-that-reviews-itself.md
#
# Per ~/.claude/CLAUDE.md: nano-banana is the default. Sequential only.
# Style: flat Swiss-modern blueprint. Cream paper #f2eee6, cobalt #003fb8,
# deep teal/sage #006b5f, near-black #1f1f1f, cinnabar accent #CC3D2E.
#
# Usage:
#   export GEMINI_API_KEY=$(grep "^GEMINI_API_KEY=" \
#     ~/coding/jbuds4life/next-app/.env.local | cut -d= -f2-)
#   bash GENERATE.sh

set -euo pipefail

OUT=/Users/erichowens/coding/port-daddy/website-v2/public/img/generated/pr-reviews-itself
SCRIPT=~/.claude/skills/nano-banana-image-gen/scripts/generate.py
STYLE="Flat Swiss-modern blueprint editorial illustration. Cream paper background #f2eee6 with crisp cobalt blue line work #003fb8, deep teal-sage accents #006b5f, near-black #1f1f1f outlines, cinnabar red accent #CC3D2E used sparingly. Hand-lettered italic serif labels. Architectural blueprint hatching in negative space. No painterly gradients, no photo realism — flat lines, like a Tufte diagram crossed with a children's-book kitchen scene."

gen () {
  local name="$1"; local scene="$2"; local aspect="${3:-1:1}"
  python3 "$SCRIPT" --scene "$STYLE $scene" --out "$OUT/$name" --aspect "$aspect"
}

# 1. Hero — wide editorial scene
gen hero.png \
  "Wide horizontal scene: a quiet hooded contributor at a small laptop on the left, hands just hovering over a freshly-opened lid. To their right, a magnificent kitchen brigade of six chefs in blue aprons frozen in mid-action, each at their own prep station. The chefs hold, left to right: a magnifying glass, a clipboard with a red mark, a notepad, a small scale, a clean clipboard, a compass. Hand-lettered italic labels beneath each chef: 'code-reviewer', 'red-team', 'test-author', 'tautology-sniffer', 'tenderfoot', 'augur'. Banner across the top in larger architectural lettering: 'THE BRIGADE WAS ALREADY COOKING.' Speech bubble above the contributor: 'i just opened a PR'." \
  16:9

# 2. code-reviewer
gen code-reviewer.png \
  "Single chef in a blue apron with a magnifying glass examining an open cookbook on a marble counter. Margin notes in italic hand-lettering on the cookbook page. Severity stamps (BLOCKING / CONCERN / NIT) arranged like ink stamps on the right margin. Italic label below: 'code-reviewer'."

# 3. red-team
gen red-team.png \
  "Chef in a darker apron, a small mallet in one hand, a clipboard with a red checkmark in the other. A small dish on the counter has a tiny skull-and-crossbones drawn lightly above it, like the chef is checking if the dish was poisoned. Italic label below: 'red-team'."

# 4. test-author
gen test-author.png \
  "Chef seated at a small drawing desk, sketching plated dishes on a notepad with a pencil. Beside the chef: three small dish-sketches, each annotated. Italic label below: 'test-author'."

# 5. tautology-sniffer
gen tautology-sniffer.png \
  "Chef with a balance scale on the counter. On one side of the scale: a plated dish. On the other side: a small hand mirror reflecting the same plated dish. The chef looks suspicious. Italic label below: 'tautology-sniffer'."

# 6. tenderfoot
gen tenderfoot.png \
  "A chef without an apron yet, hat still crisp and clean, holding open a thick three-ring binder labeled 'README' and tracing a line with one finger. Around them: closed cabinets, an unfamiliar walk-in fridge, an unplugged mixer. Italic label below: 'tenderfoot'."

# 7. augur
gen augur.png \
  "Older chef with a compass in one hand and an open ledger in the other, staring at a wall of receipts pinned in three columns labeled 'ROADMAP', 'COMMITS', 'ISSUES'. A red string connects two receipts that contradict each other. Italic label below: 'augur'."

echo "Done. Verify each PNG looks on-brand before committing." >&2
