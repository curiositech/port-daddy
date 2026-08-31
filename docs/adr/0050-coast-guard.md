# 0050. The Coast Guard — agentic safety on the operator's machine

## Status

Accepted

> Reconciled by [ADR-0087](0087-trusted-computing-base-broker.md) (2026-06-20):
> this ADR's deferred phase 4 (the malicious same-UID case — "a secret a process
> can use, it can copy", needs separate-UID/VM + `pf` forced egress) is ADR-0087's
> phases 5–6. The rent **policy** (`evaluateLeaseRent`, `lib/coast-guard/`) stays
> here, outside the TCB; ADR-0087 only adds that the daemon *signs* its verdict so
> the broker can verify rather than be told it.

## Context

This ADR was forced by a real incident **in this repository, this week**: the
operator's `.env.local` held every API key he owns (Anthropic, OpenAI, Cloudflare,
Gemini, Groq, GitHub App), in plaintext, readable by any agent with a shell. A
single `cat .env.local` by any of the dozens of agents he spawns is total key
exfiltration and unbounded spend. He named it exactly: *"any bash command has the
power of a god who can bankrupt me."* The same incident also (separately) crashed
the `pd` CLI — see ADR-0045/PR #256 — because the keys were stored as a
shell-idiom that segfaulted bun's dotenv autoload. Both halves trace to one root:
**the operator has no boundary between his agents and his secrets.**

Two findings from the North-Star strategy research (`whitepaper/research/program/archive/north-star/strategy/`)
make this a first-class layer, not a feature:

1. **The same-machine adversary is the unowned seat.** ADR-0040's identity threat
   model is explicitly *intra-fleet, single-operator, not-a-PKI, no defense against
   a hostile process on your own box.* The agent-on-your-machine-turned-wolf is
   precisely what Port Daddy did **not** defend — and the landscape scan found the
   *"local-first, single-operator, secrets-stay-on-device"* seat **empty** while
   every competitor went cloud/enterprise/remote.
2. **It is the wedge.** Of all the layers, this is the one with **day-one
   willingness-to-pay** (fear converts; legibility does not) and no network
   requirement. The defensible long-run frame is **the auditor** — *an independent,
   operator-held, tamper-evident record of what every agent did, including the
   model vendor's own agent.* An auditor's value is that it does not work for the
   company it audits; that is the seat OpenAI/Anthropic/GitHub/Cloudflare are
   *structurally disqualified* from, not merely slow to fill.

## Decision

**Ship the Coast Guard as `pd-cutter`: a stateless spawn *wrapper*, not a daemon
feature.** `pd-cutter [--cap USD] -- <agent command>` does three things to any
command it wraps:

1. **Confine** — an OS sandbox profile (macOS Seatbelt today; Landlock/seccomp on
   Linux) denies the agent reads to the crown jewels (`~/.ssh`, `~/.aws`,
   `~/.gnupg`, cloud creds, every `**/.env.local`) while allowing normal work.
2. **Meter** — all outbound API traffic is forced through a local metering proxy
   that counts per-host requests/bytes and **hard-refuses** once a cap is hit, so a
   runaway or looping agent cannot burn unbounded spend.
3. **Receipt** — emit a signed, append-only record of what ran, what it touched,
   and what it spent — the auditor's artifact.

A **working prototype lives at `tools/coast-guard/`** and is demonstrated on the
operator's own Mac:

- `pd-cutter -- cat ~/.ssh/known_hosts` → `Operation not permitted` (**blocked**)
- `pd-cutter -- cat .../.env.local` → `Operation not permitted` (**blocked** — the
  exact exfiltration that started this ADR)
- `pd-cutter -- head package.json` → succeeds (**normal work unaffected**)
- `pd-cutter --max-requests 2 -- <3 API calls>` → receipt
  `{"requests":3,"blocked":1,"cap":2}` (**the 3rd call hard-refused**)

### The honesty rule (non-negotiable, in all copy and the receipt itself)

