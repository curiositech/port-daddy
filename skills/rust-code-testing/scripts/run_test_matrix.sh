#!/usr/bin/env bash
# run_test_matrix.sh — the Rust test/quality gate matrix for a crate or workspace.
#
# Runs the gates that actually catch regressions, in cheapest-first order so you
# get the fastest signal: format → lint → typecheck → unit/integration → doc
# tests → (optional) coverage. Each gate prints PASS/FAIL; the script exits
# non-zero if any required gate fails, so it drops straight into CI or a
# pre-push hook.
#
# Usage:
#   run_test_matrix.sh [--manifest <Cargo.toml>] [--coverage] [--no-clippy-deny]
#                      [--features <list>] [--] [extra cargo test args]
#
# Examples:
#   run_test_matrix.sh
#   run_test_matrix.sh --manifest core/pd-health/Cargo.toml --features ffi
#   run_test_matrix.sh --coverage -- --test-threads=1
#
# Env:
#   RUST_MIN_STACK   exported as 16MB if unset — proc-macro-heavy crates (e.g.
#                    GPUI) overflow the default rustc stack in test builds.
set -uo pipefail

MANIFEST=""
COVERAGE=0
CLIPPY_DENY=1
FEATURES=""
EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="$2"; shift 2 ;;
    --coverage) COVERAGE=1; shift ;;
    --no-clippy-deny) CLIPPY_DENY=0; shift ;;
    --features) FEATURES="$2"; shift 2 ;;
    --) shift; EXTRA=("$@"); break ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

MAN_ARGS=()
[ -n "$MANIFEST" ] && MAN_ARGS=(--manifest-path "$MANIFEST")
FEAT_ARGS=()
[ -n "$FEATURES" ] && FEAT_ARGS=(--features "$FEATURES")

export RUST_MIN_STACK="${RUST_MIN_STACK:-16777216}"

fail=0
run_gate() {
  local name="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n  $ %s\n' "$name" "$*"
  if "$@"; then
    printf '  \033[32mPASS\033[0m %s\n' "$name"
  else
    printf '  \033[31mFAIL\033[0m %s\n' "$name"
    fail=1
  fi
}

# 1. Formatting — fastest possible signal, no compile.
run_gate "fmt --check" cargo fmt "${MAN_ARGS[@]}" -- --check

# 2. Lint. Deny warnings by default (zero-warnings norm); --no-clippy-deny relaxes.
if [ "$CLIPPY_DENY" -eq 1 ]; then
  run_gate "clippy (-D warnings)" cargo clippy "${MAN_ARGS[@]}" "${FEAT_ARGS[@]}" --all-targets -- -D warnings
else
  run_gate "clippy" cargo clippy "${MAN_ARGS[@]}" "${FEAT_ARGS[@]}" --all-targets
fi

# 3. Unit + integration tests.
run_gate "cargo test" cargo test "${MAN_ARGS[@]}" "${FEAT_ARGS[@]}" "${EXTRA[@]}"

# 4. Doc tests — `cargo test` runs them for libs, but be explicit so example code
#    in /// comments is verified even when --all-targets-style flags would skip it.
run_gate "doc tests" cargo test "${MAN_ARGS[@]}" "${FEAT_ARGS[@]}" --doc

# 5. Optional coverage (cargo-llvm-cov). Soft: a missing tool is a SKIP, not a fail.
if [ "$COVERAGE" -eq 1 ]; then
  if cargo llvm-cov --version >/dev/null 2>&1; then
    run_gate "coverage (llvm-cov)" cargo llvm-cov "${MAN_ARGS[@]}" "${FEAT_ARGS[@]}" --summary-only
  else
    printf '\n\033[33mSKIP coverage: cargo-llvm-cov not installed (cargo install cargo-llvm-cov)\033[0m\n'
  fi
fi

printf '\n'
if [ "$fail" -eq 0 ]; then
  printf '\033[32m✓ all required gates passed\033[0m\n'
else
  printf '\033[31m✗ one or more gates failed\033[0m\n'
fi
exit "$fail"
