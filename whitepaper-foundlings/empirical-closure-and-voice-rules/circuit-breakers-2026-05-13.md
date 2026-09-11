# Circuit Breakers — port-daddy-waves orchestration

**Drafted:** 2026-05-13 · **Source:** survey of `~/coding/workgroup-ai/packages/core/src/` shipping primitives + CODE_REVIEW.md gaps + Wave 0 H-diagnostic findings.

Six breakers. Each one is the answer to a specific Wave-0 cascade we observed or that workgroup-ai's CODE_REVIEW.md flagged as missing. Every agent MUST honor them. If you can't implement one, halt and HITL-ask — don't bypass.

---

## CB-1 · Per-Identity Budget Envelope (running, not just pre-approval)

**What workgroup-ai has:** Pre-execution cost-estimate gate (`packages/core/src/core/executor.ts:378–384`). Approval at start; no running ceiling.

**What we need extra:** A running spend ceiling that trips mid-execution when cumulative cost > cap.

**Wave 0 evidence:** `port-daddy` auto-detected identity had burned $7.81 against my $1.00 cap — the gate fired correctly but only because the cap was set absurdly low. With a $20 cap and cumulative cost piling up under one bucket, the breaker would never trip.

**The rule.**

1. Every `pd spawn` MUST use a unique identity: `port-daddy:research:feat-<slug>` (one identity per feature item, NEVER `port-daddy` bare).
2. Every spawn MUST pass `--budget <usd>` with a positive ceiling. Default for Wave 1: **$5 per agent**. Wave 2/3 items #4 and #8 may need more — those agents ask via HITL.
3. The lab as a whole has a **lab-wide ceiling of $300**. Once total `pd cost`-equivalent burn hits $300, **all Wave 1+ spawns halt** until HITL approves a new ceiling.

**Enforcement:** the per-identity gate is already in PD (we saw it fire). The lab-wide ceiling is an external watchdog — see CB-6 below.

---

## CB-2 · Wave-Level Kill Switch

**What workgroup-ai has:** `killAllProcesses()` (`packages/core/src/executors/registry.ts:224–231`) — kills everything globally.

**What we need extra:** Halt one wave without nuking the others.

**The mechanism.**

Two sentinel files at known paths. Every agent checks them on entry and at every checkpoint (start, mid-impl, tests-pass, PR-ready).

- `~/coding/port-daddy-waves/_meta/HALT-ALL` — if this file exists, every active agent must immediately set its STATUS to `BLOCKED — reason: halt-all sentinel` and stop.
- `~/coding/port-daddy-waves/_meta/HALT-WAVE-<N>` — same, scoped to wave N.

To trigger: `touch ~/coding/port-daddy-waves/_meta/HALT-ALL`. To resume: `rm` it. Both are advisory but a violating agent must explain itself in `pd note`.

**Agent must implement:** before every long-running operation (spawn, npm test, lib install, etc.), run `test -e ~/coding/port-daddy-waves/_meta/HALT-ALL` and `test -e ~/coding/port-daddy-waves/_meta/HALT-WAVE-$WAVE`. Either present → halt cleanly.

---

## CB-3 · Fanout Depth Limiter (no unbounded child spawning)

**What workgroup-ai lacks:** No depth limit on agent fanout (per CODE_REVIEW.md gap analysis).

**Wave 0 evidence:** Spark agent fleet was producing telemetry-failure notes in tight loops; a sub-agent that itself spawns children can multiply unboundedly.

**The rule.** Hard cap: `PD_SPAWN_MAX_DEPTH = 2`. That is:

- Depth 0: you (Claude main thread, the lab PI)
- Depth 1: a feature agent (Wave 1+ item, spawned via `pd spawn --backend claude-cli`)
- Depth 2: a sub-task that feature agent legitimately needs (e.g., a redteam pass on its own PR before merge)

**No depth 3.** A depth-2 agent that thinks it needs to spawn a child MUST instead `pd hitl ask` and let the PI route it.

**Enforcement:** every spawn sets env `PD_SPAWN_DEPTH=$((PARENT_DEPTH + 1))` and refuses to run if depth > 2.

---

## CB-4 · Hung-Task Liveness Probe (heartbeat-or-die)

**What workgroup-ai has:** Per-node timeout (default 5min) — fires only on total elapsed time, not on silence.

**What we need extra:** Detect silent hangs (process running but not progressing — e.g., the Wave-0 npm-test that silently failed because node_modules was missing).

**The rule.**

