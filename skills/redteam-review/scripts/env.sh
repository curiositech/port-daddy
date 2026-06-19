#!/usr/bin/env bash
# Source this before running any tool from the redteam-review or
# whitehat-defense fleets. Sets paths to the locally installed
# formal-methods toolchain.
#
# Usage: . skills/redteam-review/scripts/env.sh

# OpenJDK for TLA+ Tools (TLC) and Apalache.
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/Cellar/openjdk/25.0.2/libexec/openjdk.jdk/Contents/Home}"

# OPAM environment for ProVerif, Tamarin, etc.
if command -v opam >/dev/null 2>&1; then
  eval "$(opam env --safe 2>/dev/null)" || true
fi

# Tool paths.
export TLA2TOOLS_JAR="${TLA2TOOLS_JAR:-/tmp/tla2tools.jar}"
export APALACHE_BIN="${APALACHE_BIN:-/tmp/apalache/bin/apalache-mc}"
export PATH="$JAVA_HOME/bin:$PATH"

# Sanity check (silent unless --verify flag).
if [ "${1:-}" = "--verify" ]; then
  echo "JAVA_HOME = $JAVA_HOME"
  java -version 2>&1 | head -1
  command -v proverif >/dev/null && proverif --help 2>&1 | head -1 || echo "proverif: NOT FOUND"
  [ -f "$TLA2TOOLS_JAR" ] && echo "tla2tools: $TLA2TOOLS_JAR" || echo "tla2tools: NOT FOUND"
  [ -x "$APALACHE_BIN" ] && echo "apalache: $($APALACHE_BIN version 2>&1)" || echo "apalache: NOT FOUND"
  command -v cargo-kani >/dev/null && echo "kani: $(cargo kani --version 2>&1 | head -1)" || echo "kani: NOT FOUND"
  command -v z3 >/dev/null && echo "z3: $(z3 --version 2>&1 | head -1)" || echo "z3: NOT FOUND"
  command -v dot >/dev/null && echo "graphviz: $(dot -V 2>&1 | head -1)" || echo "graphviz: NOT FOUND"
fi