There is **no novel cryptography here**, and any claim of one is selling
bookkeeping as a vault. Every primitive is off-the-shelf (Seatbelt/Landlock,
macaroons, CT logs, Enclave keys). The one real move is an **operating-systems
result — privilege separation**: put the secret where the agent's process cannot
reach it. The threat model splits, and we state which side we defend:

- **Defended (cooperative case):** runaway/looping spend, leaked-key blast radius,
  confused-deputy, accidental exfiltration. This is the common, painful case.
- **NOT defended (truly-malicious same-UID):** an agent with your shell can
  `unset HTTPS_PROXY` and egress directly, or read any stray key, or refuse to
  launch under the wrapper. *A secret a process can use, it can copy.* Real
  enforcement against this needs a **separate UID / VM (`Virtualization.framework`)
  + pf/nftables forced egress** — which breaks "the agent edits your live tree."
  That tension is real, unpriced, and disclosed (phase 4), never buried.

We **own the portable, operator-signed outcome-record *format*** (the OCI play —
own the format, stay neutral on the registry); we **adopt** MCP/A2A/OAuth/SPIFFE
for everything else.

## Considered Options

- **A. Daemon-resident security feature.** Rejected: three independent strategy
  critiques converged that *the daemon is the adoption entry-tax*. The wrapper
  earns the daemon; it is not gated behind it.
- **B. Claim defense against the malicious same-UID agent.** Rejected as
  dishonest: impossible without separate-UID/VM isolation, which contradicts the
  live-tree positioning. We sell the cooperative-case defense truthfully.
- **C. Exotic crypto (enclaves/MPC/attestation) as the headline.** Rejected:
  theater on a machine the operator fully controls; the real artifact is privilege
  separation + an honest receipt. (Enclave signing is a phase-3 *integrity*
  detail, not the pitch.)
- **D. (chosen) A stateless wrapper that confines + meters + receipts, honest
  about its threat model, with the daemon/ledger as an earned opt-in.**

