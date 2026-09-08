# pd-hook-post-tool — legacy trace tentacle (PD TRACE)

Source: `bin/pd-hook-post-tool`. Appends one `PD_PHEROMONE_*` line per
mutated file to the Ink Cloud matrix, under a lock (`flock` on Linux,
mkdir-atomic elsewhere — the SAME lock directory `lib/squid/matrix.ts` uses),
with compaction (`PD_SQUID_MATRIX_MAX_LINES` 1000 → keep newest 500
pheromones; locks and alerts are live state and never pruned).

## Status: staged, NOT registered

`pd-hook-post-tool` remains in `TENTACLES` (staged to
`~/.port-daddy/bin/squid/`, diagnosable, uninstallable) but is absent from
`REGISTERED_TENTACLES` in `lib/squid/hook-shape.ts`. Why it was retired from
interactive lifecycles:

- Codex schedules a command hook once per matching nested tool call and
  renders concurrent batches as concurrent hook jobs — a synchronous
  observational process after EVERY tool turned a parallel batch into a
  visible queue.
- The cumulative evidence it produced duplicates what session claims and
  notes already carry.

The stable interactive wrapper for it is an immediate zero-work tombstone
(`[ "$pd_hook" = "pd-hook-post-tool" ] && exit 0` in the generated gate,
`cli/commands/hooks-install.ts`), so a running provider with cached config
cannot resurrect it. Never "repair" that wrapper by copying the raw tentacle
over it. Its absence from provider config is intentional and must still
diagnose as LIVE.

It still runs in headless voyage flows that feed it events directly, and the
release cargo still ships it (`release-artifacts.json`) so older installs can
be inspected and removed safely.

## Contract (when invoked)

- Always exit 0 — a failed pheromone append is degraded coordination, never a
  broken loop.
- Multi-vendor field reads: snake_case `tool_name`/`tool_input` and camelCase
  `toolName`/`toolInput`; Codex apply_patch patch-body path harvesting
  (mirrors `bin/pd-hook-pre-tool`).
- K≥8 concurrent appends must produce intact lines (ADR-0091 G5) — proven by
  `scripts/squid-selftest.sh`'s Jamie Madrox case and
  `tests/unit/squid-harness.test.ts`'s lock-retry-exhaustion test.
