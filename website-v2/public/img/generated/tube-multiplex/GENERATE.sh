#!/usr/bin/env bash
# Regenerate the imagery for the post:
#   src/data/blog/pd-tube-multi-subscriber.md
#
# Per ~/.claude/CLAUDE.md: nano-banana (Gemini) is the default. Sequential only.
# Style: flat Swiss-modern blueprint. Cream paper #f2eee6, cobalt #003fb8,
# teal-sage #006b5f, near-black #1f1f1f, sparing lime-green accent tick.
#
# Usage:
#   export GEMINI_API_KEY=$(grep "^GEMINI_API_KEY=" \
#     ~/coding/jbuds4life/next-app/.env.local | cut -d= -f2-)
#   bash GENERATE.sh
set -euo pipefail

OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT=~/.claude/skills/nano-banana-image-gen/scripts/generate.py
STYLE="Flat Swiss-modern blueprint editorial illustration. Cream paper background #f2eee6 with a faint grid, crisp cobalt blue line work #003fb8, deep teal-sage accents #006b5f, near-black #1f1f1f outlines, a small lime-green accent tick used sparingly. Architectural blueprint hatching in negative space. No painterly gradients, no photorealism, flat technical line art like a Tufte diagram. No stray text or gibberish lettering."

gen () { local name="$1"; local scene="$2"; local aspect="${3:-16:9}"
  python3 "$SCRIPT" --scene "$STYLE $scene" --out "$OUT/$name" --aspect "$aspect"; }

# Hero — one broadcast node fanning out to many identical listeners
gen hero.png \
  "Wide horizontal scene: on the left a single broadcast node — a small terminal window drawn as a loudspeaker/transmitter emitting one signal. Cobalt blue wires FAN OUT and split, reaching FOUR identical terminal windows on the right, every one showing the SAME three short message rows arriving. Beneath each window, a tiny separate bookmark/ledger card (its own cursor). Reads instantly as: one source, many listeners, each gets every message, each keeps its own place." \
  16:9

# Inline — shared-cursor race vs per-listener cursors
gen cursor-fanout.png \
  "Two-panel diptych split by a thin vertical rule. LEFT (old/broken): three identical listener figures all reaching for ONE shared bookmark/ledger tag on a single channel pipe; one hand grabbed it, the other two face an empty open mailbox — a race only one wins. RIGHT (fixed): the same three listeners on the same channel pipe, each holding their OWN separate bookmark card, all reading the same flowing message tape simultaneously." \
  16:9

echo "Done. Audit each PNG looks on-brand before committing." >&2
