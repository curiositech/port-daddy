# 0045. Loud-Fail Invariants and Honest Attestation

## Status

Accepted

## Context

Port Daddy today mostly **degrades quietly**: a wedged DB returns 500s, a missing
key throws deep in a handler, a stale claim just sits there, a half-applied
`brew upgrade` leaves a daemon nobody notices is wrong. The operator's standing
demand across this project has been the opposite — *honest confidence*: tell me
plainly when something is broken, and **only say "all good" when you have actually
verified it.** A green that wasn't checked is a lie, and this system has burned
the operator with confident-but-wrong claims before.

There are two distinct jobs here, and the classical agent canon names them
(Jones & Sergot 1993, **deontic logic** in computer systems — *the formal study of
obligation and prohibition in software*):

- **Regimentation** — make a forbidden state *physically unreachable*. The
  **Arbiter** (`lib/arbiter.ts` — *the runtime monitor that blocks forbidden
  coordination states like double-claimed ports*) already does this for
  prohibitions; the test/prod DB guard (ADR/PR #214) does it for one integrity
  invariant. Some safety invariants can be regimented: *refuse to boot* on a
  corrupt DB.
- **Enforcement** — for invariants you can only *observe and sanction*, run a
  monitor and react. This is the obligation half (ADR-0041, **durable
  commitments** — *violable promises bound to an actor, caught by a monitor*).

What we lack is a **single, honest self-report** that runs every invariant check,
distinguishes *verified-good* from *no-evidence-of-bad*, regiments what it can,
and screams about what it can't. "The daemon responds" is not "the DB is sound"
is not "crypto works" is not "this binary is the one the tap published."

## Decision Drivers

- **Honest green.** "All good" is *conjunctive and scoped*: only when every
  *checked* invariant passes, and the report explicitly lists what was **not**
  checkable. Absence of error ≠ attestation.
- **Loud failure.** A CRITICAL invariant violation must refuse/scream, never
  silently degrade — and the message names the *specific* invariant and the fix
  (the same anti-silent-failure discipline as the `isTTY` CLI bugs).
- **Non-repudiable.** A clean attestation should be signable with the actor
  identity (ADR-0040) so "all good" is a claim with a verifier, not vibes.

## Considered Options

- **A. Keep ad-hoc checks scattered (`/health`, the #214 guard, manual eyeballing).**
  Rejected: no single answer, no honest-green discipline, easy to over-claim.
- **B. A monitoring stack (Prometheus/Grafana).** Rejected for this purpose:
  great for trends, wrong for a fail-closed boot gate and a one-command "is my
  install sound right now?" answer; also off-box, another source of truth.
- **C. (chosen) A first-class invariant registry with one `pd attest` surface,
  three trigger points (boot regimentation, CLI pre-flight, continuous watchdog),
  and signed honest-green reports.** Composes the Arbiter (#214 regimentation),
  commitments (ADR-0041 enforcement), and actor identity (ADR-0040 non-repudiation).

## Decision

Introduce an **invariant registry** and a single attestation surface, `pd attest`
(alias `pd doctor --strict`). Each invariant declares: `id`, `class`, `severity`
(`CRITICAL | WARN | INFO`), and a check returning `PASS | FAIL | SKIPPED(reason)
| UNKNOWN`. The report is **scoped**: it lists passes, failures, and — loudly —
everything `SKIPPED`/`UNKNOWN`. `pd attest` exits non-zero if any CRITICAL is not
`PASS`.

**The exhaustive invariant set, by class:**

| Class | Invariants (CRITICAL unless noted) |
|---|---|
| Liveness | daemon responds (socket+port); CLI↔daemon **version match**; daemon runs from the **expected install path** (homebrew-vs-repo trap); heartbeat fresh; supervisors (launchd, bosun) installed+running *(WARN)* |
| Integrity | `PRAGMA integrity_check` ok; DB on the **expected path** (ADR-0044); **schema present** (no missing tables/columns — the bun-vs-jest 500 class); prod daemon **not** on a test DB (extends #214); WAL checkpointing; **backup within N hours** *(WARN)* |
| Security/crypto | **crypto self-test** (sign→verify round-trip) passes; keychain reachable + signing keys present; actor-identity verification **enabled** (ADR-0040); DB file perms not world-readable (ADR-0017); CF/GitHub tokens present+unexpired *(WARN if optional)* |
| Provenance | **installed binary SHA == tap formula's declared hash**; codesign/notarization valid; binary version == claimed git tag |
| Coordination | **Cartographer (and any committed actor) up**, no breached commitment (ADR-0041); Coordination Guard enforcing where expected; Arbiter running; stale-claim/orphan-session pileup under threshold *(WARN)* |
| Cost | budget not exceeded / no spend runaway *(WARN→CRITICAL at hard cap)*; configured spawn backend reachable *(WARN)* |

**Three trigger points:**
- **Boot (regimentation):** the daemon runs the CRITICAL set at startup; on
  failure it refuses to serve normally — `/health` returns a screaming
  degraded state and emits a coordination alert. Forbidden states made
  unreachable, not just logged.
- **CLI pre-flight (loud refusal):** commands that need integrity/crypto run a
  fast check and **refuse with the specific failed invariant and its fix** —
  never hang, never silent-500.
- **Continuous (enforcement):** a watchdog re-runs on a cadence; any PASS→FAIL
  transition emits a pheromone/`coordination:inconsistency` signal + notification
  and turns FleetBar's icon red.

**Honest green:** `pd attest` prints "all good" *only* when every checked CRITICAL
+ WARN passes, and always prints the `SKIPPED`/`UNKNOWN` list so the operator sees
the boundary of what was verified. A clean report is signed with the daemon's
actor identity (ADR-0040) so the green is non-repudiable.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0045-phase-0-attest-core-and-report | now | — | Invariant registry type + report contract (PASS/FAIL/SKIPPED/UNKNOWN, severity, honest-green scoping); `pd attest` CLI; exit non-zero on CRITICAL; unit tests for the report/honest-green logic |
| 1 | adr-0045-phase-1-checks-liveness-integrity | now | adr-0045-phase-0-attest-core-and-report | Liveness + integrity invariants (daemon/version/path/integrity_check/schema/test-prod-DB/backup-freshness) |
| 2 | adr-0045-phase-2-checks-security-provenance | now | adr-0045-phase-0-attest-core-and-report | Crypto sign→verify self-test, keychain, actor-id enabled, DB perms; **brew-hash mismatch**, codesign/notarization, version==tag |
| 3 | adr-0045-phase-3-checks-coordination-cost | now | adr-0045-phase-0-attest-core-and-report | Cartographer/committed-actor up, Guard enforcing, Arbiter up, stale-claim pileup, budget runaway, backend reachable |
| 4 | adr-0045-phase-4-boot-regimentation | now | adr-0045-phase-1-checks-liveness-integrity | Daemon runs CRITICAL set at boot; refuse-to-serve / screaming `/health`; coordination alert on failure |
| 5 | adr-0045-phase-5-cli-preflight-loud-refusal | now | adr-0045-phase-1-checks-liveness-integrity | Integrity/crypto-dependent commands run a fast pre-flight and refuse loudly with the specific invariant + fix |
| 6 | adr-0045-phase-6-watchdog-and-signed-attestation | now | adr-0045-phase-2-checks-security-provenance | Continuous watchdog (PASS→FAIL → pheromone + notification + FleetBar red); sign clean reports with actor identity (ADR-0040) — non-repudiable green |

## Consequences

### Positive
- One honest answer to "is my Port Daddy running, secure, and sound?" — scoped,
  signed, and loud when it isn't.
- Whole classes of silent degradation (wrong DB, dead Cartographer, tampered
  binary, broken crypto) become refuse-or-scream, not limp-along.

### Negative
- Every invariant is code to maintain; mitigated by the registry pattern (each
  check is a small, independently-tested unit) and by shipping classes as phases.
- Boot regimentation can refuse to start a daemon — by design; the failure
  message must always name the fix (else it's just a different silent failure).

### Neutral
- This is the natural home for existing one-offs (`/health`, the #214 guard,
  ADR-0044's resolver report) — they become registered invariants.
