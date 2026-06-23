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

# Kernel macaroon FFI cdylib (pd-anchor) — the canonical macaroon verifier the TS
# daemon prefers over the byte-parity TS fallback (ADR-0054). Built from the core/
# cargo workspace and copied next to libharbor so the koffi loader
# (lib/macaroon-ffi.ts, sharing lib/arbiter.ts's dist/core candidate path) finds
# it. Its absence is non-fatal: the daemon falls back to the TS impl.
echo "🦀 Building Port Daddy macaroon kernel (pd-anchor cdylib)..."
WS_TARGET="${PORT_DADDY_WORKSPACE_TARGET_DIR:-${TARGET_DIR%/}-ws}"
cargo build --manifest-path "$ROOT_DIR/core/Cargo.toml" -p pd-anchor --release --target-dir "$WS_TARGET" -j 1
cp "$WS_TARGET/release/libpd_anchor.$LIB_EXT" "$DIST_DIR/"

echo "✅ Build complete: $DIST_DIR/libpd_anchor.$LIB_EXT"
