# Schemas

Machine-readable contracts. Load only the file relevant to the current operation.

| File | When to load | Authoritative source |
|---|---|---|
| `semantic-identity.md` | Before claiming a port, registering an agent, or building a `pd find` pattern. | `lib/identity.ts` |
| `pd-fleet.schema.json` | Before writing or editing any `pd-fleet.yml`. JSON-Schema-validated. | `lib/fleet-engine.ts` (FleetYamlRoot) |
| `pd-fleet.schema.md` | Human reading of the same contract; explains every field with examples. | `lib/fleet-engine.ts` |
| `tuple-shape.md` | Before calling `pd tuple out / rd / in`. Pattern grammar + harbor scoping. | `lib/tuples.ts` |
| `note-shape.md` | Before calling `pd note` if you need typed notes (progress / decision / blocker). | `routes/sessions.ts` |
| `pheromone-signal.md` | Before `pd pheromone spray` — strength bounds, decay model, table-id-key triple. | `lib/pheromone.ts` |
| `salvage-entry.md` | Before claiming dead-agent work. What lives in the salvage queue and what carries over. | `lib/resurrection.ts` |
| `mcp-tool-catalog.md` | When using PD via MCP from inside an agent. One-line per tool, points at the canonical CLI. | `mcp/server.ts` |

These contracts reflect Port Daddy v3.11.x. If the daemon reports a different `pd version`, prefer the live `pd help` and `/version` endpoint over this file.
