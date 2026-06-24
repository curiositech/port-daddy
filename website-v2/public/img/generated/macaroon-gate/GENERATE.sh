#!/usr/bin/env bash
# Hero + inline illustrations for the post:
#   src/data/blog/the-macaroon-gate.md
#
# House style (see sibling attention-first-command/, pr-reviews-itself/,
# tube-multiplex/): flat Swiss-modern blueprint editorial illustration.
# Per ~/.claude/CLAUDE.md: nano-banana is the default. Sequential only.
#
# Usage:
#   export GEMINI_API_KEY=$(grep "^GEMINI_API_KEY=" \
#     ~/coding/jbuds4life/next-app/.env.local | cut -d= -f2-)
#   bash GENERATE.sh

set -euo pipefail

OUT=/Users/erichowens/coding/port-daddy/website-v2/public/img/generated/macaroon-gate
SCRIPT=~/.claude/skills/nano-banana-image-gen/scripts/generate.py
STYLE="Flat Swiss-modern blueprint editorial illustration. Cream paper background #f2eee6 with crisp cobalt blue line work #003fb8, deep teal-sage accents #006b5f, near-black #1f1f1f outlines. Hand-lettered italic serif labels. Architectural blueprint hatching in negative space. No painterly gradients, no photo realism, no wood textures — flat clean lines, like a Tufte diagram crossed with a children's-book scene."

gen () {
  local name="$1"; local scene="$2"; local aspect="${3:-1:1}"
  python3 "$SCRIPT" --scene "$STYLE $scene" --out "$OUT/$name" --aspect "$aspect"
}

# 1. Hero — the 3am agent with the operator's push token, and the gate.
gen hero.png \
  "Wide horizontal night scene drawn flat and clean. On the left, a small friendly robot labeled in italic hand-lettering 'CODING AGENT' sits at a desk lit by a single monitor, a wall clock reading 3:00. It holds up a large ornate brass key with a glowing cobalt bow, hand-lettered on the key's tag: 'PUSH TOKEN'. On the right, a tall fortified doorway hand-lettered above the lintel 'main', the repository. Between the robot and the door stands a turnstile gate; fixed to the gate is a round wax seal stamped with concentric rings, hand-lettered beside it 'RENT PAID?'. The turnstile arm is DOWN, blocking the way; a small tag on it reads 'no discharge — no push'. Blueprint hatching and dimension lines fill the upper negative space. Calm, not alarmed." \
  16:9

# 2. discharge-flow — the macaroon as a chain of wax seals that only narrows.
gen discharge-flow.png \
  "A clean horizontal diagram drawn flat in line work: a strip of parchment running left to right, sealed at intervals by wax seals connected by a single chain, like a credential. The first seal, larger, hand-lettered 'ROOT (daemon only)'. The next two smaller seals hand-lettered 'branch != main' and 'expires 20m', each drawn slightly smaller than the last to suggest narrowing. A final distinct seal in deep teal, set apart, hand-lettered 'RENT PAID for session S — daemon attests'. Below the strip, a downward arrow to a turnstile that reads 'PUSH OK' when the teal seal is present. A faded greyed-out copy of the teal seal to one side, crossed out, hand-lettered 'cannot be forged: needs the daemon key'. Blueprint hatching in the margins, dimension ticks under each seal." \
  3:2

# 3. leviathan — the Hobbes slide: state of nature vs the coordinator.
gen leviathan.png \
  "A flat diptych diagram split by a thin vertical center rule. LEFT half, hand-lettered caption beneath 'STATE OF NATURE': five small robots each clutching its own brass key, arrows crossing chaotically between them, two robots tugging the same document, small red conflict X-marks where arrows collide. RIGHT half, hand-lettered caption beneath 'LEVIATHAN': the same five robots arranged in a calm fan, each connected by a clean single line to a central round seal-stamp labeled in italic 'the coordinator', orderly non-crossing flow, no conflict marks. Across the very bottom, one hand-lettered line: 'its correctness is a proof, not an opinion.' Cobalt line work, teal accents, blueprint hatching behind both halves." \
  3:2
