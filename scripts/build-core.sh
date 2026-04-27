#!/bin/bash
set -euo pipefail

# Port Daddy: Core Build Script
# Compiles the formally verified Rust core into a shared library.

export PATH="$HOME/.cargo/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CORE_DIR="$ROOT_DIR/core/harbor-card-rs"
DIST_DIR="$ROOT_DIR/dist/core"
CORE_KEY="$(printf '%s' "$ROOT_DIR" | cksum | awk '{print $1}')"
TARGET_DIR="${PORT_DADDY_CORE_TARGET_DIR:-${CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/port-daddy-core-target-$CORE_KEY}}"

echo "🦀 Building Port Daddy Rust Core..."

cargo build --manifest-path "$CORE_DIR/Cargo.toml" --target-dir "$TARGET_DIR" --release -j 1

mkdir -p "$DIST_DIR"

# Determine OS for library extension
OS=$(uname -s)
if [[ "$OS" == "Darwin" ]]; then
    LIB_EXT="dylib"
elif [[ "$OS" == "Linux" ]]; then
    LIB_EXT="so"
else
    echo "Unsupported OS: $OS"
    exit 1
fi

cp "$TARGET_DIR/release/libharbor_card_rs.$LIB_EXT" "$DIST_DIR/"

echo "✅ Build complete: $DIST_DIR/libharbor_card_rs.$LIB_EXT"
