#!/bin/sh
# Fresh proof for the /harness conformance and attention surfaces.
# Run from the repository root with a live canonical daemon and VHS installed.
set -eu

REPO="$(pwd)"
DEMO="$HOME/coding/tmp/harness-conformance-demo"
OUT="$REPO/website-v2/public/demos/harness"
PD="${HARNESS_PD_BINARY:-$REPO/dist/port-daddy}"
CAPTURE_KINDS=" ${HARNESS_CAPTURE_KINDS:-conformance attention} "

if [ ! -x "$PD" ]; then
  echo "Missing branch-built CLI at $PD. Run: npm run build:bin" >&2
  exit 1
fi

mkdir -p "$DEMO/.portdaddy" "$OUT"

for MODE in ${HARNESS_CAPTURE_MODES:-dark light}; do
  if [ "$MODE" = dark ]; then
    THEME="Catppuccin Macchiato"
    SUFFIX="-dark"
  else
    THEME="Catppuccin Latte"
    SUFFIX=""
  fi
  ATTENTION_AGENT="harness-attention-${MODE}-20260802"

  # Make reruns deterministic: begin below conformance and with no watches.
  $PD squid off --cwd "$DEMO" >/dev/null 2>&1 || true
  for CHANNEL in coordination:inconsistency fleet:events agents; do
    $PD attention --agent "$ATTENTION_AGENT" --unsubscribe "$CHANNEL" >/dev/null 2>&1 || true
  done

  CONF_TAPE="$REPO/demos/harness/_conformance$SUFFIX.tape"
  ATTENTION_TAPE="$REPO/demos/harness/_attention$SUFFIX.tape"

  printf '%s\n' \
    "Output \"$OUT/harness-conformance-live$SUFFIX.gif\"" \
    'Set FontSize 16' \
    'Set Width 1320' \
    'Set Height 900' \
    "Set Theme \"$THEME\"" \
    'Set Padding 30' \
    'Hide' \
    "Type \"cd $DEMO && alias pd='$PD' && clear\"" \
    'Enter' \
    'Sleep 2s' \
    'Show' \
    'Type "pd squid status"' \
    'Enter' \
    'Sleep 6s' \
    'Type "pd squid on"' \
    'Enter' \
    'Sleep 8s' \
    'Type "pd squid status"' \
    'Enter' \
    'Sleep 10s' > "$CONF_TAPE"

  printf '%s\n' \
    "Output \"$OUT/harness-attention-activation$SUFFIX.gif\"" \
    'Set FontSize 17' \
    'Set Width 1320' \
    'Set Height 820' \
    "Set Theme \"$THEME\"" \
    'Set Padding 30' \
    'Hide' \
    "Type \"cd $DEMO && alias pd='$PD' && clear\"" \
    'Enter' \
    'Sleep 2s' \
    'Show' \
    "Type \"pd attention --peek --agent $ATTENTION_AGENT\"" \
    'Enter' \
    'Sleep 8s' \
    "Type \"pd attention --subscribe-recommended --agent $ATTENTION_AGENT\"" \
    'Enter' \
    'Sleep 7s' \
    "Type \"pd attention --subscriptions --agent $ATTENTION_AGENT\"" \
    'Enter' \
    'Sleep 7s' > "$ATTENTION_TAPE"

  case "$CAPTURE_KINDS" in *" conformance "*) vhs "$CONF_TAPE" ;; esac
  case "$CAPTURE_KINDS" in *" attention "*) vhs "$ATTENTION_TAPE" ;; esac
  rm -f "$CONF_TAPE" "$ATTENTION_TAPE"
done

echo "Fresh Squid conformance and attention proof written to $OUT"
