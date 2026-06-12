#!/usr/bin/env sh
# pd-shell-integration.sh — Shell function wrapper for Port Daddy
#
# Source this file from your shell profile to enable automatic environment
# variable injection when running `pd begin`:
#
#   # ~/.zshrc or ~/.bashrc
#   source ~/.port-daddy/shell/pd-shell-integration.sh
#
# After sourcing, `pd begin <purpose>` will automatically set PD_AGENT_ID
# and PD_SESSION_ID in your current shell — no eval required.
#
# To install to the default location:
#   mkdir -p ~/.port-daddy/shell
#   cp "$(command -v pd | xargs dirname)/../share/pd/shell/pd-shell-integration.sh" \
#      ~/.port-daddy/shell/
#
# Or simply source directly from the repo:
#   source /path/to/port-daddy/shell/pd-shell-integration.sh

pd() {
  if [ "$1" = "begin" ]; then
    # Run the real pd binary with PD_EMIT_EXPORTS=1 so it prints
    # `export PD_AGENT_ID=...` and `export PD_SESSION_ID=...` to stdout.
    # Human-readable output goes to stderr — eval only sees the export lines.
    eval "$(PD_EMIT_EXPORTS=1 command pd "$@")"
  else
    command pd "$@"
  fi
}
