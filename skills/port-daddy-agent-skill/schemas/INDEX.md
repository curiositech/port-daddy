# Schemas

Machine-readable contracts. Load only the file relevant to the current operation.

## Human-readable contracts (`*.md`)

| File | When to load | Authoritative source |
|---|---|---|
| `semantic-identity.md` | Before claiming a port, registering an agent, or building a `pd find` pattern. | `lib/identity.ts` |
| `pd-fleet.schema.md` | Human reading of the fleet contract; every field with examples. | `lib/fleet-engine.ts` |
| `tuple-shape.md` | Before calling `pd tuple out / rd / in`. Pattern grammar + harbor scoping. | `lib/tuples.ts` |
| `note-shape.md` | Before calling `pd note` if you need typed notes (progress / decision / blocker). | `routes/sessions.ts` |
| `pheromone-signal.md` | Before `pd pheromone spray` — strength bounds, decay model, table-id-key triple. | `lib/pheromone.ts` |
| `salvage-entry.md` | Before claiming dead-agent work. What lives in the salvage queue and what carries over. | `lib/resurrection.ts` |
| `mcp-tool-catalog.md` | When using PD via MCP from inside an agent. One-line per tool, points at the canonical CLI. | `mcp/server.ts` |

## JSON Schemas (`*.schema.json`)

These are the validators. Use them when emitting durable evidence or before writing `pd-fleet.yml`.

| File | When to load | Used by |
|---|---|---|
| `pd-fleet.schema.json` | Before writing or editing any `pd-fleet.yml`. | `scripts/fleet-validate.sh`, `lib/fleet-engine.ts` |
| `coordination-note.schema.json` | When emitting a durable scope/result note that downstream agents will parse. | `templates/coordination-note.md`, agent emitters |
| `agent-handoff.schema.json` | When emitting a parent→child or peer handoff envelope. | `scripts/emit_agent_handoff.py`, `templates/handoff.md` |
| `validation-report.schema.json` | When an agent reports the validation it ran (commands, exit codes, evidence). | downstream auditors, CI gates |

These contracts reflect Port Daddy v3.11.x. If the daemon reports a different `pd version`, prefer the live `pd help` and `/version` endpoint over this file.
