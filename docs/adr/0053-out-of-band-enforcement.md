# 0053. Out-of-Band Enforcement — making Port Daddy compulsory, not bypassable

## Status

Proposed (2026-06-12)

> Reconciled by [ADR-0087](0087-trusted-computing-base-broker.md) (2026-06-20):
> this ADR's three layers converge on one object — a separate-UID Rust broker.
> Layer 3 (separate-UID/VM + `pf` forced egress) is ADR-0087's phases 5–6;
> Layers 1–2 (branch protection + credential broker) are its phase 4. ADR-0087
> does not supersede this — it concretizes the spine.

> Note: ADR number 0051 is taken by *The Marketplace Protocol* (`docs/adr/0051-marketplace-protocol.md`) and 0052 by *Trajectory Export* (`docs/adr/0052-trajectory-export-and-rl-loop.md`); this ADR takes the next free number, 0053. Add the corresponding row to `docs/adr/README.md`.

## Context

Port Daddy's enforcement today runs *in-band*: it lives inside the agent's own
shell, as the same user, invoked through the same `PATH` the agent controls.
That arrangement is advisory **by construction**, and the code says so out loud.

The **git shim** (`cli/utils/git-shim.ts`) intercepts destructive verbs
(`reset --hard`, `clean -fd`, `push --force`, `update-ref refs/heads/main`, …)
and refuses them when the **Coordination Guard** (`cli/commands/guard.ts` — the
pre-commit/destructive-op gate that checks for an active session, file claims,
note-per-commit, and rebase state) is enforcing. But the shim's own refusal copy
ends with the escape route (`cli/utils/git-shim.ts` line 256):

```
pd-shim: <verb> refused by Port Daddy coordination guard.
pd-shim: see 'pd guard status' for current mode.
pd-shim: bypass once with PD_SHIM_OFF=1 git <args>.
```

An agent that hits that wall can get past it five different ways, none of which
require defeating any cryptography:

1. **`PD_SHIM_OFF=1`** — the shim hands the agent its own bypass (the escape is
   audited to `~/.port-daddy/destructive-ops.log`, but not stopped).
2. **Absolute path** — `/usr/bin/git reset --hard` never enters the shimmed
   `PATH`. ADR-0040 (`docs/adr/0040-pd-encompassing-shell.md`, lines 183–187)
   already records this as an open limitation; the proposed `PD_SHIM_STRICT=1`
   (fanotify/DTrace) is unimplemented.
3. **`PATH=` rewrite** — point `PATH` at a directory with the real `git` first.
4. **Direct `.git` writes / in-process bindings** — **libgit2** (a linkable C
   implementation of git that bypasses the `git` executable entirely) or an
   editor's in-process git bindings never spawn a `git` subprocess for the shim
   to intercept.
5. **Just don't run `pd begin`** — never attach a session, never claim a file,
   and the coordination layer has nothing to check against.

