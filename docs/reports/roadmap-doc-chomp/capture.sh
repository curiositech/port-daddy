#!/usr/bin/env bash
# Visual-evidence capture for the `pd roadmap chomp` slice (roadmap
# command-center program, doc-ingestion PR).
#
# What this script does — and its honesty contract:
#   * Runs the REAL CLI (bin/port-daddy-cli.ts via tsx) against a REAL, live
#     daemon (server.ts) and the repo's REAL planning documents
#     (V4-DAG.md, port-daddy-asciinema-skills-plan.md). Nothing is mocked and
#     no output is invented: every transcript in this directory is the
#     verbatim stdout+stderr of the command shown at its top.
#   * The daemon is an ISOLATED dev instance (PORT_DADDY_PREFIX sandbox DB),
#     so captures never touch an operator's registry. The chomped items are
#     therefore REAL rows written by the real write path into a scratch DB.
#   * PNGs in this directory are headless-Playwright renderings of these
#     transcript files (see render.mjs) — a faithful monospace rendering of
#     real captured output, not a mockup. The raw .txt transcripts are
#     committed next to every PNG so the pixels can be re-derived.
#
# Reproduce:
#   1. PORT_DADDY_PREFIX=$(mktemp -d) PORT_DADDY_PORT=9899 npx tsx server.ts &
#      (wait for http://127.0.0.1:9899/health)
#   2. PORT_DADDY_URL=http://127.0.0.1:9899 \
#      PORT_DADDY_SOCK=$PORT_DADDY_PREFIX/port-daddy.sock \
#      bash docs/reports/roadmap-doc-chomp/capture.sh
#   3. node docs/reports/roadmap-doc-chomp/render.mjs
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$REPO_ROOT/docs/reports/roadmap-doc-chomp"
PLAN_DIR="${CHOMP_PLAN_DIR:-$(mktemp -d)}"
PLAN_DIR2="${CHOMP_PLAN_DIR2:-$(mktemp -d)}" # rerun emits separately so the first receipt survives
HARBOR=port-daddy
DOCS=(V4-DAG.md port-daddy-asciinema-skills-plan.md)

pd() { npx tsx "$REPO_ROOT/bin/port-daddy-cli.ts" "$@"; }

cap() { # cap <outfile> <cmd...> — record the command line + verbatim output
  local file="$1"; shift
  {
    printf '$ %s\n\n' "$*"
    "$@" 2>&1
  } | sed -e 's/\x1b\[[0-9;]*m//g' > "$OUT/$file" || true
}

cd "$REPO_ROOT"

# 1. Preview (the default): the exact item tree, nothing written.
cap t01-preview.txt pd roadmap chomp "${DOCS[@]}" --harbor "$HARBOR"

# 2. Empty / null states the operator asked to see:
#    a doc with no ingestible structure (LICENSE has no headings) and a
#    missing path. Both real runs, zero items derived.
cap t02-empty-states.txt pd roadmap chomp LICENSE docs/DOES-NOT-EXIST.md --harbor "$HARBOR"

# 3. Honest LLM degradation: --enrich with no backend configured.
cap t03-enrich-honest.txt env PD_CHOMP_BACKEND= PD_FLEET_DEFAULT_BACKEND= \
  npx tsx "$REPO_ROOT/bin/port-daddy-cli.ts" roadmap chomp "${DOCS[@]}" --harbor "$HARBOR" --enrich

# 4. THE write act: --emit-pr-plan performs the daemon upsert and emits the
#    PR artifacts (snapshot + work receipt + git-rm list + PR body).
cap t04-write-emit-pr-plan.txt pd roadmap chomp "${DOCS[@]}" --harbor "$HARBOR" \
  --as chomp-evidence --emit-pr-plan "$PLAN_DIR"

# 5. Idempotent re-run: same command, zero new inserts, protected rows.
cap t05-idempotent-rerun.txt pd roadmap chomp "${DOCS[@]}" --harbor "$HARBOR" \
  --as chomp-evidence --emit-pr-plan "$PLAN_DIR2"

# 6. The derived items, read back from the roadmap DB-of-record.
cap t06-roadmap-list.txt pd roadmap --status all --harbor "$HARBOR" --limit 200

# 7. One derived item's full row — source_refs_json provenance included.
#    The slug is read from the run's own receipt (first inserted item), so the
#    capture always shows a row this very run derived.
SLUG="$(python3 -c "import json;r=json.load(open('$PLAN_DIR/chomp-receipt.json'));print((r['inserted'] or [i['slug'] for i in r['items']])[0])")"
cap t07-item-source-refs.txt sh -c \
  "curl -s \"$PORT_DADDY_URL/roadmap/items/$SLUG?harbor=$HARBOR\" | python3 -m json.tool"

# 8. The emitted PR-plan artifacts (what the doc-removal PR contains).
cp "$PLAN_DIR/chomp-receipt.json" "$OUT/chomp-receipt.json"
cp "$PLAN_DIR/pr-body.md" "$OUT/emitted-pr-body.md"
cap t08-pr-plan-artifacts.txt sh -c \
  "echo '── remove-docs.txt ──'; cat '$PLAN_DIR/remove-docs.txt'; \
   echo; echo '── chomp-receipt.json (head) ──'; head -60 '$PLAN_DIR/chomp-receipt.json'; \
   echo; echo '── roadmap.snapshot.json (head) ──'; head -20 '$PLAN_DIR/roadmap.snapshot.json' 2>/dev/null || echo '(snapshot skipped — see receipt)'"

echo "captures written to $OUT (plan dir: $PLAN_DIR)"
