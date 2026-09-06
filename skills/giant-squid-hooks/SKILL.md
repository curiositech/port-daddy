---
name: giant-squid-hooks
description: "Reference for the Giant Squid Harness hook tentacles (bin/pd-hook-prompt, bin/pd-hook-pre-tool, bin/pd-hook-post-tool, bin/pd-hook-stop) — the per-vendor event contracts, dial resolution, output channels, loop guards, and test seams that govern how Port Daddy rides inside Claude Code, Gemini CLI, Codex CLI, and Antigravity lifecycles. Use when editing a tentacle, wiring a new hook event, debugging a hook that fired wrong (or not at all), or verifying vendor block contracts. NOT for operating Port Daddy on another project (use port-daddy-agent-skill) and NOT for general repo contribution mechanics (use port-daddy-internal-dev)."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Coordination
  tags: [port-daddy, giant-squid, hooks, tentacles, claude-code, gemini, codex, antigravity, sitrep, lifecycle]
  pairs-with:
    - skill: port-daddy-agent-skill
      reason: "Operating the harness (pd squid on, SITREP discipline) from any project."
    - skill: port-daddy-internal-dev
      reason: "Contributor invariants — release cargo, PR discipline, breaker doctrine — when editing these tentacles."
  provenance:
    kind: first-party
    owners: [port-daddy]
    scope: internal
  authorship:
    maintainers: [port-daddy]
  distribution:
    public: false
    note: "Repo-private. The tentacles are internal harness machinery; agents on other projects interact with them only through the public port-daddy-agent-skill."
---

# Giant Squid Hooks — the four tentacles

The Giant Squid Harness (ADR-0091) does not run the agent loop. It sinks four
small POSIX-sh tentacles into each vendor CLI's native hook surface so that
coordination fires *inside* the vendor's own lifecycle:

| Tentacle | Phase label | Fires on | Job |
|---|---|---|---|
| `bin/pd-hook-prompt` | PD TURN | turn start | Inject bounded coordination context, unread inbox/parley count, and the SITREP compulsion |
| `bin/pd-hook-pre-tool` | PD EDIT | before direct edits | Block foreign-locked files per the suggestibility dial |
| `bin/pd-hook-post-tool` | PD TRACE | (retired from lifecycles) | Legacy pheromone trace; staged for migration/debug only |
| `bin/pd-hook-stop` | PD CLOSE | turn end | Verify the SITREP table the prompt tentacle compelled |

One reference file per tentacle carries the full per-vendor contract; start at
the hub: `references/INDEX.md`.

- [Prompt tentacle](references/prompt.md)
- [Pre-tool tentacle](references/pre-tool.md)
- [Post-tool tentacle](references/post-tool.md)
- [Stop tentacle](references/stop.md)
- [Vendor Stop/AfterAgent capability matrix](references/vendor-matrix.md)

## NOT For

- Driving Port Daddy as a coordination tool on another project — that is
  `port-daddy-agent-skill` (its Giant Squid section covers `pd squid on`,
  status, and repair from the operator side).
- Repo-wide contributor mechanics (worktrees, PR ceremony, release surfaces) —
  that is `port-daddy-internal-dev`.
- The SessionStart Pilot hook (`hooks/sessionstart-pilot.mjs`) — related but a
  Node hook with its own doctrine, not a tentacle.

## The one source of truth for shapes

Every event name, tool matcher, timeout, and the Codex TOML block live in
`lib/squid/hook-shape.ts` — both injectors import from it:

- the headless adapter (`lib/squid/adapter.ts`) writes workspace/home configs
  for `claude -p` / `gemini -p` / `codex exec` / `agy -p` voyages;
- the interactive installer (`cli/commands/hooks-install.ts`) stages the
  tentacles to `~/.port-daddy/bin/squid/` and points every provider config at
  generated **gate wrappers** in `~/.port-daddy/bin/`.

`REGISTERED_TENTACLES` (in `lib/squid/hook-shape.ts`) is the roster of
tentacles actually wired into lifecycles: prompt, pre-tool, and stop.
`pd-hook-post-tool` stays in `TENTACLES` (staged, diagnosable, removable) but
is deliberately NOT registered — see `references/post-tool.md` for the
fan-out incident that retired it.