This is not a bug in the shim. It is the ceiling of the in-band design: **you
cannot out-trick a same-UID process from inside that same process.** ADR-0050
(`docs/adr/0050-coast-guard.md` — *The Coast Guard: agentic safety on the
operator's machine*, the sandbox + secret-broker + metering plane) already
conceded the cryptographic version of this: *"A secret a process can use, it can
copy."* The same logic applies to enforcement verbs — a guard a process can
invoke, it can decline to invoke.

It applies equally to the **ambient host credential**. On a real operator box,
the user's `~/.gitconfig` resolves a credential helper additively across
system/global/local scopes (typically `gh auth git-credential` plus
`osxkeychain`), and `gh auth status` shows an ambient `gho_…` token in the
keyring with `repo` + `workflow` scope. A same-UID agent can read that token
(`gh auth token`), invoke `gh` directly (`gh pr create`, `gh api`), or run
`git -c credential.helper='!gh auth git-credential' push` — none of which the
in-band shim sees. **On a shared-UID box the ambient gh/keychain credential is
itself a push capability; nothing short of the kernel boundary removes it.**

The operator wants every agent on a repo to be **unable** to bypass Port Daddy,
the sandbox, or git policy — and specifically unable to escape by setting a
bash/env variable. That goal is unreachable as long as the trust boundary sits
inside the agent's process. This ADR moves the boundary out-of-band, layer by
layer, and is explicit about which layer closes which threat.

## Decision Drivers

- **Remove the capability, do not block the verb.** A refusal that runs as the
  agent is a request the agent can ignore. A capability the agent never holds is
  a capability it cannot misuse, regardless of which binary, `PATH`, or env var
  it tries.
- **Highest-leverage layer first.** The cheapest layer (server-side branch
  protection plus a push broker) closes the most painful *direct/force/delete-to-
  protected-ref* incidents with no new same-UID trickery.
- **Honest threat model.** The large majority of real incidents are accidents,
  misconfiguration, and confused-deputy behavior — not a hostile process. The
  design must defend that common case cheaply and say plainly where it stops.
- **Keep the loud tripwire.** The shim and guard stay valuable as the *audit
  surface* — every escape attempt should log — even once they are no longer the
  wall.
- **Incentive-compatible compulsion — once Layer 3 lands.** Once the ambient
  credentials are removed (Layer 3), coordinating through Port Daddy becomes the
  only path to a usable credential, so coordinating is the dominant strategy, not
  a rule to obey. This property is an aspiration of the full stack, not a claim
  about Layers 1–2 (see *Honesty / threat-model split*).

## Decision

Adopt an **out-of-band enforcement** model in three layers. Each layer moves a
specific capability toward a boundary the agent's process does not control. Each
**Implementation Matrix row ships as its own PR off `main`** — so Layer 1 lands
as three PRs (branch-protection + broker, push gate, tripwire demotion). Layers
increase in teeth and in cost; the operator adopts them in order.

### The reframe

Stop asking the agent's shell to refuse a verb. Instead, put the thing the agent
needs (a push credential, an API key, read access to crown-jewel files) **behind
a boundary the agent's process does not control** — a remote server, a broker
process, or a different UID / VM kernel. The shim and guard are retained, but
demoted from *wall* to **loud tripwire**: they keep logging every attempt to
`activity_log` and `~/.port-daddy/destructive-ops.log`, so the operator sees the
escape even when the boundary already stopped the damage.

#### The unifying primitive — one macaroon, one third-party caveat

A **macaroon** (Birgisson et al., 2014 — a bearer credential whose holder can
*attenuate* it by appending caveats but never broaden it, and that can require a
**third-party discharge** — a separate proof that some condition holds) makes the
Layer 1 push grant and the Layer 2 API-key grant **the same object**. The grant
is a macaroon whose single third-party caveat is *"the Port Daddy daemon attests
rent-paid for session S"*, dischargeable **iff** the coordination invariants hold
(session active, scope claimed, a note per commit, branch rebased). This buys
three things the imperative gate does not:

1. **The broker's four checks collapse into one cryptographically-verifiable
   capability.** The Relay (`apps/relay`, shipped + ProVerif-modeled, ADR-0049)
   already verifies discharges; the gate becomes "reject any push/key-use whose
   macaroon lacks a valid rent-paid discharge," not four imperative `if`s that can
   drift.
2. **Attenuation is free and one-directional.** An agent can narrow a push
   macaroon to a single branch or a short TTL; it can never broaden one. The
   enforcement half is **already built** — `feat/cap-attenuation-monitor` enforces
   `CAP_ESCALATION` (no-broadening) in pure TS, and the **per-hop** discipline is
   machine-checked: `analyses/macaroon_discharge_v1.pv` proves the discharge
   construction unforgeable + request-bound (Q1 `true`), and the card branch
   `defense/anchor-attenuation-soundness` proves the analogous naive-verifier-is-
   unsound result for Ed25519 cards. The per-hop-vs-naive *regression* for macaroons
   (Q2) is `analyses/macaroon_discharge_v2_naive_unsound.pv` — the naive verifier is
   `false` (attack found) under cross-grant replay, justifying the binding check.
3. **It splits Layer 1 into two independently-shippable halves** (see the matrix):
   the crypto **gate** — the daemon/Relay refuses to push without a valid
   rent-paid discharge — lands **before** the egress **confinement** (the GitHub
   App installation token). The gate delivers the *wall* property even while the
   push still flows through the operator's `gh` token, which **directly de-risks
   the Phase-0a gap** below (a token-shelling broker gates + audits but does not
   confine — with the macaroon, it still cannot push without a valid discharge).

This does **not** weaken the honesty rule: the agent still briefly holds the
discharged macaroon, so Layers 1–2 remain *not a vault* against a malicious
same-UID process (only Layer 3 is). The macaroon makes the gate **unforgeable**
and the audit a **verifiable transcript** — it does not confine a process that
copies the credential it legitimately holds.

### Layer 1 — Branch protection + push broker (the wall for protected refs)

The highest-leverage layer. Buildable in days for the branch-protection half.
**Scope it honestly:** Layer 1 closes **direct push, force-push, and branch
deletion to the exact protected refs** — and nothing more. It is defeated by any
ambient host credential reachable at the same UID (the `gh` keyring token,
`osxkeychain`, `~/.git-credentials`); removing that credential is Layer 3, not
Layer 1.

**Server-side branch protection.** Configure **GitHub branch protection** (a
server-enforced ruleset on the repo: no direct push, no force-push, no branch
deletion, required pull request, required status checks) on `main` and the
release glob. This is enforced by GitHub, off the agent's machine; no env var on
the agent's box can relax it. **Caveats:**

- The ruleset protects **only the literal matched refs**. Feature branches,
  other agents' work branches, and any ref outside the glob remain
  force-pushable, deletable, and rewritable by anyone holding a working push
  credential — a real residual risk for multi-agent fleets sharing one repo.
- Audit the release glob for near-miss patterns: `release/*` does **not** match
  `releases/foo` or `release-foo`. Pick the pattern set deliberately.
- The broker gate (below) is the only thing protecting non-`main` branches, and
  only for traffic that actually routes through `pd push`.

**Agents hold no *repo-local* push credential.** The agent's git config sets a
**null credential-helper** for the protected remote. To work at all this must
emit an empty `helper =` **reset line in the first-evaluated scope**, so the
inherited global `gh`/keychain helpers are discarded for that remote; without the
reset line, helper resolution is additive and the global helper still answers.
**This does nothing about the agent invoking `gh` directly, reading
`gh auth token`, or passing `-c credential.helper=…` on the command line.** A
merely-confused agent that runs plain `git push origin feature-x` today succeeds
via the inherited global credential. So the null helper raises the bar for the
*repo-local default path* only; the ambient credential is removed only by Layer 3.

**Pushing routes through `pd push`.** A new command, not yet shipped (`cli/commands/push.ts`,
following the pattern of the existing `cli/commands/dispatch.ts`) asks the daemon
to push on the agent's behalf, with the broker holding the credential
out-of-process.

> **Honest maturity note — App-token egress is NOT yet built.** There is no
> `@octokit/auth-app` / `createAppAuth` / installation-token-minting path in this
> repo. `routes/github-webhook.ts` only *parses* an inbound `installation_id`; it
> never mints a token. `lib/fleet/github-output.ts` says verbatim that **today**
> it "shells out to `gh` and inherits the operator's auth token … the same token
> that runs `gh pr view` locally," and that App credentials are **"sibling work
> in flight"** for *tomorrow*. So webhook **ingress** is wired; App push/comment
> **egress** is unbuilt. Until the App egress path exists, a broker that shells
> the operator's `gh` token pushes with **the same credential the agent can also
> read** — it provides **audit + gating, not credential confinement**. The "a
> token the agent never sees" property is real only once the App installation
> token lands (tracked as Phase 0 below).

Before the broker pushes, it verifies the **compulsion gate** (see *Compulsion
glue* below): an active coordinating session, Coordination Guard green, a
coordination note for each commit being pushed, and a branch rebased onto the
canonical remote head. If any check fails, the broker refuses and `pd push`
returns the corrective action only:

```
pd push: refused — push target main is protected; open a PR from a feature branch.
pd push: refused — commit <sha> has no coordination note; run 'pd note' then retry.
pd push: refused — branch is behind origin/main; rebase, then retry.
```

The refusal copy names the corrective step and **never** names a bypass.

**The gate binds only traffic that flows through it.** Nothing *forces* a push
through `pd push`. As long as the agent holds any working credential — and on a
real operator box it does, via the ambient `gh` token — it can push directly with
`git`/`gh` and the session/note/rebase gate never runs. This is the "agent pushes
around the broker" hole, and it defeats the gate even for a **non-malicious**
agent that runs `git`/`gh` out of habit. **Until Layer 3 removes every other
working credential from the agent's reach, the broker gate is
advisory-by-convenience: it binds only agents that have no other credential —
which on a real box, they do.** Branch protection remains a true server-side wall
against direct/force/delete to the protected refs regardless; the *gate* is what
is conditional.

### Layer 2 — Credential broker for API keys (composes with ADR-0050)

The agent's environment holds **no raw API secret**. ADR-0050 phase 1
(`lib/coast-guard.ts` → `scrubRawSecretsFromEnv()`) already ships: it strips
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, and all
dotenv-sourced keys from the child environment, and the sandbox denies reads of
`.env.local`. `cat .env.local` and an `env` dump both yield nothing usable.

The remaining work is the **outbound injection + metering proxy**: a local
**certificate authority** (a CA the daemon trusts so it can terminate and
re-originate TLS) plus a **man-in-the-middle (MITM) proxy** (the daemon
intercepts the agent's HTTPS call, injects the real key into the upstream
request, and meters spend). The byte/request cap already ships
(`lib/coast-guard/egress-meter.ts` → `EgressMeter`, returning
`402 Spend Cap Exceeded`); USD-accurate metering needs the CA so the proxy can
parse provider `usage` fields. With this in place, **no API call that routes
through the proxy and trusts the injected CA is unmetered or unauthenticated** —
the key only ever exists inside the daemon's call. But a same-UID agent can still
originate its own TLS without trusting the daemon CA, hit a provider the proxy
does not intercept, or bring its own credential; **closing that is Layer 3's
forced egress (pf), not Layer 2.** Per-task **attenuated macaroon caveats**
(bearer credentials whose authority is narrowed by appended, unforgeable
caveats — see the `pd-relay-zero-trust` / `auth-chain` work) scope each task's
spend and reach for traffic that does route through the broker.

### Layer 3 — Separate-UID / VM + forced egress (true sandbox compulsion)

The only layer that defends against a **truly malicious same-UID agent**, and the
only layer that removes the ambient `gh`/keychain credential from the agent's
reach. This is ADR-0050 phase 4. Spawn each agent under a dedicated `pd-agent`
UID, or inside **Apple's Virtualization.framework** (a hypervisor API for running
a guest VM), so the **kernel** — not a cooperating process — denies reads of
`~/.ssh`, `.env.local`, the keychain, and the broker token. Route all egress
through the metering proxy with **pf** (`pfctl`, the macOS packet filter)
configured so that `unset HTTPS_PROXY` does nothing: the firewall, not an env
var, decides where packets go.

