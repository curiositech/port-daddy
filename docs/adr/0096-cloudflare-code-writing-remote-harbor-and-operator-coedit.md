# 0096. Cloudflare Code-Writing Remote Harbor and Operator-Joinable Co-Edit

## Status

Proposed — 2026-07-06. Design-only; **nothing here is wired**. This ADR folds an
operator request ("expand the Cloudflare fleet to also write code in remote
harbors, and let these be joinable by the operator") into the Agent Harbor binder
as the *early example* of the remote-harbor / cooperative-editing thread. It is
the deferred **Harbor Authority ADR** that binder ch02 says is required "before
team/public harbors ship," scoped to the narrowest first slice that makes the
idea real. Accepted-for-implementation only when a focus receipt in binder ch18
promotes it and the F0-style contract lands.

## Context

Two facts from the shipped code set the boundary of this ADR:

1. **The Cloudflare "cloud fleet" today is a review fleet, not a coding fleet.**
   `apps/fleet-executor` mints a GitHub installation token, fetches the PR diff,
   reads ship config *from the trusted default branch only*, runs each ship on
   Workers AI, and posts review comments + a `Port Daddy Fleet` check run. It
   never clones a repo, edits a file, commits, or pushes — there is no filesystem
   write path in the worker. `apps/github-app-receiver` is the same shape.

2. **The remote-harbor substrate is designed but emerging.** Binder ch02 defines
   a **Cloudflare production lane** where "the Worker becomes a remote body whose
   events stream back to the user's local or account harbor," and sandbox
   **Level 5 = remote sandbox (Cloudflare Worker/VM/container)**. ADR-0027 (Relay
   Harbor Mesh) defines the relay-backed harbor event mesh with a two-step remote
   execution handshake (`request:send` + `request:accept` + a local policy gate).
   ADR-0090 (The Harbor) places "V4 remote harbor" on the Substrate (edge) layer
   at maturity *emerging*. Binder ch05's Harbor Editor battle plan puts remote
   harbor topology at its final step, and binder ch18 lists "Harbor Editor remote
   transport" explicitly on the **Not now** fence.

So the operator's ask sits at the intersection of three existing binder threads —
the Cloudflare-body-as-compliant-Agent-Node contract (ch03/C2/ADR-0095), the
remote-harbor authority substrate (ch02/ADR-0027/ADR-0090), and the joinable
Harbor co-edit surface (ch05/ch20/harbor-editor-battle-plan). None of the three
is wired for *code-writing* remote work today. This ADR records the design so the
idea is legible and sequenced, not silently promised on a marketing surface.

## Decision

### 1. A code-writing Cloudflare body is a remote Agent Node, not a new concept

A Cloudflare Worker (or Worker-orchestrated container/sandbox) that writes code is
an **AgentNode** whose **Body** is remote and whose **Harbor** is remote — exactly
the vocabulary already frozen in the binder README and ADR-0095. It is created by
a **WorkIntent** with a remote placement preference (binder ch02 migration table:
"cloud request: Work Intent with a remote placement preference"), materialized
through the Agent Run Saga (ADR-0095), and attached through a `cloudflare` anode
adapter. It is **not** a new launch verb, a new transcript store, or a new control
panel. The review executor stays what it is; the code-writing body is a distinct
Agent Node with Sandbox Level 5 and its own compliance probe.

Non-negotiable card fields (binder ch02 "what users should see") for such a node:
authority = the remote harbor id; body = Cloudflare; sandbox level = 5; budget +
spend + who-pays; retention; revocation control; last heartbeat + last transcript
event. A code-writing remote body with a blank authority/cost card is a
stop-rule violation, same as any other Agent Node.

### 2. Remote harbor authority — the single-writer story this ADR owns

Binder ch02 §"Harbor authority protocol" prescribes what a shared/remote harbor
needs; this ADR pins the minimum for a code-writing remote body:

- `harbor_id`, `authority_epoch`, and a **single current writer lease** per epoch.
  One authority orders the canonical event sequence for a harbor epoch; the remote
  body may *propose or stream* events, but the authority orders them.
- A **worktree binding** owned by the remote harbor: base repo + remote, base
  commit, branch, created/modified files, PR links, cleanup eligibility (binder
  ch02 worktree record). Code the remote body writes lives in that worktree, not
  the operator's main checkout.
- **Capability cards** (Harbor Cards, ADR-0094) scope what the remote body may do
  (which repo, which paths, secret grants, push vs draft-PR-only) and are
  revocable. Revocation is immediate: a revoked body cannot commit, push, or issue
  new control commands; offline commands that arrive after revocation fail
  visibly (binder ch02 remote-interrupt race test).
- Transport rides the **relay** (ADR-0027): E2E-encrypted, hash-chained,
  operator-gated harbor events. This ADR adds no new transport — it reuses the
  relay mesh and its two-step `request:accept` gate.

### 3. Operator-joinable co-edit — the early example, bounded honestly

"Joinable by the operator" is the Harbor co-edit mode (binder ch05): the operator
joins the running remote agent's **governed Loro buffer** as a co-equal peer, with
claims, semantic-conflict forecast, authorship, and salvage. Per the Harbor Editor
battle plan the honest first slice is **not** the full CRDT-over-relay stack:

- **Phase A (this ADR's first gate):** a **read-only remote mirror**. The operator
  joins and *watches* the remote body's buffer — the ch20 "Harbor remote view":
  the same buffer mirrored read-only, claims as line-range stripes, the hatched
  semantic-conflict band. No operator writes cross the wire yet. This proves
  authority, transcript streaming, claim rendering, and revocation end-to-end
  without the editable-CRDT-over-relay risk the battle plan warns against ("do not
  start with transport or 3D water").
- **Phase B (later focus receipt):** operator **write** participation — the
  operator edits in the shared Loro buffer; the daemon governs claims and refuses
  cross-claim merges; a dead remote body's op-log is salvageable by a successor.
  This is C6 (Harbor Editor) remote transport, still on the ch18 Not-now fence
  until local Agent Node governance is visibly working.

Phase A is the deliverable that makes "joinable by the operator" a true,
demonstrable early example; Phase B is named so the surface is not oversold.

### 4. What this ADR explicitly does NOT do

- Does not ship code-writing on Cloudflare (no worker filesystem/commit path).
- Does not ship editable co-edit over the relay (Phase B is deferred).
- Does not create public harbors, a marketplace, or cloud billing.
- Does not let a remote body push to a protected branch — draft PR only until a
  capability card explicitly grants push, and never to the operator's main checkout.

## Proof gates (a section is not "real" until its gate passes)

- **G1 — remote node card:** a Cloudflare code-writing Agent Node renders in
  pd-console/FleetBar with authority = remote harbor, Sandbox Level 5, budget +
  spend, retention, and a working revocation control. Survives relaunch from
  daemon truth.
- **G2 — governed worktree:** the remote body's changes land in a harbor-owned
  worktree with a full worktree record; a destructive-git attempt is blocked
  (C5 tool gate) and visible in the transcript + Work Receipt.
- **G3 — remote interrupt race:** start the remote body, issue an interrupt,
  revoke the capability card before ack; the command either fails with a recorded
  reason or is acknowledged before revocation — no silent half-control (binder
  ch02 test).
- **G4 — joinable read-only mirror (Phase A):** the operator joins the running
  remote buffer and sees live text + claims + the semantic-conflict band, sourced
  from durable events, reconnect-safe. Operator writes are disabled with an
  explicit "read-only mirror (Phase B pending)" reason, not a blank pane.
- **G5 — Work Receipt:** the run seals a nine-section Work Receipt (ADR-0095) with
  provider/body/model tier, cost, files touched, PR link, and guard denials,
  verifiable in a browser/CLI without trusting the app UI.

## Consequences

- Binder ch02 (Cloudflare production lane, remote sessions, harbor authority
  protocol) gains this ADR as its executable reference; the "dedicated Harbor
  Authority ADR" it asks for is this document.
- Binder ch05 (Harbor co-edit, Harbor Editor battle plan) gains the
  operator-joins-a-remote-cloud-agent scenario as its worked early example, with
  the read-only mirror as the first slice.
- Binder ch18 must add a focus receipt + work order (proposed name **C10 —
  Cloudflare code-writing remote body + joinable read-only co-edit**) sequenced
  after the current C-wave and after local Agent Node governance is visibly
  working; C10's editable-buffer half is C6 and stays on the Not-now fence.
- ADR-0027 (Relay Harbor Mesh) and ADR-0094 (Harbor Cards) are the transport and
  capability substrate; this ADR consumes them and does not fork them.
- No code, schema, or test ships with this ADR. It is a design fold; the teeth are
  the proof gates, which a future implementation slice must pass before any
  surface calls this "live."

## References

- Binder: `docs/architecture/agent-harbor-technical-binder/` — README, ch02
  (runtime authority & deployment), ch03 (agent contract), ch05 (cooperative
  coding), ch18 (build prescription), ch20 (design system / harbor remote view).
- ADR-0027 Relay Harbor Mesh; ADR-0090 The Harbor; ADR-0094 Harbor Cards as
  Verifiable Credentials; ADR-0095 Agent Run Saga and Backend Authority.
- `docs/strategy/harbor-editor-battle-plan.md` (Loro CRDT, phased transport).
