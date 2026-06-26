# Scripts

Executable helpers. Most are shell or Python; run them from the repo root with the bundle path as the working dir.

## Top-level helpers

| Script | Purpose | When to run |
|---|---|---|
| `preflight.sh` | Pre-edit gate: daemon up, no mid-rebase, claims sane, branch fresh against canonical remote. | First thing before editing in a shared worktree. |
| `agent-handshake.sh` | Emit a typed handoff envelope on session close (calls `emit_agent_handoff.py`). | When closing a session whose work the next agent must continue. |
| `emit_agent_handoff.py` | Produce a handoff JSON validated against `schemas/agent-handoff.schema.json`. | Programmatic emission from agent runtimes; pairs with `templates/handoff.md`. |
| `fleet-validate.sh` | Validate a `pd-fleet.yml` against `schemas/pd-fleet.schema.json`. | Before committing any change to a `pd-fleet.yml`. |
| `salvage-triage.sh` | Surface dead-agent intent worth claiming, sorted by recency and project. | When `pd salvage` returns more than ~10 entries and you need to triage. |
| `session-resume.sh` | Resume a salvaged session preserving the original purpose and notes. | After `pd salvage --claim <agent>` when you need to continue, not restart. |
| `diagnose_port_daddy_agent_context.sh` | Sample the local Port Daddy context (status, whoami, briefing, notes, salvage) so an agent can reason from live state. | Whenever the agent's mental model of "what's running" is older than the last `pd` command. |
| `validate_port_daddy_agent_skill.py` | Bundle-shape check specific to this skill (required paths, frontmatter, mermaid coverage). | Before committing changes to this skill bundle; runs in CI. |

## Subdirectories

- `prologue/` — JSON-emitting context probes designed to run in parallel at agent start. See `prologue/INDEX.md`.

## Related

- For the generic "is this skill bundle drifting?" audit, run
  `python3 skills/skill-hygiene/scripts/audit_skill_bundle.py skills/port-daddy-agent-skill`.