### Event map (all four vendors)

| Purpose | Claude Code | Gemini CLI | Codex CLI | Antigravity (agy) |
|---|---|---|---|---|
| prompt | `UserPromptSubmit` | `BeforeAgent` | `[[hooks.UserPromptSubmit]]` | `UserPromptSubmit` |
| preTool | `PreToolUse` | `BeforeTool` | `[[hooks.PreToolUse]]` | `PreToolUse` |
| stop | `Stop` | `AfterAgent` | `[[hooks.Stop]]` | `Stop` (observe-only) |

Timeout units differ: Gemini takes **milliseconds**, Claude/agy/Codex take
**seconds**. `buildJsonHookMap` and `codexHooksTomlBlock` in
`lib/squid/hook-shape.ts` encode this; never hand-write a hook entry.

## The gate wrapper (why a tentacle is never called directly)

Interactive configs point at generated wrappers (see `gateWrapperScript()` in
`cli/commands/hooks-install.ts`), which no-op unless the daemon's readiness
lease matches its live PID, the Bosun heartbeat is fresh, and the cwd is
inside an explicitly armed project root. The wrapper also owns the
fail-open circuit breaker:

- deadline: `SQUID_HOOK_DEADLINE_MS = 1000` (`lib/squid/hook-shape.ts:36`)
- slow threshold: `SQUID_HOOK_BREAKER_SLOW_MS = 250` (`lib/squid/debug.ts:33`)
- failure threshold: 3 consecutive (`lib/squid/debug.ts:32`)
- cooldown: 5 minutes, one half-open probe (`lib/squid/debug.ts:34`)

Every tentacle must complete comfortably under the 250 ms slow line or it
counts toward self-disable. Phase labels in wrapper debug events and breaker
notices: `PD TURN` / `PD EDIT` / `PD TRACE` / `PD CLOSE` — the debug reader
(`lib/squid/debug.ts`) validates the phase enum (`turn|edit|trace|close`) and
the hook-name regex, so a new tentacle that skips registration there is
silently invisible to `pd squid debug status`.

## Shared doctrine (all tentacles)

**Fail open, always.** Any parse error, missing tool (`jq`, `python3`,
`/usr/bin/time`), or unverifiable input exits 0 with no output. A missed
coordination fact is degraded coordination; a crashed or hung CLI loop is a
broken product (ADR-0091 §Mitigation).

**The halt sentinel comes first (ADR-0132 listening watch).** Every tentacle
— and the gate wrapper — does `test -f "$PD_HOME/HALT"` before any matrix,
dial, or daemon work, so a halt is heard even when the daemon is down on
purpose. With the flag hoisted: the prompt tentacle injects a notice that
opens `SECURITE HALT` on its own line followed by the sentinel's own text;
`pd-hook-pre-tool` refuses `pd`/`port-daddy` (except `--help`/`--version`),
`mcp__port-daddy__*`, `launchctl load|enable|kickstart|bootstrap|start` of a
Port Daddy label, and `brew services start|restart port-daddy` with the same
per-vendor block contracts as the lock gate; each session appends one
`control SEEN` line to `$PD_HOME/DISTRESS` (and `<repo>/.portdaddy/DISTRESS`)
and `pd-hook-stop` appends `control COMPLIED` after one prompt→stop cycle
with no blocked call. The SITREP compulsion and verification are withheld
during a halt (their scaffold commands are `pd` invocations), and no tentacle
touches the daemon or runs `pd`. Per-session dedupe lives under
`$PD_HOME/squid/halt-watch/`. Override paths: `PD_HALT_FILE`,
`PD_DISTRESS_FILE`. The sentinel read and append are inline until phase 0's
`lib/distress.ts` lands.

**POSIX sh only.** `#!/bin/sh`, `set -u`, no bashisms. `jq` is optional with a
`python3` or `sed` fallback; the tentacles run under dash, BSD sh, and busybox.

**Bounded output.** Coordination content is capped (two facts + heading,
512 bytes in the prompt tentacle). The SITREP contract block is the one
deliberate exception — constant-size harness text riding outside the byte cap
(operator doctrine, 2026-08-22).

