# Port Daddy Agent Skill Bundle

This bundle is the distributed operating manual for agents doing Port
Daddy-backed multi-agent coordination.

It ships with:

- `SKILL.md` as the lean activation surface.
- `references/` for deeper procedural guidance.
- `references/cli-reference.md` for CLI command families, generated docs
  expectations, and claim-aware git staging doctrine.
- `diagrams/` for coordination loop, handoff, and lifecycle shapes.
- `schemas/` for machine-checkable notes, handoffs, and validation reports.
- `scripts/` for bundle validation and local context diagnosis.
- `templates/` for copyable notes and handoffs.
- `examples/` for concrete build paths.
- `agents/openai.yaml` for UI/catalog metadata.

Run:

```bash
python3 scripts/validate_port_daddy_agent_skill.py .
```
