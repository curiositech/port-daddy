#!/usr/bin/env bash
set -euo pipefail

target="${1:-.}"

if [[ ! -d "$target" ]]; then
  echo "error: target directory not found: $target" >&2
  exit 2
fi

cd "$target"

echo "== Rust desktop preflight =="
echo "path: $(pwd)"
echo "os: $(uname -s 2>/dev/null || echo unknown)"
echo

echo "== toolchain =="
for tool in rustc cargo rustup node npm pnpm bun; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf "%-8s %s\n" "$tool" "$($tool --version 2>/dev/null | head -n 1)"
  else
    printf "%-8s missing\n" "$tool"
  fi
done
echo

echo "== git =="
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git status --short --branch
else
  echo "not a git worktree"
fi
echo

echo "== detected files =="
for file in Cargo.toml package.json pnpm-lock.yaml package-lock.json bun.lockb src-tauri/tauri.conf.json tauri.conf.json; do
  if [[ -e "$file" ]]; then
    echo "present: $file"
  fi
done
if [[ -d src-tauri/capabilities ]]; then
  echo "present: src-tauri/capabilities/"
fi
echo

echo "== framework hints =="
if [[ -f Cargo.toml ]]; then
  grep -E '(^|[-_])(tauri|dioxus|slint|egui|eframe|iced|wgpu)([-_]|[[:space:]]|=)' Cargo.toml || true
fi
if [[ -f package.json ]]; then
  grep -E '"(@tauri-apps|tauri|dioxus|vite|react|svelte|vue)"' package.json || true
fi
echo

echo "== next =="
echo "Run: python3 skills/rust-desktop-app-builder/scripts/audit_rust_desktop_app.py <target>"