## Implementation Matrix (the build DAG)

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0050-phase-0-pd-cutter-wrapper | **shipped** | — | Harden the prototype: Seatbelt + Landlock/seccomp profiles, the egress request/byte cap, the receipt. **Done when:** confines secrets + hard-caps egress on macOS and Linux, with a receipt, and ships with the honest-limits disclosure. **Landed:** `lib/coast-guard.ts` (`buildSeatbeltProfile`, `wrapWithSandbox` — Seatbelt on macOS, bubblewrap/Landlock-helper on Linux), `lib/coast-guard/egress-meter.ts` (hard request/byte cap, `402 Spend Cap Exceeded`), and the `CoastGuardReceipt`. Wired into `lib/spawner.ts` as the **default** for every subprocess backend (opt-out, never advertised). Live demo + CI-wired tests (incl. real `sandbox-exec` confinement on macos-latest). |
| 1 | adr-0050-phase-1-secret-broker | **shipped (env-scrub; TLS-inject pending)** | adr-0050-phase-0-pd-cutter-wrapper | The agent's env holds **no raw key**; a local broker injects the secret into the outbound call. **Done when:** reading `.env.local` yields nothing useful because the keys are not there. **Landed:** `scrubRawSecretsFromEnv` strips every managed key (the `secret-env.ts` allow-list) from the spawned child's env; the sandbox denies `.env`/`.env.local` in `$HOME` **and** the workdir; so both `cat .env.local` and an env dump yield nothing usable. `buildBrokerRules` injects keys on **plain-HTTP** outbound today; HTTPS header-injection needs the phase-2 MITM CA (the raw-key-not-in-env property already holds for every backend). |
| 2 | adr-0050-phase-2-dollar-metering | **partial (byte/request cap shipped; USD-MITM pending)** | adr-0050-phase-0-pd-cutter-wrapper | Dollar-accurate metering: a local CA + MITM that parses provider `usage` fields, replacing the byte/request proxy. Fixes `budget-guard.ts`'s self-reported spend. **Done when:** the cap is in real USD, not request count. **Landed:** the hard request/byte cap (`EgressMeter`) is the enforceable floor today; the USD-accurate MITM upgrade remains. |
| 3 | adr-0050-phase-3-signed-outcome-format | now | adr-0050-phase-0-pd-cutter-wrapper | The portable, operator-signed outcome-record **format** (the OCI play) + Enclave/TPM-backed signing + an append-only transparency log. **Done when:** any party can verify a receipt without trusting Port Daddy. |
| 4 | adr-0050-phase-4-real-isolation | backlog | adr-0050-phase-1-secret-broker | The honest upgrade against the malicious case: separate UID / `Virtualization.framework` + pf forced egress. **Done when:** an agent that `unset HTTPS_PROXY` still cannot egress or read secrets — with the live-tree tradeoff documented. |
| 5 | adr-0050-phase-5-littlesnitch-policy | backlog | adr-0050-phase-2-dollar-metering | Per-agent network policy (LittleSnitch-style allow/deny by host) + an operator prompt surface. **Done when:** the operator can scope each agent's egress to named hosts. |
| 6 | adr-0050-phase-6-team-rollup | backlog | adr-0050-phase-3-signed-outcome-format | The paid Trust tier: roll receipts up to a team policy-and-audit plane. **Done when:** an eng lead sees every agent's signed record across the team. |
| 7 | adr-0050-phase-7-compulsion | **shipped (note-per-commit enforced; reclaim sweep next)** | adr-0050-phase-0-pd-cutter-wrapper | **The compulsion — coordination is the price of the sandbox.** Mechanism design, not politeness: a voyage keeps its Coast-Guard sandbox only while it pays coordination rent. **Done when:** an un-noted commit blocks the next commit; a dark/abandoned sandbox is reclaim-eligible — and reclaim can NEVER touch the live main checkout. **Landed:** `lib/coast-guard/compulsion.ts` (pure rent evaluator + reclaim safety gate, 19 tests), `lib/coast-guard/compulsion-facts.ts` (git+daemon fact gatherer, fails open), wired into the Coordination Guard as `requireNotePerCommit` (default on) so "no note, no commit" is enforced at commit-time (7 guard tests). The reclaim sweep (`shouldReclaim` is built + gated; the reaper CLI surface is the next slice). |

### The compulsion (phase 7) — why it's the keystone

The other phases defend the operator *from* agents (secrets, spend). Phase 7 makes
agents **use Port Daddy at all**. The failure it fixes is the dark lane: an agent
that works without coordinating — no notes, no claims, never rebased — is invisible
to the fleet and collides with everyone. Asking nicely does not scale.

So we price it. The Coast Guard already hands out the sandbox (phase 0); phase 7
makes *keeping* it conditional on coordination:

- **commit ⇒ note publish** — every commit must publish a coordination note. An
  un-noted commit blocks the next commit. (Enforced now, in the guard.)
- **stay rebased** — drift far behind the live base *and* go silent, and the lease
  is stale → reclaim-eligible.
- **feed suggestibility** — leave the inputs the cartographer needs (a scope note,
  a claim). A lease with zero signal past the grace window is idle → reclaim-eligible.

The Nash-equilibrium behavior becomes *communicate*, because the alternative is
losing the live sandbox — incentive-compatible by construction. Two honesty rules
carry over from the rest of this ADR: the refusal copy points only at the
corrective action and **never names a bypass**; and reclaim is gated so it can act
**only** on a disposable sandbox under the scratch root, **never** the operator's
live main checkout (`isReclaimableSandbox`). Cold ≠ dead: the grace windows are
lenient on purpose — rent bites the hoarder, not the operator who walked away
mid-thought.

