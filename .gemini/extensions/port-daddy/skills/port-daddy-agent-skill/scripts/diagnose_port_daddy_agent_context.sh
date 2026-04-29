#!/usr/bin/env bash
set -euo pipefail

echo "== Port Daddy status =="
pd status || true

echo
echo "== Current session =="
pd whoami || true

echo
echo "== Recent briefing =="
pd briefing || true

echo
echo "== Recent notes =="
pd notes --limit 12 || true

echo
echo "== Salvage sample =="
pd salvage --project port-daddy --limit 8 || true
