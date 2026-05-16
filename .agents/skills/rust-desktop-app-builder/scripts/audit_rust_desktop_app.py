#!/usr/bin/env python3
"""Static read-only audit for Rust desktop app structure."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None


FRAMEWORK_MARKERS = {
    "tauri": ["tauri", "@tauri-apps/api", "@tauri-apps/cli"],
    "dioxus": ["dioxus", "dioxus-desktop"],
    "slint": ["slint"],
    "egui/eframe": ["egui", "eframe"],
    "iced": ["iced"],
    "wgpu": ["wgpu"],
}


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(errors="replace")
    except FileNotFoundError:
        return ""


def load_cargo(path: Path) -> dict:
    cargo_path = path / "Cargo.toml"
    if not cargo_path.exists() or tomllib is None:
        return {}
    try:
        return tomllib.loads(read_text(cargo_path))
    except tomllib.TOMLDecodeError:
        return {"_parse_error": True}


def detect_frameworks(root: Path) -> list[str]:
    haystack_parts = []
    for rel in ["Cargo.toml", "package.json", "src-tauri/Cargo.toml", "ui/package.json"]:
        haystack_parts.append(read_text(root / rel).lower())
    haystack = "\n".join(haystack_parts)

    found = []
    for name, markers in FRAMEWORK_MARKERS.items():
        if any(marker.lower() in haystack for marker in markers):
            found.append(name)
    return found


def exists(root: Path, rel: str) -> bool:
    return (root / rel).exists()


def audit(root: Path) -> dict:
    cargo = load_cargo(root)
    frameworks = detect_frameworks(root)
    findings: list[dict[str, str]] = []

    def add(severity: str, item: str, detail: str) -> None:
        findings.append({"severity": severity, "item": item, "detail": detail})

    if not exists(root, "Cargo.toml") and not exists(root, "src-tauri/Cargo.toml"):
        add("high", "cargo", "No Cargo.toml found at repo root or src-tauri; Rust desktop structure is unclear.")

    if not frameworks:
        add("medium", "framework", "No Tauri, Dioxus, Slint, egui/eframe, iced, or wgpu marker detected.")

    if "tauri" in frameworks:
        if not exists(root, "src-tauri/capabilities"):
            add("high", "tauri-capabilities", "Tauri marker found but src-tauri/capabilities is missing.")
        if not exists(root, "src-tauri/tauri.conf.json") and not exists(root, "src-tauri/tauri.conf.json5"):
            add("medium", "tauri-config", "Tauri marker found but src-tauri config was not detected.")

    if exists(root, "package.json") and not (exists(root, "pnpm-lock.yaml") or exists(root, "package-lock.json") or exists(root, "yarn.lock") or exists(root, "bun.lockb")):
        add("medium", "lockfile", "package.json exists without a detected JS package-manager lockfile.")

    if cargo and cargo.get("_parse_error"):
        add("high", "cargo-parse", "Cargo.toml could not be parsed.")
    elif cargo:
        package = cargo.get("package", {})
        workspace = cargo.get("workspace", {})
        if package and str(package.get("edition", "")) not in {"2021", "2024"}:
            add("medium", "edition", "Cargo package edition is missing or older than 2021.")
        if not package.get("rust-version") and not workspace.get("package", {}).get("rust-version"):
            add("low", "rust-version", "No rust-version declared; reproducible desktop builds benefit from pinning MSRV.")

    if not exists(root, ".github/workflows"):
        add("low", "ci", "No GitHub Actions workflow directory detected; cross-platform release proof may be missing.")

    release_docs = ["RELEASE.md", "docs/release.md", "docs/RELEASE.md"]
    if not any(exists(root, rel) for rel in release_docs):
        add("low", "release-docs", "No release document detected for signing, updater, or installer evidence.")

    return {
        "path": str(root),
        "frameworks": frameworks,
        "has_cargo": exists(root, "Cargo.toml") or exists(root, "src-tauri/Cargo.toml"),
        "has_package_json": exists(root, "package.json"),
        "findings": findings,
    }


def main(argv: list[str]) -> int:
    root = Path(argv[1] if len(argv) > 1 else ".").resolve()
    if not root.exists() or not root.is_dir():
        print(f"error: directory not found: {root}", file=sys.stderr)
        return 2
    print(json.dumps(audit(root), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
