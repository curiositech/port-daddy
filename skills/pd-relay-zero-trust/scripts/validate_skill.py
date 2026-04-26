#!/usr/bin/env python3
"""Self-check the pd-relay-zero-trust skill: frontmatter, references, schemas,
script self-tests. Designed to run in CI.

Exit codes:
  0 — all checks pass
  1 — one or more checks failed
  2 — invocation error
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

REQUIRED_REFS = [
    "zero-trust-foundations.md",
    "pki-options-acme.md",
    "pki-options-oidc.md",
    "pki-options-web-of-trust.md",
    "pki-decision-matrix.md",
    "merkle-chain-design.md",
    "relay-architecture.md",
    "harbor-card-attenuation.md",
    "e2e-payload-encryption.md",
    "proverif-relay-extension.md",
    "float-plans-deferred.md",
    "v4-remote-harbor-redefinition.md",
    "threat-model.md",
]
REQUIRED_SCHEMAS = [
    "script-io.schema.json",
    "harbor-card.schema.json",
    "attenuated-card.schema.json",
    "event-envelope.schema.json",
    "merkle-chain-head.schema.json",
    "relay-handshake.schema.json",
]
REQUIRED_SCRIPTS_SELFTEST = [
    "pki_decision.py",
    "chain_verify.py",
    "chain_anchor.py",
    "attenuate_card.py",
    "e2e_encrypt.py",
    "verify_relay_handshake.py",
    "threat_review.py",
]
REQUIRED_TEMPLATES = [
    "ADR-PKI-Decision.md",
    "ADR-Relay-Architecture.md",
    "ADR-V4-Remote-Harbor-Redefinition.md",
    "relay-handshake-message.json",
    "attenuated-card.json",
    "proverif-relay.pv",
]
REQUIRED_AGENTS = [
    "acme-specialist.md",
    "proponent.md",
    "pragmatic.md",
    "antagonist.md",
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
    for required in ("name:", "description:", "allowed-tools:"):
        if required not in fm:
            err(f"SKILL.md frontmatter missing {required.rstrip(':')}")
    if "NOT for" not in fm:
        warn("description should include 'NOT for' exclusions")
    line_count = len(content.splitlines())
    if line_count > 500:
        err(f"SKILL.md is {line_count} lines (>500). Move depth to references.")


def check_files(label: str, dirname: str, required: list[str]) -> None:
    base = ROOT / dirname
    if not base.exists():
        err(f"{dirname}/ directory missing")
        return
    have = {p.name for p in base.iterdir() if p.is_file()}
    for f in required:
        if f not in have:
            err(f"{label} missing: {dirname}/{f}")


def check_schemas_valid_json() -> None:
    base = ROOT / "schemas"
    if not base.exists():
        return
    for p in base.glob("*.json"):
        try:
            json.loads(p.read_text())
        except json.JSONDecodeError as e:
            err(f"schema invalid JSON: {p.name}: {e}")


def check_no_phantom_refs() -> None:
    skill = (ROOT / "SKILL.md").read_text()
    refs_in_skill = set(re.findall(r"references/([\w\-]+\.md)", skill))
    on_disk = {p.name for p in (ROOT / "references").glob("*.md")}
    missing = refs_in_skill - on_disk
    for m in missing:
        err(f"phantom reference cited in SKILL.md but not on disk: references/{m}")
    scripts_in_skill = set(re.findall(r"scripts/([\w\-_]+\.py)", skill))
    on_disk_scripts = {p.name for p in (ROOT / "scripts").glob("*.py")}
    missing_s = scripts_in_skill - on_disk_scripts
    for m in missing_s:
        err(f"phantom script cited in SKILL.md but not on disk: scripts/{m}")


def run_script_selftests() -> None:
    base = ROOT / "scripts"
    for s in REQUIRED_SCRIPTS_SELFTEST:
        p = base / s
        if not p.exists():
            err(f"script missing: scripts/{s}")
            continue
        try:
            r = subprocess.run([sys.executable, str(p), "--selftest"],
                               capture_output=True, text=True, timeout=15)
            if r.returncode != 0:
                err(f"selftest failed: {s} (rc={r.returncode}): {r.stderr.strip()[:200]}")
            else:
                try:
                    out = json.loads(r.stdout.splitlines()[-1])
                    if not out.get("ok"):
                        err(f"selftest reported non-ok: {s}: {r.stdout[:200]}")
                except json.JSONDecodeError:
                    err(f"selftest output not JSON: {s}: {r.stdout[:200]}")
        except subprocess.TimeoutExpired:
            err(f"selftest timed out: {s}")


def main() -> int:
    check_frontmatter()
    check_files("reference", "references", REQUIRED_REFS)
    check_files("schema", "schemas", REQUIRED_SCHEMAS)
    check_files("template", "templates", REQUIRED_TEMPLATES)
    check_files("agent", "agents", REQUIRED_AGENTS)
    check_schemas_valid_json()
    check_no_phantom_refs()
    run_script_selftests()

    print(f"errors:   {len(errors)}")
    print(f"warnings: {len(warnings)}")
    for e in errors:
        print(f"  ERR  {e}")
    for w in warnings:
        print(f"  WARN {w}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