**Not Seatbelt.** Earlier sketches (and ADR-0037 §Layer 4) reached for macOS
**`sandbox-exec`** (Seatbelt) to confine writes. This ADR explicitly rejects it
as the *wall*: Seatbelt is `DEPRECATED` by Apple, runs the agent at the **same
UID** (so a determined process escapes), and a raw-terminal agent simply declines
to launch under it. Seatbelt is at best a defense-in-depth speed bump for
cooperating sorties, never the structural boundary — the structural write
boundary is the separate UID / VM, where the kernel owns the decision. (The
read-only-real-tree + daemon-issued-writable-worktree mechanism rides on the same
UID/VM boundary: if the only writable path is one the daemon mints, `git worktree
add` elsewhere fails and `pd worktree claim` becomes the single door.)

Only under Layer 3 is it true that **using Port Daddy is the only path to a
usable credential** — that is where the Nash-equilibrium framing in the Decision
Drivers actually holds.

**Disclosed tension:** separate-UID / VM isolation breaks the "an agent edits
your live working tree" experience that makes sorties feel native. That cost is
real and non-negotiable to hide. Layer 3 is therefore adopted **per-fleet for
low-trust sorties first**, and **last** (if ever) for the operator's own
interactive sessions, where the live-tree experience matters and the threat
model is "me."