This is the L1-safety / L2-legibility wedge of ADR-0048 made concrete; it is the
**"don't let my agents bankrupt me"** product the strategy memo names as the
day-one converting feature. It composes with the Arbiter jail (ADR-0045) and the
`auth-chain` capability attenuation (the Anchor Protocol).

### Phase 7 — rent→slash: advisory-only landing, enforce quarantined (2026-06-26)

The note-per-commit compulsion above is shipped. Closing the *economic* loop —
turning a repeated, egregious rent breach into a graduated **bond slash** — lands
in two deliberately separated halves:

**Landed (the safe 80%):**

- `lib/coast-guard/rent-slash.ts` — the **pure policy**. Modes `off|advisory|enforce`
  resolved from `PD_RENT_SLASH_MODE`, **failing safe to `advisory`** (a typo never
  arms debiting). Graduation: first miss is grace (the commit-block is the whole
  response), then `baseFraction · (breachCount − grace)` clamped to `maxFraction`.
  Defaults: grace 1, 10%/step, **50% hard cap** — a rent slash never takes the whole
  bond. No I/O, no clock, no wallet.
- `lib/coast-guard/rent-breach-ledger.ts` — the **per-principal escalation memory**
  (SQLite, injected clock). `cure()` decays toward grace; a 24h quiet window resets.
  Keyed on the **Anchor/principal** identity, never a re-rollable agent id (Sybil
  defense). The graduated-trigger / "graduated, not grim" doctrine (`game-theory.md §4`):
  a crash and a defection look identical to an observer, so punishment is forgiving.

In this landing the policy is an **observability instrument**: a caller can compute
the slash that *would* apply and log it. Nothing here moves money.

**Quarantined (the unsafe 20% — do NOT ship until reconciled with ADR-0087):**

The money-moving enforcer (`bonds.slash` call) and the HTTP routes
(`POST /coast-guard/rent-breach`, `POST /coast-guard/rent-cure`) are intentionally
**not** shipped. An earlier draft authenticated them only by *possession of a
`sessionId`*, which carries two incentive bugs that make `enforce` exploitable:

1. **Breach-report griefing.** A `sessionId` is readable by every local agent via
   `pd sessions`. Deriving the breaching principal "server-side" from a *caller-supplied*
   sessionId means a malicious agent can pass a **neighbour's** sessionId and slash
   **their** bond — griefing a rival's collateral into the commons for the cost of one
   request. The Sybil defense protects who gets slashed, not who can *trigger* a slash.
2. **Unauthenticated self-cure (Goodhart).** A `cure` route that decays the caller's
   own count without verifying a note was actually published lets a breacher
   `breach → cure → breach …` forever and never escalate past grace.

The fix is exactly the reconciliation ADR-0087 (#500) already specifies: **the daemon
signs its rent verdict so a verifier can check it rather than be told it.** Breach
detection must therefore be a **guard-signed / daemon-internal** event, not an open
bearer route. Until that wiring exists, `enforce` stays unreachable in practice and
the routes do not ship. The advisory default is unaffected — it moves no money, so
neither bug can bite it.

One honest caveat the advisory landing makes explicit: the metric is note-**presence**
per commit, not coordination **quality**. Rent can be "paid" with a trivial note. That
is acceptable for a presence incentive but must not be mistaken for a measure of useful
coordination.

## Consequences

### Positive
- A shippable, paid, day-one-valuable wedge that needs no network, no economy, no
  second operator — and validates the whole thesis cheaply (a real "your agent
  tried to read your keys and couldn't" demo already runs).
- Establishes the **auditor** positioning the giants are structurally disqualified
  from, and the signed-outcome-record format we want to own.

### Negative
- The wrapper does **not** defend the truly-malicious same-UID agent; we must say
  so plainly and resist the temptation to imply otherwise. Real isolation (phase 4)
  trades away "edits your live tree," an unresolved tension we carry openly.

### Neutral
- Dollar-accurate metering (phase 2) requires MITM with a local CA — a setup step
  some operators will decline; the byte/request cap is the honest default until then.
