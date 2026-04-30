#!/usr/bin/env python3
"""Validate the Port Daddy agent skill bundle shape."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


REQUIRED_PATHS = [
    "SKILL.md",
    "CHANGELOG.md",
    "README.md",
    "agents/openai.yaml",
    "references/INDEX.md",
    "references/coordination-theory.md",
    "references/fleetbar-and-console.md",
    "references/recovery-and-salvage.md",
    "references/distribution-and-installation.md",
    "references/cli-reference.md",
    "diagrams/INDEX.md",
    "diagrams/01_flowchart_agent_operating_loop.md",
    "diagrams/02_sequenceDiagram_coordination_handoff.md",
    "diagrams/03_stateDiagram-v2_agent_lifecycle.md",
    "schemas/coordination-note.schema.json",
    "schemas/agent-handoff.schema.json",
    "schemas/validation-report.schema.json",
    "scripts/diagnose_port_daddy_agent_context.sh",
    "scripts/emit_agent_handoff.py",
    "templates/coordination-note.md",
    "templates/handoff.md",
    "examples/build-now.md",
    "examples/coordinated-edit.md",
    "examples/fleetbar-triage.md",
]


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not root.exists():
        fail(f"skill root does not exist: {root}")

    missing = [path for path in REQUIRED_PATHS if not (root / path).exists()]
    if missing:
        fail("missing required paths: " + ", ".join(missing))

    skill = (root / "SKILL.md").read_text(encoding="utf-8")
    if "name: port-daddy-agent-skill" not in skill:
        fail("SKILL.md frontmatter has the wrong name")
    if "references/" not in skill or "schemas/" not in skill or "FleetBar" not in skill:
        fail("SKILL.md does not point to references, schemas, and FleetBar guidance")

    for schema_path in sorted((root / "schemas").glob("*.json")):
        with schema_path.open(encoding="utf-8") as handle:
            schema = json.load(handle)
        if schema.get("type") != "object":
            fail(f"{schema_path.name} must be an object schema")
        if not schema.get("required"):
            fail(f"{schema_path.name} must declare required fields")

    diagram_sources = "\n".join(path.read_text(encoding="utf-8") for path in (root / "diagrams").glob("*.md"))
    for mermaid_type in ["flowchart", "sequenceDiagram", "stateDiagram-v2"]:
        if not re.search(rf"```mermaid\s+{re.escape(mermaid_type)}", diagram_sources):
            fail(f"missing Mermaid {mermaid_type} diagram")

    print(f"Port Daddy agent skill bundle OK: {root}")


if __name__ == "__main__":
    main()