### Compulsion glue — coordination rent generalized

The broker's gate is a generalization of ADR-0050 **phase 7** (the coordination
rent evaluator: `lib/coast-guard/compulsion.ts` → `evaluateLeaseRent()`, fed by
`lib/coast-guard/compulsion-facts.ts` → `gatherCommitsSinceLastNote()`, enforced
at commit time by `cli/commands/guard.ts`'s `requireNotePerCommit`). Phase 7
already blocks a *commit* that owes a coordination note. This ADR extends the
same rule to the *credential*: the broker (push token in Layer 1, API key in
Layer 2) acts **only for a coordinating session** — session active, claims held,
a note per commit, branch rebased — encoded as the macaroon's rent-paid discharge
condition above. That makes coordination the dominant strategy **for any agent
whose only usable credential is the broker's** — i.e. an agent under Layer 3.
Until then it shapes behavior for cooperating agents and logs the rest; it is not
yet a Nash equilibrium for an agent holding an ambient credential.

#### Mechanical vs. semantic good faith — be honest about the seam

The discharge condition can only hard-gate **mechanical** good faith: a note
*exists*, messages were *fetched*, scope was *claimed*, the branch *is* rebased.
These are binary, forgery-resistant, and belong in the macaroon caveat. It
**cannot** hard-gate **semantic** good faith — that the note is *meaningful* or
the agent actually *read* the messages. Trying to hard-gate semantics trains
agents to emit a one-word note to clear the check (**Goodhart's law** — a measure
that becomes a target stops measuring). And per the standing rule, the meaning of
free text is **never** decided by keyword/substring matching. The split:

- **Mechanical → hard gate.** A binary broker precondition baked into the
  rent-paid discharge. No discharge, no capability.
- **Semantic → scored, feeds reputation.** A ~$0.001 Haiku call judges note/ack
  quality (not a keyword check); the score updates the session's standing in the
  **reputation estimator** (`paper/identity-reputation`, the L3 identity→reputation
  bridge — Elo / Bradley–Terry / TrueSkill over outcomes, de-biased LLM-as-judge).
  Reputation then gates *future* grant **cost**, not the current binary check:
  high standing → fast, cheap, long-TTL discharges; low standing → more scrutiny,
  shorter TTLs, or denial. This is where "in good faith" actually lives, because
  it is the only place bad faith can be **priced** without being forgeable.

## Considered Options

### A. Stay advisory; harden the in-band shim — rejected

Keep enforcement in the shim and close the holes: implement `PD_SHIM_STRICT=1`
(fanotify/DTrace) so absolute-path `git` is caught, drop the bypass line,
intercept more verbs. **Rejected** because it is an arms race the defender loses
by construction. The shim runs as the agent; a same-UID process can always reach
`libgit2`, write `.git` directly, replace the shimmed `git` on its own `PATH`, or
push with the ambient `gh` credential. Closing four holes leaves the fifth, and
the operator explicitly does not want escape-by-env-var to be possible. Hardening
raises the nuisance bar without moving the trust boundary, so a determined or
merely confused process still gets through. This option is retained only in the
*loud tripwire* role, not as the wall.

> One free win is split out of this option and promoted ahead of everything else:
> removing the `PD_SHIM_OFF=1` line from the shim's *agent-facing* refusal copy
> (a guardrail must never advertise its own bypass). That is a one-line,
> dependency-free change and ships as Phase 0b below — it does not wait on the
> broker.

### B. Per-harness hooks (Claude Code / Cursor / VSCode plugins) — rejected

Install enforcement as a hook inside each agent harness — a Claude Code
pre-tool-use hook, a Cursor extension, a VSCode git interceptor. **Rejected** on
two grounds. First, coverage: it is per-harness and per-version, so every new
tool or update is a fresh hole, and a harness that calls git via in-process
bindings (the case ADR-0040 flags) is unhookable. Second, it is still in-band —
the hook runs as the agent and inherits the same env the agent controls, so it
inherits exactly the bypasses of Option A. It multiplies the maintenance surface
without changing the boundary.

### C. Out-of-band trust boundary in three layers — **chosen**

Move the boundary off the agent's process: a remote server (Layer 1 branch
protection), a broker process holding credentials the agent never sees (Layers 1
and 2, once App-token egress lands), and ultimately the kernel (Layer 3
separate-UID / VM + pf). Keep the shim and guard as the audit tripwire. **Chosen**
because it is the only model where, *at Layer 3*, an env-var or absolute-path
escape changes nothing; it ships highest-leverage-first; and it is honest about
the threats each layer does and does not address — in particular that only Layer
3 closes the truly-malicious same-UID case and removes the ambient credential.