**Codex stdout rule.** Codex treats raw non-JSON stdout on exit 0 as invalid.
Any tentacle path that can run under Codex must emit either nothing or a
documented JSON shape on stdout. The universal block contract — exit 2 plus a
**non-empty** reason on stderr — is accepted by Claude, Gemini, and Codex,
and is the only block mechanism the tentacles use at Stop time.

**The reason is a prompt.** Whatever a blocking tentacle writes to stderr is
fed to the model as its next instruction. Write directives, not diagnostics:
the stop tentacle's block reason IS the SITREP directive (mirroring
`bin/pd-hook-prompt`'s enforce text), never a transcript excerpt or an error
dump.

**Dial resolution is shared shape.** Both dials — `suggestibility`
(advisory|warn|enforce, pre-tool) and `sitrep.endOfTurn` (off|suggest|enforce,
prompt + stop) — resolve identically: env override first (`PD_SUGGESTIBILITY`
/ `PD_SITREP`), then a parent walk over `agent.config.json` →
`.portdaddy/sitrep.json` (or `.portdaddy/suggestibility.json`) →
`.portdaddy/project.json`, nearest directory wins, closed enum, malformed or
unreadable config falls toward the DEFAULT (enforce), never toward silence.

## The Stop tentacle's loop-guard doctrine

`bin/pd-hook-stop` is the only tentacle that can block at a point where a
naive implementation could wedge the CLI in a block-loop. It is guarded twice:

1. **`stop_hook_active` short-circuit** — the first line of logic. Claude,
   Gemini, and Codex set this snake_case field when the stop being evaluated
   was already blocked once; the tentacle exits 0 before any dial or parsing
   work. Claude additionally hard-caps 8 consecutive Stop blocks; Gemini and
   Codex document **no cap**, which is why guard #2 exists.
2. **One-shot marker** — a mkdir-atomic marker directory under
   `$PD_HOME/squid/stop-blocks/` keyed by session id, with a TTL
   (`PD_SQUID_STOP_BLOCK_TTL_SECONDS`, default 300 s). A session blocks at
   most once per TTL window no matter what the vendor does. mkdir is the
   lock — the same atomic-directory style the matrix writers use — so two
   concurrent stops cannot both win the right to block.

Antigravity (agy) is **observe-only**: its camelCase Stop payload
(`conversationId` / `workspacePaths` / `terminationReason` / `fullyIdle` /
`executionNum`) carries no final-message field and no loop guard, its block
verb is a different dialect, and field reports say its Stop hooks may not
fire at all. The tentacle exits 0 on that shape unconditionally. Full
rationale: `references/stop.md` and `references/vendor-matrix.md`.

Known accepted miss: Claude Code's `Stop` does not fire on user interrupts,
so an interrupted turn is never SITREP-checked. `SubagentStop` exists on
Claude and Codex but is out of scope for the current tentacle (ADR-0092 L4's
adversarial-review pipeline is the follow-up).

The related SessionStart Pilot hook now adds a bounded, project-scoped salvage
count. Both nudges expose counts and corrective verbs only; message bodies and
salvage payloads stay in daemon truth until the agent explicitly runs
`pd attention` or `pd salvage`. Chapter 28 of the Agent Harbor binder is useful
provenance for the larger lifecycle proposal around Notification, SessionEnd,
SubagentStop, PreCompact, repository PR digests, and the future Postmaster role;
it does not own current authority. Reconcile that source with ADRs, deployed
runtime evidence, and eventually the configured remote append-only work-event
Oracle once remote read-back receipts prove the cutover live. Do not add those
events as synchronous network-heavy tentacles: hooks emit bounded facts or
durable jobs, and expensive synthesis happens behind the daemon.

## ADR ownership

- ADR-0091 (`docs/adr/0091-giant-squid-harness.md`) maps "Drydock & Salvage"
  to `PreCompact`/`Stop` for a future transcript-salvage tentacle
  (`pd-hook-compact`, designed-not-built).