- Every agent posts a `pd note` heartbeat at minimum **every 15 minutes** while active. Format: `pd note "[heartbeat] <slug> phase=<X> elapsed=<Y>min last_action=<Z>"`.
- An external watchdog (CB-6) checks heartbeats every 5 min. If an agent's last heartbeat is older than **30 min**, the watchdog:
  1. Sends an inbox message to the agent.
  2. Posts `coordination:inconsistency` alert.
  3. If still no heartbeat at 45 min: marks the agent's session BLOCKED + halts its sub-branch.

**Agent must implement:** before every operation expected to take > 10 min, post the heartbeat. After long ops, post another. Heartbeat is cheap, silence is fatal.

---

## CB-5 · Per-Item Failure Circuit Breaker (no retry-storm)

**What workgroup-ai lacks:** Per-skill circuit breaker (CODE_REVIEW.md:141 — "consistently failing skill will keep being retried").

**Wave 0 evidence:** "Allow claude-cli backend through telemetry gate" has 1 corpse from 6d ago. "Branch protection keychain regression test" has 3+ corpses, all 6d old. Same work, repeated failure, no halt.

**The rule.**

- If an item fails (BLOCKED or rate-limited or sub-task error), bumps its `failure_count` in `_meta/STATUS.md`.
- At `failure_count >= 2` for the same item, the item enters **OPEN-CIRCUIT** state:
  - No further re-spawn of that item until HITL clears it.
  - PI must read both prior corpse notes and reason about WHY before re-launching.
- HITL-clear writes `failure_count: 0` and adds a `cleared_by_pi: <reason>` field.

**Where it lives:** added to the STATUS.md schema in AGENT-CONTRACT.md.

---

## CB-6 · Lab-Wide Watchdog (the external observer)

**What it does:**
- Polls every 5 min: total `pd cost`-equivalent burn (CB-1 ceiling), every agent's heartbeat age (CB-4), sentinel files (CB-2).
- Posts a summary every 30 min to `coordination:announce`.
- Trips CB-2 (writes `HALT-ALL`) automatically if: lab burn > $300, OR any agent's heartbeat > 45 min, OR more than 3 items in OPEN-CIRCUIT (CB-5) simultaneously.

**Implementation:** a small shell script run via `pd cron` or launchd; OR run in this session via `loop` skill for the duration of Wave 1. Trade-off: launchd is more durable; in-session is simpler and we control the cadence.

**Initial implementation:** in-session loop with 5-min cadence. Promote to launchd if/when Wave 2 starts.

---

# Summary table

| # | Breaker | Wave-0 evidence | workgroup-ai source | New machinery |
|---|---|---|---|---|
| CB-1 | Per-identity budget envelope | $7.81 piled under bare `port-daddy` | `executor.ts:378–384` | Per-spawn unique identity + lab-wide $300 ceiling |
| CB-2 | Wave-level kill switch | (preventive) | `registry.ts:killAllProcesses` | `HALT-ALL` / `HALT-WAVE-N` sentinel files |
| CB-3 | Fanout depth limiter | (preventive against subagent cascades) | (gap, per CODE_REVIEW.md) | `PD_SPAWN_DEPTH` env, hard cap of 2 |
| CB-4 | Hung-task heartbeat | npm test silent failure, missing node_modules | per-node timeout (related) | `pd note "[heartbeat]"` every 15m, watchdog kills at 45m |
| CB-5 | Per-item failure circuit breaker | 3+ corpses on same regression test, 6d ago | (gap, per CODE_REVIEW.md:141) | STATUS.md `failure_count`, OPEN-CIRCUIT state, HITL clear |
| CB-6 | Lab-wide watchdog | (orchestrates the others) | (composes all of the above) | 5-min poll loop, trips CB-2 on threshold breach |

---

# How to install before Wave 1 spawns

Six minimal steps:

1. **Patch `setup-waves.sh`** — already exists at `~/coding/port-daddy-research/scripts/setup-waves.sh`. Add: (a) `npm install` (or `ln -s ~/coding/port-daddy/node_modules` per worktree) so CB-4 silent-fail in node_modules is impossible; (b) initialize `failure_count: 0` in each STATUS.md.
2. **Update `AGENT-CONTRACT.md`** — already exists. Add the CB-1..CB-5 rules verbatim.
3. **Update each item's `RUNBOOK.md`** — already templated. Add the heartbeat reminder (CB-4) to the coordination section.
4. **Create the watchdog script** at `~/coding/port-daddy-waves/_meta/watchdog.sh`. Implements CB-6.
5. **Run the watchdog in-session** via the `loop` skill at 5-min cadence, OR install it via `pd cron`. Wave-1 launch waits until watchdog is live.
6. **First Wave-1 spawn is a smoke test** of one item (item #6 salvage triage — shortest, lowest blast) before launching the other 4 in parallel.

Total prep before Wave 1 launches: ~1 hour. The breakers cost effectively nothing to run; their cost is borne if they trip.
