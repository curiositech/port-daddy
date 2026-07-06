#!/usr/bin/env python3
"""Self-check the rust-performance-and-idioms skill.

Verifies: SKILL.md frontmatter + size, required references exist, the example
crate is present, no phantom file citations, and (if cargo is on PATH and
--with-cargo is passed) that the worked-example crate still tests green and its
two implementations agree.

Exit codes: 0 all checks pass, 1 a check failed, 2 invocation error.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

REQUIRED_REFS = [
    "01-profiling-and-benching.md",
    "02-allocation-and-layout.md",
    "03-simd-and-codegen.md",
    "04-async-and-contention.md",
    "05-idioms-cheatsheet.md",
]
REQUIRED_EXAMPLE_FILES = [
    "examples/wordcount/Cargo.toml",
    "examples/wordcount/src/lib.rs",
    "examples/wordcount/benches/wordcount.rs",
    "examples/wordcount/README.md",
]

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def check_frontmatter() -> None:
    p = ROOT / "SKILL.md"
    if not p.exists():
        err("SKILL.md missing")
        return
    content = p.read_text()
    m = re.match(r"---\n(.*?)\n---", content, re.DOTALL)
    if not m:
        err("SKILL.md missing YAML frontmatter")
        return
    fm = m.group(1)
    for required in ("name:", "description:"):
        if required not in fm:
            err(f"frontmatter missing {required.rstrip(':')}")
    if "NOT" not in fm:
        warn("description should include NOT-for exclusions")
    n = len(content.splitlines())
    if n > 500:
        err(f"SKILL.md is {n} lines (>500). Move depth to references.")
    else:
        print(f"  ok   SKILL.md is {n} lines (<=500)")


def check_refs() -> None:
    base = ROOT / "references"
    if not base.exists():
        err("references/ directory missing")
        return
    have = {p.name for p in base.glob("*.md")}
    for f in REQUIRED_REFS:
        if f not in have:
            err(f"required reference missing: references/{f}")


def check_example() -> None:
    for rel in REQUIRED_EXAMPLE_FILES:
        if not (ROOT / rel).exists():
            err(f"example file missing: {rel}")


def check_no_phantom_refs() -> None:
    skill = (ROOT / "SKILL.md").read_text()
    cited = set(re.findall(r"references/([\w\-]+\.md)", skill))
    on_disk = {p.name for p in (ROOT / "references").glob("*.md")}
    for m in cited - on_disk:
        err(f"phantom reference cited in SKILL.md but not on disk: references/{m}")
    cited_scripts = set(re.findall(r"scripts/([\w\-.]+\.py)", skill))
    on_disk_scripts = {p.name for p in (ROOT / "scripts").glob("*.py")}
    for m in cited_scripts - on_disk_scripts:
        err(f"phantom script cited in SKILL.md but not on disk: scripts/{m}")


def check_cargo() -> None:
    if "--with-cargo" not in sys.argv:
        print("  skip cargo example test (pass --with-cargo to run)")
        return
    if not shutil.which("cargo"):
        warn("cargo not on PATH; skipped example test")
        return
    crate = ROOT / "examples" / "wordcount"
    try:
        r = subprocess.run(
            ["cargo", "test", "--release"],
            cwd=crate, capture_output=True, text=True, timeout=300,
        )
        if r.returncode != 0:
            err(f"example `cargo test` failed:\n{r.stdout[-600:]}{r.stderr[-600:]}")
        else:
            print("  ok   example crate tests pass (both versions agree)")
    except subprocess.TimeoutExpired:
        err("example `cargo test` timed out")


def main() -> int:
    check_frontmatter()
    check_refs()
    check_example()
    check_no_phantom_refs()
    check_cargo()

    print(f"errors:   {len(errors)}")
    print(f"warnings: {len(warnings)}")
    for e in errors:
        print(f"  ERR  {e}")
    for w in warnings:
        print(f"  WARN {w}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
