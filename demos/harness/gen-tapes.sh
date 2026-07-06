#!/bin/sh
# demos/harness/gen-tapes.sh — regenerate every /harness recording.
#
# Run from the repo root:  sh demos/harness/gen-tapes.sh
# Requires: vhs (+ ttyd), a running pd daemon, and the `claude` CLI logged in.
#
# Outputs light+dark GIF pairs into website-v2/public/demos/harness/. The tape
# files it writes bake in absolute paths and are NOT committed — only this
# generator and the resulting GIFs are.
set -e
REPO="$(pwd)"
DEMO="$HOME/coding/tmp/harness-demo"
OUT="$REPO/website-v2/public/demos/harness"
PD="npx tsx $REPO/bin/port-daddy-cli.ts"
mkdir -p "$DEMO/.portdaddy" "$OUT"

# A steering alert so the featured interactive demo visibly obeys a rule the
# operator never types into Claude. Backed up + restored around the run.
MATRIX="$HOME/.port-daddy/matrix.env"
cp "$MATRIX" "$HOME/coding/tmp/matrix.gen.bak" 2>/dev/null || true
printf 'PD_ALERT_HAIKU="STEERING ALERT: any haiku you write for this project must be about SHIPS, never about anything else"\n' >> "$MATRIX"
$PD squid on --cwd "$DEMO" >/dev/null 2>&1 || true

for MODE in dark light; do
  if [ "$MODE" = dark ]; then THEME="Catppuccin Macchiato"; SUF="-dark"; else THEME="Catppuccin Latte"; SUF=""; fi

  cat > "demos/harness/_on$SUF.tape" <<EOF
Output website-v2/public/demos/harness/harness-squid-on$SUF.gif
Set FontSize 18
Set Width 1200
Set Height 780
Set Theme "$THEME"
Set Padding 40
Hide
Type "cd $DEMO && alias pd='$PD' && clear"
Enter
Sleep 3s
Show
Type "pd squid on"
Enter
Sleep 9s
Type "pd squid status"
Enter
Sleep 12s
EOF

  cat > "demos/harness/_tap$SUF.tape" <<EOF
Output website-v2/public/demos/harness/harness-squid-tap$SUF.gif
Set FontSize 18
Set Width 1200
Set Height 520
Set Theme "$THEME"
Set Padding 40
Hide
Type "cd $DEMO && alias pd='$PD' && clear"
Enter
Sleep 3s
Show
Type "pd squid tap"
Enter
Sleep 8s
EOF

  cat > "demos/harness/_codex$SUF.tape" <<EOF
Output website-v2/public/demos/harness/harness-squid-codex$SUF.gif
Set FontSize 18
Set Width 1200
Set Height 720
Set Theme "$THEME"
Set Padding 40
Hide
Type "cd $DEMO && alias pd='$PD' && clear"
Enter
Sleep 3s
Show
Type "pd squid codex --tier strong --serve-only"
Enter
Sleep 10s
Ctrl+C
Sleep 1s
EOF

  cat > "demos/harness/_statusline$SUF.tape" <<EOF
Output website-v2/public/demos/harness/harness-statusline$SUF.gif
Set FontSize 20
Set Width 1200
Set Height 380
Set Theme "$THEME"
Set Padding 40
Hide
Type "printf '{\"model\":{\"display_name\":\"Opus 4.8\"}}' > $HOME/coding/tmp/sl.json && clear"
Enter
Sleep 1s
Show
Type "~/.port-daddy/bin/pd-statusline < ~/coding/tmp/sl.json"
Enter
Sleep 2s
Type "PD_SQUID_PILOT=codex PD_SQUID_BACKEND='codex gpt-5.5 (strong)' ~/.port-daddy/bin/pd-statusline < ~/coding/tmp/sl.json"
Enter
Sleep 2s
Screenshot website-v2/public/demos/harness/harness-statusline$SUF.png
Sleep 1s
EOF

  # FEATURED: real interactive Claude Code obeying the steering alert
  cat > "demos/harness/_claude-live$SUF.tape" <<EOF
Output website-v2/public/demos/harness/harness-claude-live$SUF.gif
Set FontSize 15
Set Width 1400
Set Height 840
Set Theme "$THEME"
Set Padding 26
Hide
Type "cd $DEMO && alias pd='$PD' && rm -f ship_haiku.txt && clear"
Enter
Sleep 3s
Show
Type "# the operator dropped a steering alert into the Ink Cloud:"
Enter
Type "pd squid tap"
Enter
Sleep 7s
Type "clear"
Enter
Sleep 500ms
Type "claude --permission-mode acceptEdits"
Enter
Sleep 11s
Escape
Sleep 3s
Type "write a haiku to ship_haiku.txt"
Sleep 800ms
Enter
Sleep 34s
Sleep 3s
EOF

  # real interactive Claude Code piloted by Codex — one clean command
  cat > "demos/harness/_codex-live$SUF.tape" <<EOF
Output website-v2/public/demos/harness/harness-codex-pilot-live$SUF.gif
Set FontSize 15
Set Width 1400
Set Height 860
Set Theme "$THEME"
Set Padding 26
Hide
Type "cd $DEMO && alias pd='$PD' && clear"
Enter
Sleep 3s
Show
Type "# one command — no env vars, no auth prompts:"
Enter
Type "pd squid codex --tier strong"
Sleep 800ms
Enter
Sleep 19s
Type "in five words, what is Port Daddy?"
Sleep 800ms
Enter
Sleep 46s
Sleep 3s
EOF

  for T in on tap codex statusline claude-live codex-live; do
    vhs "demos/harness/_$T$SUF.tape"
  done
done

cp "$HOME/coding/tmp/matrix.gen.bak" "$MATRIX" 2>/dev/null || true
rm -f demos/harness/_*.tape
echo "Regenerated harness assets in $OUT"