- ADR-0092 (`docs/adr/0092-suggestibility-ladder-and-cloud-coordination-federation.md`)
  defines L4 = `Stop`/`SubagentStop` as the **closeout gate**.

`bin/pd-hook-stop` implements ADR-0092 L4's closeout-gate half. It is
additive to ADR-0091's reservation: when `pd-hook-compact` lands, both hooks
can share the Stop event (vendors run every matching hook entry), so neither
ADR's decision text needed rewriting.

## Registration checklist (adding or changing a tentacle)

A tentacle change is never just the script. The same-PR surface set:

1. `lib/squid/hook-shape.ts` — `TENTACLES`, `REGISTERED_TENTACLES`, the three
   vendor event maps, `buildJsonHookMap`, `codexHooksTomlBlock`.
2. `lib/squid/adapter.ts` — `SquidHookPurpose`, `SQUID_HOOK_METADATA`
   (displayName/description/privacy are byte-verified by the diagnose
   functions), path-helper name unions, `commandForPurpose`, the diagnose
   event maps, and all four `injectHooks` wanted maps.
3. `cli/commands/hooks-install.ts` — gate-wrapper phase case + breaker notice
   label case (staging is generic over `TENTACLES`).
4. `lib/squid/debug.ts` — phase enum, label unions, circuits list, raw-event
   hook regex, `describeStep`/`phaseLabel` copy.
5. `lib/squid/conformance.ts` — picks the roster up via `REGISTERED_TENTACLES`;
   update any prose that names hook coverage.
6. Release cargo: `release-artifacts.json`, `scripts/build-single-binary.mjs`,
   `.github/workflows/release.yml`, `scripts/smoke-squid-release.mjs`,
   `tests/unit/batten.test.js`.
7. Tests: `tests/unit/squid-harness.test.ts` (tentacle behavior, piped
   payloads), `tests/unit/hooks-install.test.ts` (shape parity pins),
   `tests/unit/squid-conformance.test.ts`, `scripts/squid-selftest.sh`
   (dependency-free contract cases), `tests/unit/agent-harbor-setup-doctor.test.js`
   (transparent hook inventory).

The doc-citation guard (`scripts/check-doc-citations.mjs`) fails a skill that
cites a tentacle path before it exists — tentacle + skill + registration ship
in ONE PR.

## Test seams

- **Jest, not vitest**: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit/squid-harness.test.ts`.
  The harness suite pipes synthetic vendor payloads through the real shell
  binaries — not mocks.
- **Dependency-free**: `scripts/squid-selftest.sh` proves the same contracts
  with zero node_modules (CI-portable, macOS/Linux).
- **Artifact boundary**: `scripts/smoke-squid-release.mjs` arms every provider
  from a staged release dir with the compiled `pd` — a source-suite pass never
  substitutes for it.
- **Hermetic env**: tests point `PD_HOME` / `PD_MATRIX_FILE` at scratch under
  `~/coding/tmp` (never `/tmp`); the tentacles honor both.
- **jq-less coverage**: every dial/extraction path needs a no-`jq` test (PATH
  stripped to coreutils + `python3`) and, where behavior differs, a
  no-parser-at-all test proving fail-open.

## Quality gates

- [ ] Tentacle passes `sh -n` and runs under dash without bashisms.
- [ ] Every branch pipe-tested by hand: happy path, block path, loop guards,
      each vendor payload shape, garbage stdin, empty stdin, missing `jq`.
- [ ] Wall time comfortably under 250 ms (`lib/squid/debug.ts:33`).
- [ ] All seven registration surfaces in the checklist above updated.
- [ ] `python3 skills/skill-hygiene/scripts/audit_skill_bundle.py skills/giant-squid-hooks` clean.
- [ ] `node scripts/check-doc-citations.mjs` clean for the skill's files.

## Sources

- ADR-0091 — Giant Squid Harness (hook topography, fail-open posture).
- ADR-0092 — Suggestibility ladder (L0–L6; L4 closeout gate; per-repo dials).
- `lib/squid/hook-shape.ts` — canonical shapes, verified against vendor docs.
- `references/vendor-matrix.md` — the 2026-08-23 primary-doc verification of
  every vendor's Stop-event surface.