## Implementation Matrix

Per ADR-0043, each phase is a roadmap-linked node in a build DAG. The `Status`
column is the last-known value; once `pd adr sync` / `pd adr matrix` ships
(ADR-0043 lists `pd adr matrix` as `now`, i.e. not yet confirmed shipped), it
will override this column from `roadmap_items` via `GET /adr/:n/matrix`. Slugs
are the contract — do not rename mid-stream. Each row is its own PR.

**Re-sequenced 2026-06-12** after the `port-daddy:enforcement:dom-daddy-design-sync`
review: the **macaroon-discharge gate is the new Phase 1** (it delivers the wall
property without waiting on App-token egress), the App token (formerly the
gating prerequisite, `adr-0053-layer-0-github-app-egress-auth`) **demotes to a
confinement upgrade**, and the caveat schema is its own artifact row. The old
`adr-0053-layer-1a-push-gate` slug is **subsumed** by `adr-0053-macaroon-discharge-gate`.

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0b | adr-0053-tripwire-bypass-line-removal | merge | — | **Shipped in PR #367 (open, green, pending merge).** Removed the `PD_SHIM_OFF=1` advertisement from `cli/utils/git-shim.ts` agent-facing stderr; override still works + still audited; bumped `SHIM_VERSION` 3→4 + regression test. A guardrail must not advertise its bypass. |
| 1-schema | adr-0053-macaroon-caveat-schema | merge | — | **Drafted in Appendix A of this PR (#366).** The caveat schema: macaroon structure, first-party attenuation grammar, the third-party "rent-paid for session S" discharge protocol (reuses `evaluateLeaseRent`), TTL + renewal + revocation. Authored in **Appendix A** by `port-daddy:dom-daddy-enforcement` after the original owner (`…:dom-daddy-design-sync`) went offline. Design text in this ADR — not a new ADR. Unblocks Phase 1. |
| 1 | adr-0053-macaroon-discharge-gate | now | adr-0053-macaroon-caveat-schema | **The crypto gate (new highest-leverage rail).** Push/key grant = a macaroon whose third-party caveat is "PD daemon attests rent-paid for session S" (session + claims + note-per-commit + rebased). The daemon/Relay (`apps/relay`, ADR-0049) rejects any push lacking a valid discharge. Reuses **already-built** `feat/cap-attenuation-monitor` (CAP_ESCALATION no-broadening); the discharge construction is machine-checked in `analyses/macaroon_discharge_v1.pv` (Q1 unforgeability+binding `true`), with the card branch `defense/anchor-attenuation-soundness` carrying the analogous per-hop result for Ed25519 cards. **Wall property holds even while the push still flows through the operator's `gh` token** — corrective-only refusal copy, never names a bypass. Subsumes the old `layer-1a-push-gate`. |
| 1-bp | adr-0053-branch-protection-app-only-push | now | — | **Operator-gated.** Server-side GitHub branch protection on `main`/release glob (no direct push/force/delete, required PR + checks) + null `credential.helper` (empty `helper =` reset line) on agent repo-local config. Independent server-side wall for the protected refs. **Outward-facing settings change that can disrupt the auto-merge bots — needs explicit operator go.** |
| 0a | adr-0053-github-app-egress-auth | backlog | adr-0053-macaroon-discharge-gate | **Demoted from prerequisite to confinement upgrade.** GitHub App **egress** auth: App registration, private-key storage, `@octokit/auth-app` `createAppAuth` + installation-token exchange (the "sibling work in flight" `lib/fleet/github-output.ts` references). **No longer a prerequisite** — it upgrades the Phase-1 gate from gates+audits to true credential **confinement** ("a token the agent never sees"). NOT yet built; webhook ingress only today. |
| 1b | adr-0053-tripwire-demotion | backlog | adr-0053-macaroon-discharge-gate | Demote `cli/utils/git-shim.ts` from wall to tripwire: keep audit to `activity_log` + `~/.port-daddy/destructive-ops.log`. (Bypass-line removal already shipped in 0b.) |
| 2 | adr-0053-layer-2-credential-broker | backlog | adr-0053-macaroon-discharge-gate | **Partially shipped** (`scrubRawSecretsFromEnv()`). API-key broker — the **same macaroon** as Phase 1, second resource. `scrubRawSecretsFromEnv()` (ADR-0050 phase 1) ships; remaining work is local CA + MITM proxy injecting keys + USD metering on `lib/coast-guard/egress-meter.ts`. Meters only proxy-routed, CA-trusting traffic. Composes with ADR-0050 phases 1–2. |
| 2-rep | adr-0053-semantic-reputation-scoring | backlog | adr-0053-layer-2-credential-broker | The semantic-good-faith layer: a ~$0.001 Haiku judge scores note/ack quality (never keyword-based) → **reputation estimator** (`paper/identity-reputation`). Reputation gates future grant **cost** (TTL/scrutiny/denial), not the binary discharge. Where bad faith gets priced. |
| 3 | adr-0053-layer-3-separate-uid-vm-egress | backlog | adr-0053-layer-2-credential-broker | Separate `pd-agent` UID or Virtualization.framework guest; kernel-denied reads of `~/.ssh`/`.env.local`/keychain/broker token; pf forced egress; RO real tree + daemon-issued writable worktree (single door). ADR-0050 phase 4. **NOT Seatbelt** (deprecated, same-UID, escapable). Removes ambient credential; defends truly-malicious same-UID; trades away live-tree editing. |
| 3a | adr-0053-layer-3a-per-fleet-adoption | backlog | adr-0053-layer-3-separate-uid-vm-egress | Per-fleet opt-in: Layer 3 for low-trust sorties first; operator interactive sessions last. Live-tree-tension UX disclosure surfaced in `pd status` / fleet config. |

## Consequences

### Positive

- **Direct/force/delete to protected refs stops working** via GitHub's server-
  side ruleset — independent of any env var on the agent's box. This holds for
  the literal protected refs (`main`, the release glob) only.
- **Highest-leverage incident classes close first**, in days, for the common
  accidental and confused-deputy cases: the `main`-branch clobber, force-push to
  a protected ref, protected-branch deletion. Spend and key-exfil classes close
  as Layers 2–3 land.
- **The audit surface improves, not regresses.** The shim/guard keep logging
  every attempt; the operator now sees escape *attempts* that previously
  succeeded silently.
- **Compulsion becomes incentive-compatible at Layer 3.** Once the broker is the
  agent's only usable credential, coordinating is the dominant strategy. Before
  Layer 3 the gate shapes cooperating agents and logs the rest.
- **Composes with shipped work.** Layer 2 sits directly on ADR-0050 phases 1–2;
  Layer 3 *is* ADR-0050 phase 4; the gate reuses ADR-0050 phase 7.

### Negative

- **Layer 3 breaks the live-tree experience.** Separate-UID / VM isolation means
  the agent no longer edits the operator's working checkout in place. This is the
  central cost and is disclosed, not hidden; mitigated by per-fleet, low-trust-
  first adoption.
- **The gate is a wall before App-token egress; it is not yet *confinement*.**
  The macaroon-discharge gate (Phase 1) refuses any push without a valid
  rent-paid discharge *today*, even while the push still flows through the
  operator's ambient `gh` token — so the *gate* property arrives early. But until
  Phase 0a (App installation token) lands, the broker still pushes with a
  credential the agent can also reach, so it offers gating + audit, **not credential
  confinement**. Calling the early gate "confinement" would overclaim; calling it
  merely advisory would underclaim. It is an unforgeable gate over a
  non-confined credential.
- **Operational surface grows.** Branch protection rules, a null credential
  helper, a push broker route, a local CA + MITM proxy, and (Layer 3) UID/VM
  provisioning are all new things to install, rotate, and debug. The CA in
  particular is a trust anchor on the operator's machine.
- **A broker outage blocks pushes.** If the daemon or its token is unavailable,
  `pd push` cannot complete. This must degrade to a clear corrective message, not
  a silent failure or a fallback that reintroduces a raw credential.

### Neutral

- The shim and guard are retained verbatim in their interception logic; only
  their *role* (wall → tripwire) changes, and the bypass line is removed from
  agent-facing copy (Phase 0b).
- Read-only and flow-control git verbs continue to pass through untouched, as
  today.

### Honesty / threat-model split

State plainly, in this ADR and in all shipped copy:

- **What Layers 1–2 actually defeat:** the common, painful, *accidental* cases —
  the runaway-spend agent (once metered), the accidental key exfil (once the env
  is scrubbed and proxied), the confused deputy, and direct/force/delete to the
  protected refs. These are accidents and misconfiguration, and against the large
  majority of real incidents the out-of-band boundary is a genuine wall for the
  refs and traffic it covers.
- **What Layers 1–2 do NOT defend against:** a truly malicious same-UID agent,
  and a merely-confused one that uses an ambient credential. A process running as
  the operator's user can read the `gh` keyring token, call `gh`/`git` directly,
  push around the broker, originate its own TLS, force-push or delete any
  *unprotected* ref, and read whatever the kernel lets that UID read. The broker
  withholds the *broker-held* credential; it does not remove the ambient one.
- **Only Layer 3 (separate UID / VM + pf forced egress) raises the boundary to
  the kernel,** removes the ambient credential, forces all egress through the
  meter, and defends the malicious same-UID case.
- **Never sell Layers 1–2 as defense against a hostile process.** Doing so is
  bookkeeping sold as a vault. Layers 1–2 are an excellent seatbelt and a loud
  alarm for the common case; they are not a safe. Marketing, refusal copy, and
  operator-facing status must keep that line bright. No precise "% of harm
  defended" figure should be claimed without incident data behind it.

## Appendix A — Macaroon caveat schema (Phase 1-schema artifact)

> Authored here by `port-daddy:dom-daddy-enforcement` after the original owner
> (`port-daddy:enforcement:dom-daddy-design-sync`) went offline. This is the
> `adr-0053-macaroon-caveat-schema` matrix row, landed as ADR text rather than a
> separate ADR. A **macaroon** (Birgisson et al., 2014) is the grant object for
> both the Layer 1 push capability and the Layer 2 API-key capability.

### A.1 Macaroon structure

```
Macaroon {
  location:   "pd://daemon/<repo-id>"        // hint: who minted it / who to ask
  identifier: "<grant-uuid>"                  // opaque; maps to a root key in the daemon
  caveats:    [ Caveat, ... ]                 // ordered; each HMAC-chained to the last
  signature:  HMAC(prev_sig, caveat_bytes)    // standard macaroon chained MAC
}
```

The **root key** for `identifier` never leaves the daemon (Layer 1) or the Relay
(cross-machine). The agent holds the macaroon, not the root key — so it can
**verify-by-presenting** but cannot mint or re-sign.

### A.2 First-party caveats — the attenuation grammar

First-party caveats are predicates the verifier checks locally. The holder may
**append** any of these (narrowing); it can never remove one (the chained
signature breaks). One-directional narrowing is enforced today by
`feat/cap-attenuation-monitor`'s `CAP_ESCALATION` check.

| Caveat | Grammar | Example |
|---|---|---|
| operation | `op = push \| api-call` | `op = push` |
| repo | `repo = <repo-id>` | `repo = curiositech/port-daddy` |
| branch | `branch = <glob>` | `branch = feat/dom-daddy-*` |
| protected-ref deny | `branch != main` (implicit; root mints it) | — |
| host (Layer 2) | `host = <fqdn>` | `host = api.anthropic.com` |
| spend ceiling (Layer 2) | `spend_usd <= <n>` | `spend_usd <= 2.00` |
| expiry | `expires = <unix-ms>` | `expires = 1786000000000` |
| session bind | `session = <session-id>` | `session = session-…` |

The root daemon always appends the non-negotiable caveats (`repo`, protected-ref
deny, a hard `expires`); the agent may attenuate further (one branch, lower
spend, sooner expiry) for a sub-task or a sub-delegated agent.

### A.3 The third-party caveat — rent-paid discharge

Exactly one third-party caveat carries the compulsion:

```
third_party_caveat {
  location:    "pd://daemon/rent"            // where to get the discharge
  caveat_id:   enc(root_key_cid, { session, nonce, predicate: "rent-paid" })
  vid:         // verification id binding the discharge key into the chain
}
```

To use the macaroon the agent must present a **discharge macaroon** proving the
daemon attested rent-paid for `session`. Discharge protocol:

1. Agent calls `pd discharge --session S` (or the Relay endpoint).
2. The daemon evaluates the rent predicate using the **already-shipped**
   `evaluateLeaseRent()` (`lib/coast-guard/compulsion.ts`, ADR-0050 phase 7) over
   facts from `compulsion-facts.ts`: **session active**, **scope claimed for the
   touched paths**, **a note per commit being pushed**, **branch rebased on the
   canonical head**. All four must hold (mechanical good faith — §"Mechanical vs.
   semantic").
3. If they hold, the daemon mints a discharge macaroon bound to `nonce`, with its
   own short `expires` (default **20 min**, matching the rent TTL).
4. The Relay (ADR-0049) verifies: root signature valid → every first-party caveat
   satisfied → a valid, unexpired discharge for the third-party caveat. The
   discharge construction's unforgeability + request-binding (Q1) is **proven in
   ProVerif** in `analyses/macaroon_discharge_v1.pv`; the analogous per-hop-vs-naive
   result on the Ed25519 *card* construction lives on
   `defense/anchor-attenuation-soundness`. The per-hop-vs-naive regression for the
   macaroon chain (Q2) is proven in `analyses/macaroon_discharge_v2_naive_unsound.pv`
   (the naive verifier is unsound under cross-grant replay). Residual gap: first-party
   caveat soundness + the MAX_DISCHARGE_DEPTH bound.

### A.4 TTL, renewal, and revocation

- The **grant** macaroon may be long-lived (a session); the **discharge** is
  short (≈20 min) and must be re-fetched. This is the decay loop: rent lapses →
  no fresh discharge → the capability is dead within one TTL **without revoking
  anything** (the absence of a renewal *is* the revocation).
- Hard revocation (compromise) bumps the daemon-side root key for `identifier`,
  invalidating every macaroon derived from it immediately.
- Renewal is not automatic: each re-discharge re-runs the rent check, so an agent
  that stops coordinating stops being able to push within one window — the
  Nash-equilibrium property, realized cryptographically rather than by a hook.

### A.5 What this schema does NOT do

It does not confine a malicious same-UID process: between fetching a discharge
and using it, the agent holds a valid capability it could copy or use directly.
The macaroon makes the gate **unforgeable** and the audit a **verifiable
transcript**; **only Layer 3 (separate-UID/VM) confines the holder.** Stated here
so the schema is never mistaken for the vault.

## Hook-bypass auditor — the binary-agnostic wall, enforced in CI (pd-spark)

The distinction this ADR draws between the **shim** (in-band advisory tripwire,
bypassable-but-audited) and a **git hook** (the binary-agnostic wall git runs
regardless of which `git` binary called it) is only load-bearing if hooks
actually hold the line. A hook that honors an in-band environment variable is
not a wall — it hands the agent a free, self-minted escape, which is precisely
the failure mode ADR-0102 ("no agent-mintable git escape") names.

`scripts/audit-hook-bypass.mjs` is a standing auditor for that class. It scans:

- **installed hooks** — `<git-common-dir>/hooks/*` (skipping git's `*.sample`
  examples and our `*.pd-bak.*` backups); and
- **tracked source** — the hook/shim *installers* and embedded templates under
  `scripts/` and `cli/` (`install-pre-push-hook.sh`, `cli/commands/guard.ts`,
  `cli/commands/init.ts`, `cli/utils/git-shim.ts`, …).

It flags the **structural** stand-down shape, not a keyword list: an env-var
guard (`[ "${VAR:-}" = "1" ]`, `[ -n "$VAR" ]`) whose block neutralizes
enforcement via `exit 0` or `exec <real-binary>` before its `fi`. Quality/UX
gates that merely advertise a flag and then `exit 1` (the README-freshness
`PD_README_OK` message, whose env check lives in a node script, not the hook
body) do **not** match. The git shim's `PD_SHIM_OFF` is the one allowlisted
entry — structured, commented, and ADR-referenced — because the shim is the
PATH-wrapper binary, not a hook, and its bypass is deliberate **and audited**
(it appends to `~/.port-daddy/destructive-ops.log` before exec-ing real git).
A hook bypass is never allowlisted.

Findings print `file:line`, the offending env var, the matched shape, and why
it is unsafe; the auditor exits non-zero on any non-allowlisted finding so it
gates CI. Tests live in `tests/unit/audit-hook-bypass.test.js` (synthetic
bypass flagged, clean hook passes, real tree passes as a regression).

**First catch.** Running it surfaced that the generated **pre-push hook** in
`scripts/install-pre-push-hook.sh` honored `PD_SHIM_OFF=1 -> exit 0` —
silently, and in direct contradiction of its own header ("this hook survives
PD_SHIM_OFF=1 because git always runs pre-push hooks"). Setting one env var
therefore disabled *both* defense layers at once. The stand-down and its
bypass-advertising refusal copy were removed (aligning the code with its header
and this ADR's Phase 0b "a guardrail must not advertise its bypass" rule);
git's native `--no-verify` remains the sole, visible, non-mintable skip.

**CI wiring.** Add a required check that runs the auditor from the repo root:

```yaml
# .github/workflows/ci.yml (job step)
- name: Hook bypass wall (ADR-0053)
  run: node scripts/audit-hook-bypass.mjs
```

Locally it is also a natural pre-commit gate; keep it in the versioned
`hooks/pre-commit` alongside the README-freshness and skill-hygiene guards.

## Composes with

- **ADR-0037** (`docs/adr/0037-git-access-control-and-pd-feature-verbs.md`) — the
  git-verb access-control model and the destructive-verb taxonomy the shim
  intercepts. This ADR keeps that taxonomy as the tripwire's detection set.
- **ADR-0040** (`docs/adr/0040-pd-encompassing-shell.md`) — documents the
  absolute-path and in-process-binding escapes (lines 183–187) and the
  unimplemented `PD_SHIM_STRICT`. This ADR accepts those escapes as unwinnable
  in-band and routes around them out-of-band.
- **ADR-0047** (`docs/adr/0047-harbor-envelope-enforcement.md`) — *Harbor Envelope
  Enforcement, the advisory→fail-closed boundary* this ADR supersedes for the
  "wall" role while preserving for the "tripwire" role. (Note: ADR number 0047 is
  duplicated on disk — `docs/adr/0047-conversation-protocol.md` also exists; the
  enforcement-posture dependency is the Harbor Envelope file specifically.)
- **ADR-0050** (`docs/adr/0050-coast-guard.md`) — *The Coast Guard: agentic
  safety on the operator's machine* (sandbox + secret broker + metering plane),
  the load-bearing dependency. Layer 2 builds on **phase 1**
  (`scrubRawSecretsFromEnv`, shipped) and **phase 2** (`EgressMeter`, byte/request
  cap shipped; USD-MITM pending); Layer 3 **is** **phase 4** (separate-UID / VM +
  pf forced egress, backlog); the broker gate generalizes **phase 7**
  (coordination rent — `evaluateLeaseRent`, note-per-commit enforcement shipped
  via `cli/commands/guard.ts`).
- **ADR-0049** (`docs/adr/0049-relay-architecture.md`) — the Relay
  (`apps/relay`, shipped + ProVerif-modeled) is the zero-trust capability
  verifier the Phase-1 macaroon discharge rides on; the gate is "Relay rejects a
  push whose macaroon lacks a valid rent-paid discharge."
- **Built prior art (unmerged branches) the matrix reuses rather than rebuilds:**
  `feat/cap-attenuation-monitor` (pure-TS `CAP_ESCALATION` no-broadening monitor —
  the macaroon attenuation enforcement); `defense/anchor-attenuation-soundness`
  (**per-hop** attenuation **proven in ProVerif** for the Ed25519 *card*
  construction — the naive final-vs-root verifier was unsound). The macaroon
  discharge construction itself is separately proven in
  `analyses/macaroon_discharge_v1.pv` (Q1 unforgeability + request-binding `true`) and
  `analyses/macaroon_discharge_v2_naive_unsound.pv` (Q2: the naive verifier is unsound
  under cross-grant replay, `false`/attack-found).
  `verify-claim-signaling-tla` (TLA+ claim-signaling
  model); `paper/identity-reputation` (the *From Spawn to Person* reputation
  estimator — the home of the Phase 2-rep semantic-good-faith layer);
  `docs/coordination-cookbook` (the topology/pattern catalog the coordinated
  agents follow). These mean Phases 1, 2-rep, and 3 are substantially **assembly,
  not greenfield**.
