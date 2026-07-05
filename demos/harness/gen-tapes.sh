#!/bin/sh
# Generates the /harness page captures in light+dark. Run from the repo root.
set -e
REPO="$(pwd)"
DEMO="$HOME/coding/tmp/harness-demo"
OUT="$REPO/website-v2/public/demos/harness"
for MODE in dark light; do
  if [ "$MODE" = dark ]; then THEME="Catppuccin Macchiato"; SUF="-dark"; else THEME="Catppuccin Latte"; SUF=""; fi

  cat > "demos/harness/_on$SUF.tape" <<EOF
Output $OUT/harness-squid-on$SUF.gif
Set FontSize 18
Set Width 1200
Set Height 780
Set Theme "$THEME"
Set Padding 40
Hide
Type "alias pd='npx tsx $REPO/bin/port-daddy-cli.ts' && cd $DEMO && clear"
Enter
Sleep 3s
Show
Type "pd squid on"
Sleep 500ms
Enter
Sleep 9s
Type "pd squid status"
Sleep 500ms
Enter
Sleep 9s
Sleep 3s
EOF

  cat > "demos/harness/_tap$SUF.tape" <<EOF
Output $OUT/harness-squid-tap$SUF.gif
Set FontSize 18
Set Width 1200
Set Height 520
Set Theme "$THEME"
Set Padding 40
Hide
Type "alias pd='npx tsx $REPO/bin/port-daddy-cli.ts' && cd $DEMO && export PD_MATRIX_FILE=$HOME/coding/tmp/harness-demo-matrix.env && clear"
Enter
Sleep 3s
Show
Type "pd squid tap"
Sleep 500ms
Enter
Sleep 8s
Sleep 3s
EOF

  cat > "demos/harness/_codex$SUF.tape" <<EOF
Output $OUT/harness-squid-codex$SUF.gif
Set FontSize 18
Set Width 1200
Set Height 720
Set Theme "$THEME"
Set Padding 40
Hide
Type "alias pd='npx tsx $REPO/bin/port-daddy-cli.ts' && cd $DEMO && clear"
Enter
Sleep 3s
Show
Type "pd squid codex --tier strong --serve-only"
Sleep 500ms
Enter
Sleep 10s
Sleep 4s
Ctrl+C
Sleep 1s
EOF

  cat > "demos/harness/_statusline$SUF.tape" <<EOF
Output $OUT/harness-statusline$SUF.gif
Set FontSize 20
Set Width 1200
Set Height 380
Set Theme "$THEME"
Set Padding 40
Hide
Type "clear"
Enter
Sleep 1s
Show
Type "printf '{\"model\":{\"display_name\":\"Opus 4.8\"}}' | ~/.port-daddy/bin/pd-statusline"
Sleep 400ms
Enter
Sleep 2s
Type "printf '{\"model\":{\"display_name\":\"Opus 4.8\"}}' | PD_SQUID_PILOT=codex ~/.port-daddy/bin/pd-statusline"
Sleep 400ms
Enter
Sleep 2s
Screenshot $OUT/harness-statusline$SUF.png
Sleep 2s
EOF
done
