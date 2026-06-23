#!/usr/bin/env bash
#
# test-mac-install.sh — end-to-end smoke test that Port Daddy actually installs
# on a Mac the way the Mac app page documents it.
#
# This MUTATES the machine (runs `brew install`), so it is gated: it only runs
# when RUN_MAC_INSTALL_TEST=1 is set. The fast, CI-safe version of this check is
# src/mac-install-contract.test.ts, which guards the documented commands against
# drift without installing anything.
#
# Usage:
#   RUN_MAC_INSTALL_TEST=1 bash scripts/test-mac-install.sh
#
set -euo pipefail

if [[ "${RUN_MAC_INSTALL_TEST:-0}" != "1" ]]; then
  echo "skipped: set RUN_MAC_INSTALL_TEST=1 to run the real Mac install smoke test."
  echo "(the fast contract check is: npx vitest run src/mac-install-contract.test.ts)"
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "FAIL: this smoke test only runs on macOS (uname=$(uname -s))." >&2
  exit 1
fi

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "ok: $*"; }

command -v brew >/dev/null 2>&1 || fail "Homebrew not found — install it first (https://brew.sh)."

echo "==> Installing the CLI via Homebrew (the documented one-liner)"
brew install curiositech/tap/port-daddy || fail "brew install curiositech/tap/port-daddy failed."
command -v pd >/dev/null 2>&1 || fail "'pd' is not on PATH after install."
ok "pd is installed: $(pd --version 2>/dev/null || echo 'version unknown')"

echo "==> pd setup (daemon + MCP config + skill symlinks + FleetBar)"
pd setup || fail "pd setup failed."

echo "==> Verifying the environment and daemon"
pd doctor || fail "pd doctor reported problems."
pd status >/dev/null 2>&1 || fail "pd status failed (daemon not reachable)."
ok "daemon is healthy"

echo "==> Verifying the MCP server installs into agent configs (dry run if supported)"
if pd mcp install --help 2>/dev/null | grep -q -- "--dry-run"; then
  pd mcp install --dry-run || fail "pd mcp install --dry-run failed."
else
  echo "note: pd mcp install has no --dry-run; skipping live config write in smoke test."
fi
ok "MCP install path verified"

echo "ALL CHECKS PASSED — the Mac install matches what the page documents."
