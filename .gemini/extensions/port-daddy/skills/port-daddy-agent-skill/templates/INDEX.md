# Templates

Starter files. Copy into the target location and fill the placeholders. None of these are loaded by Port Daddy directly — they're authoring scaffolds for humans and agents.

| Template | Copy to | Use when |
|---|---|---|
| `.portdaddyrc.starter` | `<repo>/.portdaddyrc` | First time configuring a repo for Port Daddy. Schema lives in `references/portdaddyrc-spec.md`. |
| `pd-fleet.starter.yml` | `<repo>/pd-fleet.yml` | Bootstrapping a fleet of background agents. Validate with `scripts/fleet-validate.sh` before committing. Schema in `schemas/pd-fleet.schema.md`. |
| `coordination-note.md` | Pasted into a `pd note` body, or saved alongside a PR description. | You need a structured scope/result/blocker note matching `schemas/coordination-note.schema.json`. |
| `handoff.md` | Emitted via `scripts/emit_agent_handoff.py` or pasted into an actor inbox. | Closing a session whose work continues with another agent. Matches `schemas/agent-handoff.schema.json`. |
| `session-note.template.md` | First note inside a fresh `pd begin` session. | You want a consistent scope/assumptions/validation/files-touched shape across the session. |

## Filling templates

- Replace `<placeholders>` with concrete values; do not leave them in committed evidence.
- Validate the result with the matching JSON schema (see `schemas/INDEX.md`).
- Prefer the template over freeform prose when the next reader is another agent — structured notes are machine-parseable and survive longer.
