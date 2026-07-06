# Work Packet: Agentic App Architecture Audit (Hypatia's Round)

Status: delivered. This packet closes the roster gap recorded in
`subagent-launch-roster.md`, where the agent Hypatia was assigned an
`agentic-app-architecture-audit.md` deliverable that never landed. The audit
has now been run for real, with the machine-checkable scorer, against both the
binder's target state and the shipped reality.

Lens: the `agentic-app-architecture` skill (merged to main in PR #646), which
audits an agentic app across five axes — interaction transparency,
state/history/memory, context & caching economics, capability integration,
and execution substrate & side effects — using the deterministic scorer
`skills/agentic-app-architecture/scripts/agentic_app_audit.mjs`
(critical findings force `pass=false` regardless of score).

## Method

Two specs were authored against
`skills/agentic-app-architecture/schemas/agentic-app-spec.schema.json` and run
through the scorer on 2026-07-03:

1. **Target spec** — the Agent Harbor control plane as the binder commits to
   it (chapters 00, 03, 04, 06, 09, 10, 14, 19).
2. **Shipped spec** — Port Daddy as it runs today: daemon + pd-console +
   FleetBar + Scout v0.1, before F0/C1–C8.

Spec-authoring judgment calls are documented in the appendix so the audit is
reproducible and arguable.

## Results

### Target state: PASS, 100/100 on every axis

```text
pass=true
transparency 100 · stateModel 100 · contextStrategy 100 · capabilities 100 · execution 100
```

The binder's target design is architecturally clean under this lens. That is
not praise of the prose — it means the binder makes the right *commitments*:
visible transcripts and tool calls, plan-before-act (team proposals), real
interrupts, durable forkable history, episodic memory, context budgeting,
custody-safe secrets, a small MCP core (five broker tools under enforced
coordination, chapter 19), worktree isolation, human gates, and Work Receipts.

### Shipped reality: FAIL, three criticals

```text
pass=false
transparency 0 · stateModel 100 · contextStrategy 70 · capabilities 100 · execution 0
```

| Severity | Finding | Scorer message | Binder remediation |
| --- | --- | --- | --- |
| CRITICAL | `hidden-thinking-or-tool-use` | thinking and/or tool use is not surfaced: "a chat box with secret hands" | M1 transcript truth; C3 control panel renderers |
| CRITICAL | `no-human-gate-on-side-effects` | irreversible actions have no human checkpoint | M3.5 governance substrate; C5 gates; FleetBar gate cards (IT-016) |
| CRITICAL | `no-artifact-receipt` | side-effecting work leaves no durable, artifact-backed receipt | Work Receipt (F0 schema, IT-009); `agent-work-receipt-designer` |
| HIGH | `not-interruptible` | no interruption/steering affordance while working | M3.5 pause/kill envelope; M5 suggestibility; chapter 19 dual-path interrupt |
| MEDIUM | `no-plan-before-act` | no plan shown before consequential action | Work Plan + team proposal at the consent gate (chapter 14; FleetBar spec) |
| MEDIUM | `no-prompt-caching` | no declared prompt-caching strategy (~5-minute Anthropic TTL) | see "thinnest axis" below — genuinely under-specified in the binder |
| MEDIUM | `no-eviction-strategy` | no eviction/summarization for stale context | M6 compaction packets (chapter 04) — specified, unbuilt |

### The headline

**The binder's milestone order is, almost exactly, the remediation list for
this audit's criticals.** M1 kills the transparency critical, M3.5 kills the
gate critical, the F0 receipt schema kills the receipt critical, and M5/M6
clear the high/medium tail. That is independent confirmation — from a lens
authored after the binder swarm ran — that the "evidence chain" build order
(chapter 07) attacks the right defects first. No re-planning is indicated;
the plan should simply be executed.

## Five-axis narrative audit of the binder itself

Beyond the scorer, the skill's axes applied to the binder's *coverage*:

**1. Transparency — strong.** Chapters 00/03/10 are explicit: transcript
events witnessed not claimed, no LIVE without evidence, hidden reasoning never
overpromised (chapter 08 R2 already caught that). The mockup-adopted
plan-before-act flow (team proposal with cost/scope at the gate) satisfies the
axis's hardest requirement.

**2. State/history/memory — strong, one gap.** Durable append-only history,
successor/fork semantics (C6), episodic memory tiers (chapter 04). Gap:
*rename/organize* of sessions and projects is nowhere specified — trivial but
operator-facing; assign to the C3 chain backlog.

**3. Context & caching economics — the thinnest axis.** Chapter 04 has
context-pressure thresholds and compaction, but the binder says almost nothing
about *prompt-cache economics*: cache-TTL-aware polling cadence for staff
agents and Longshoremen, context stability ordering (stable prefix, volatile
suffix) for repeated turn-start envelopes, or cache-hit accounting in
CostAccrualEvent. Under always-on operation (Longshoremen, watchers, digest
loops) cache misses are a first-order cost driver. Recommendation R1 below.

**4. Capability integration — strong, and chapter 19 improves it.** The MCP
gateway with custody (chapter 03), keychain secrets (shipped), and the
enforced-MCP broker collapse (chapter 19) take the core surface from 19
etiquette verbs to 5 broker tools — well under the scorer's sanity threshold
of 8 for an always-on core, and consistent with the operator's lean-MCP-core
policy. Secret custody mode is `secret-store` today (verified:
`lib/secret-env.ts` keychain custody) — already safe.

**5. Execution substrate & side effects — right commitments, all unbuilt.**
Worktree isolation exists operationally; gates and receipts are F0/C5 targets.
The scorer's criticals here are the product's whole reason to exist, which is
the strongest argument that F0 must not slip.

## Recommendations

R1 (new, the only novel finding): add a **prompt-cache economics contract** to
chapter 04 and the C4 chain — cache-TTL-aware scheduling for staff agents,
stable-prefix context assembly for turn-start envelopes, and a
`cacheReadTokens`/`cacheWriteTokens` split in `CostAccrualEvent` so receipts
show cache efficiency. Backing skills: `caching-strategies`,
`llm-response-caching-layer`, `context-economics-for-agent-swarms`,
`always-on-agent-inputs`.

R2: add session/project **rename** to the C3 backlog (one-line schema impact:
display-name column on `agent_nodes`/sessions; chapter 09).

R3: re-run this audit at each milestone gate — the shipped-spec JSON should be
updated and re-scored as M1, M3.5, and receipt slices land, and the score
trajectory (0 → 100 on transparency and execution) becomes a progress metric
the operator can read at a glance. Wire it into the I0 integration review.

R4: the roster's own failure is evidence. Hypatia's original run produced
nothing durable, and the swarm's MCP spawn timed out while `pd status` was
green (recorded in `subagent-launch-roster.md`). Both are instances of the
audit's criticals — work without receipts, spawn without honest state. Add the
spawn-timeout fixture to IT-010's doctor matrix.

## Appendix: shipped-spec judgment calls

- `thinkingVisible/toolUseVisible=false`: transcripts are captured
  (`lib/transcripts.ts`, fail-closed spawner policy) but not *surfaced* — the
  operator surfaces show roster/status, not live reasoning or tool calls. The
  axis measures what the human can see; capture without rendering scores
  false. (The binder's own "blank panel" complaint, chapter 18.)
- `interruptible=false`: process kill exists (`routes/spawn.ts`), but the
  scorer's bar is an interruption/steering affordance during work, enforced
  and surfaced. Kill-only, CLI-only, with no guidance path, does not meet it.
- `forking=false`: sessions resume but no fork-preserving-evidence flow
  (chapter 00 criterion 5) exists yet.
- `caching/eviction=false`: no prompt-cache strategy or context eviction in
  shipped code paths; `memoryPromotion=true` for the episodic memory and
  notes-distillation machinery that does exist.
- `mcp.coreSize=19`: the current Port Daddy MCP tool count (etiquette-verb
  surface, chapter 19).
- `sideEffectHumanGate=false`, `artifactReceipts=false`: no C5 gates; no
  `work_receipts` in code (only in chapter 09 prose — the
  transcript-receipt packet's "existing table" phrasing is corrected by this
  audit: it is target-only).
- `isolation=true`: worktree-per-writer is real operational practice and
  tooling-supported.

Spec files used: authored inline per this packet; regenerate by copying the
two JSON blocks' values from this table into the skill's schema shape and
running `node skills/agentic-app-architecture/scripts/agentic_app_audit.mjs`.
