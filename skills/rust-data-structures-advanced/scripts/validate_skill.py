#!/usr/bin/env python3
"""Self-check the rust-data-structures-advanced skill.

Validates: frontmatter (name/description/NOT-for), SKILL.md line budget + mermaid presence,
required references/examples/agents exist, no phantom reference links in SKILL.md, and a basic
sanity check of the examples Cargo.toml. If `cargo` is on PATH and `--cargo` is passed, also
runs `cargo build` on the examples.

Exit codes: 0 pass, 1 failures, 2 invocation error. Designed for CI.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

REQUIRED_REFS = [
    "01-arenas-and-graphs.md",
    "02-concurrent-and-lockfree.md",
    "03-small-and-cache-friendly.md",
    "04-choosing-a-map.md",
]
REQUIRED_EXAMPLES = [
    "Cargo.toml",
    "slotmap_graph.rs",
    "crossbeam_pipeline.rs",
]
REQUIRED_AGENTS = ["openai.yaml"]

errors: list[str] = []
warnings: list[str] = []


def err(m: str) -> None:
    errors.append(m)


def warn(m: str) -> None:
    warnings.append(m)


def check_frontmatter() -> str:
    p = ROOT / "SKILL.md"
    if not p.exists():
        err("SKILL.md missing")
        return ""
    content = p.read_text()
    m = re.match(r"---\n(.*?)\n---", content, re.DOTALL)
    if not m:
        err("SKILL.md missing YAML frontmatter")
        return content
    fm = m.group(1)
    for required in ("name:", "description:", "license:"):
        if required not in fm:
            err(f"frontmatter missing {required.rstrip(':')}")
    if "rust-data-structures-advanced" not in fm:
        err("frontmatter name must be rust-data-structures-advanced")
    if "NOT for" not in content and "NOT for" not in fm and "❌" not in content:
        err("description/body should include a NOT-for boundary")
    n = len(content.splitlines())
    if n > 500:
        err(f"SKILL.md is {n} lines (>500). Move depth into references/.")
    if "```mermaid" not in content:
        err("SKILL.md has no mermaid diagram (Decision Points required)")
    return content


def check_dir(label: str, dirname: str, required: list[str]) -> None:
    base = ROOT / dirname
    if not base.exists():
        err(f"{dirname}/ directory missing")
        return
    have = {p.name for p in base.iterdir() if p.is_file()}
    for f in required:
        if f not in have:
            err(f"{label} missing: {dirname}/{f}")


def check_phantom_refs(content: str) -> None:
    """Every backtick-wrapped references/… or examples/… path in SKILL.md must exist on disk."""
    for rel in set(re.findall(r"`((?:references|examples|scripts|agents)/[\w./-]+?)`", content)):
        rel = rel.rstrip(".")
        if not (ROOT / rel).exists():
            err(f"SKILL.md cites a path that does not exist: {rel}")


def check_cargo_toml() -> None:
    p = ROOT / "examples" / "Cargo.toml"
    if not p.exists():
        return
    t = p.read_text()
    for crate in ("slotmap", "crossbeam-channel"):
        if crate not in t:
            err(f"examples/Cargo.toml does not depend on {crate}")
    for binname in ("slotmap_graph", "crossbeam_pipeline"):
        if binname not in t:
            err(f"examples/Cargo.toml missing [[bin]] for {binname}")


def maybe_cargo_build() -> None:
    if "--cargo" not in sys.argv:
        return
    if not shutil.which("cargo"):
        warn("--cargo requested but cargo not on PATH; skipping build")
        return
    ex = ROOT / "examples"
    r = subprocess.run(["cargo", "build"], cwd=ex, capture_output=True, text=True)
    if r.returncode != 0:
        err("cargo build failed in examples/:\n" + r.stderr[-2000:])


def main() -> int:
    content = check_frontmatter()
    check_dir("reference", "references", REQUIRED_REFS)
    check_dir("example", "examples", REQUIRED_EXAMPLES)
    check_dir("agent", "agents", REQUIRED_AGENTS)
    if content:
        check_phantom_refs(content)
    check_cargo_toml()
    maybe_cargo_build()

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    if errors:
        print(f"\nFAIL: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"PASS: 0 errors, {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"invocation error: {exc}", file=sys.stderr)
        sys.exit(2)
