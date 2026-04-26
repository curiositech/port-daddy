#!/bin/bash
set -e

# Port Daddy: Core Build Script
# Compiles the formally verified Rust core into a shared library.

export PATH="$HOME/.cargo/bin:$PATH"

CORE_DIR="core/harbor-card-rs"
DIST_DIR="dist/core"

echo "🦀 Building Port Daddy Rust Core..."

cd $CORE_DIR
cargo build --release -j 1

cd ../..
mkdir -p $DIST_DIR

# Determine OS for library extension
OS=$(uname -s)
if [ "$OS" == "Darwin" ]; then
    LIB_EXT="dylib"
elif [ "$OS" == "Linux" ]; then
    LIB_EXT="so"
else
    echo "Unsupported OS: $OS"
    exit 1
fi

cp "$CORE_DIR/target/release/libharbor_card_rs.$LIB_EXT" "$DIST_DIR/"

echo "✅ Build complete: $DIST_DIR/libharbor_card_rs.$LIB_EXT"
