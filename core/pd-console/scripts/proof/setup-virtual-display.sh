#!/bin/bash
# setup-virtual-display.sh — one-time setup for off-screen pd-console proof capture.
#
# Creates (or helps you create) a VIRTUAL DISPLAY so the proof harness can render
# pd-console on a screen that is NOT your physical monitor. The OS compositor keeps
# drawing it (so animations/shaders render for real), but nothing appears on the
# display in front of you.
#
# This script automates what it can and clearly hands off the two steps that are
# inherently interactive on macOS:
#   • installing a GUI app (BetterDisplay)
#   • granting Screen Recording permission (a TCC dialog you must click)
#
# Usage:  scripts/proof/setup-virtual-display.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/../target/release/pd-console"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

# ── 1. BetterDisplay present? ─────────────────────────────────────────────────────
BD_APP="/Applications/BetterDisplay.app"
BD_CLI=""
if command -v betterdisplaycli >/dev/null 2>&1; then
  BD_CLI="$(command -v betterdisplaycli)"
elif [[ -x "$BD_APP/Contents/MacOS/BetterDisplay" ]]; then
  BD_CLI="$BD_APP/Contents/MacOS/BetterDisplay"
fi

if [[ -z "$BD_CLI" ]]; then
  say "BetterDisplay is not installed."
  note "It is the simplest way to create a software virtual display (free for this)."
  note "A physical dummy HDMI/DisplayPort plug also works and needs no software."
  if command -v brew >/dev/null 2>&1; then
    read -r -p "  Install BetterDisplay now via Homebrew cask? [y/N] " ans
    if [[ "${ans:-}" =~ ^[Yy]$ ]]; then
      brew install --cask betterdisplay
      BD_CLI="$BD_APP/Contents/MacOS/BetterDisplay"
    fi
  else
    note "Homebrew not found. Install from https://github.com/waydabber/BetterDisplay"
  fi
fi

# ── 2. Create a virtual screen (best-effort CLI, GUI fallback) ───────────────────
say "Create a virtual display"
created=0
if [[ -n "$BD_CLI" ]]; then
  # BetterDisplay's CLI surface has shifted across versions; try the known spellings,
  # then fall back to GUI instructions if none take.
  for try in \
    "$BD_CLI create -virtualScreen -name=pd-proof" \
    "$BD_CLI createvirtualscreen --name=pd-proof" \
    "$BD_CLI create --name pd-proof --type virtual"; do
    if $try >/dev/null 2>&1; then
      note "Created a virtual screen via: $try"
      created=1; break
    fi
  done
fi
if [[ "$created" -ne 1 ]]; then
  note "Could not create the screen non-interactively. Do it once in the GUI:"
  note "  BetterDisplay menubar icon → 'Create New Virtual Screen' → 'Dummy/Virtual'"
  note "  (or with a dummy plug: just plug it in). Name it 'pd-proof' if you like."
  note "Then re-run this script to confirm it appears."
fi

# ── 3. Screen Recording permission (TCC) ─────────────────────────────────────────
say "Grant Screen Recording permission"
note "The Terminal you run the proof harness from needs Screen Recording permission:"
note "  System Settings → Privacy & Security → Screen Recording → enable your terminal."
note "Opening that pane now…"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" || true

# ── 4. Verify: list the displays pd-console can see ──────────────────────────────
say "Displays pd-console can target"
if [[ -x "$BIN" ]]; then
  "$BIN" --list-displays || note "(could not enumerate — build the window first: make -C $ROOT run)"
else
  note "Build the window first to verify:  make -C \"$ROOT\" run   (then re-run this)."
fi

say "Next"
note "Once a non-primary display is listed above, capture proof with:"
note "  make -C \"$ROOT\" proof          # auto-detects the virtual display"
note "  PD_PROOF_DISPLAY=<index|uuid> make -C \"$ROOT\" proof   # pin a specific one"
