# Sortie Runbook

`pd sortie` is Port Daddy's mission-dispatch primitive. It wraps `pd spawn`
with a first-class mission record (project, harbor, goal, recipe, budget,
expected output, spawn agent id, events). This runbook covers self-diagnosis
when sorties refuse to launch.

## Lifecycle

| State        | Meaning                                                          |
|--------------|------------------------------------------------------------------|
| `planned`    | Row written, preflight not yet evaluated.                         |
| `blocked`    | Preflight refused before launch. See "Blocked sorties" below.     |
| `running`    | Spawn has started; the underlying agent is executing.             |
| `completed`  | Spawn returned `status=completed` (success path).                 |
| `failed`     | Spawn returned `status=failed` (runtime / agent-side error).      |
| `cancelled`  | Sortie was cancelled by an operator.                              |

Each state transition writes a row into `sortie_events` (visible via
`pd sortie logs <id>`).

## Quick triage

```bash
# Most recent missions, all projects
pd sortie list --all --limit 20

# Detail on a single mission (includes harbor, spawn id, error)
pd sortie status <sortie-id>

# Full event log
pd sortie logs <sortie-id> --limit 200
```

The `sortie:blocked` event always carries the rejection reason in its summary
and metadata. Read that before guessing.

## Blocked sorties

The preflight gate (`lib/spawn-preflight.ts`) refuses a launch when any of:

1. **`Cost tracker unavailable; refusing unmetered agent launch.`**
   The daemon's cost tracker isn't wired. Use FleetBar to inspect and restart
   the selected stable daemon, or rebuild the selected named development
   daemon, then re-check `pd status` for runtime degradation.

2. **`A positive budget ceiling is required for every agentic launch.`**
   The CLI requires `--budget <usd>` with a positive number. Even a sub-cent
   ceiling is acceptable; the spawner enforces the cap during execution.

3. **`Semantic identity is required so spend can be attributed to a project budget.`**
   The route synthesizes `<project>:sortie:<id>:coordinator` from `--dir`, so
   this almost never trips unless `--dir` resolves to something with no
   trailing path component.

4. **`No launchable backend (no configured attempt is setup-ready):`**
   The named backend is not ready. Common causes:
   - `claude-cli`: `claude` binary not on PATH or not authenticated.
   - `codex`: needs an interactive `codex exec` once to seed auth.
   - `ollama`: blocked by telemetry policy until exact rates exist for the
     selected model (ADR / commit `b9fbad2e`).
   - `gemini` / `cloudflare`: env / API key not detected.

5. **`Budget exceeded for <project> ($X / $Y).`**
   The project is over its **daily** ceiling. This is a project-wallet
   problem, not a per-mission `--budget` problem. Fix with:
   ```bash
   pd wallet show <project>
   pd wallet budget <project> --usd-per-day <new ceiling>
   ```
   Note: This block only fires when `dailyBudgetUsd` is supplied to the
   preflight. Sortie launches do not supply it — sorties are gated by the
   spawner's own daily-budget check (`bonds.getBudget(project)`), not by the
   preflight overage gate.

## Historical failure mode: per-mission --budget conflated with daily ceiling

**Symptom:** `pd sortie run "anything" --backend X --budget 0.10` blocks with
`Budget exceeded for <project> ($1.60 / $0.10).` even though the operator
asked for a per-mission `$0.10` cap, not a daily `$0.10` ceiling.

**Root cause:** `routes/sorties.ts` was forwarding the per-call `budgetUsd`
into `assessSpawnPreflight` as if it were a daily ceiling. The preflight
called `costTracker.budgetStatus(project, budgetUsd)` and compared 24h
project-wide spend against the per-mission cap. Any project with non-trivial
spend in the last day would refuse every cheap sortie.

**Fix:** Preflight now takes a separate `dailyBudgetUsd` input. The
per-call `budgetUsd` is still required (positivity gate) but is no longer
compared against accrued spend. The per-call cap is enforced inside the
spawner during execution; the daily ceiling is enforced by the spawner's
bond-admission check against the project wallet's `budgetUsdPerDay`.

**Verification recipe:**
```bash
pd sortie run "diagnostic ping" \
  --backend claude-cli \
  --budget 0.10 \
  --expected "agent replies pong"
pd sortie logs <returned-id>
```
The sortie should transition `created -> planned -> started -> completed`.
If it lands in `blocked`, re-read the matrix above.

## Useful raw HTTP

```bash
# Select the stable daemon or a named feature daemon. The exported URL is the
# endpoint that profile actually published; it may not use the preferred port.
eval "$(pd use stable)"
: "${PORT_DADDY_URL:?pd use did not publish a daemon URL}"

# Health
curl -s "${PORT_DADDY_URL}/health" | jq

# Wallet (project daily ceiling lives here)
curl -s "${PORT_DADDY_URL}/wallets/<project>" | jq '.wallet.budgetUsdPerDay'

# All sorties, raw
curl -s "${PORT_DADDY_URL}/sorties?limit=50" | jq '.sorties[] | {id, status, error}'
```

## Source map

- `lib/sorties.ts` — DB schema + CRUD for sortie rows and `sortie_events`.
- `routes/sorties.ts` — HTTP plugin; orchestrates create → preflight → spawn.
- `cli/commands/sortie.ts` — `pd sortie` CLI (run/list/status/logs).
- `lib/spawn-preflight.ts` — readiness + budget gating shared by `/spawn` and
  `/sorties`. The contract: `budgetUsd` is the per-call cap (positivity only);
  `dailyBudgetUsd` is the optional daily-project overage gate.
- `lib/spawner.ts` — actual spawn execution; enforces project daily budget
  via `bonds.getBudget(project)` and per-spawn telemetry.
