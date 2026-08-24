# ADR-0122: Harbor Authority

- **Status:** Accepted
- **Date:** 2026-08-16
- **Demanded by:** binder chapter 02 — "This deserves a dedicated Harbor
  Authority ADR before team/public harbors ship"
  (`docs/architecture/agent-harbor-technical-binder/02-runtime-authority-and-deployment.md`)
- **Builds on:** ADR-0013 (unified harbor model), ADR-0027 (relay harbor
  mesh), ADR-0049 (relay v0), ADR-0115 (database distribution & sync),
  ADR-0117 (fleet v2 execution economics), ADR-0120 (Rust kernel boundary)
- **Siblings (2026-08-16 shared-harbors program):** ADR-0123 (Cloud Vault /
  Account KMS), ADR-0124 (Transcript Redaction), ADR-0125 (iOS Operator
  Surface), ADR-0126 (Shared-Harbors Re-sequencing)

## Context

Port Daddy can already prove who said something. It cannot yet say who may
write the canonical harbor sequence when more than one daemon could.

What ships today, and what each piece settles:

- **ADR-0049** gives per-publisher Merkle chains and capability enforcement
  at publish. Every event is signed and chained; equivocation by the relay is
  detectable. That is *attribution*, not authority.
- **X2 v1 remote harbors** (`apps/relay/src/harbors.ts`) are deliberately
  "keypair + namespace + membership, nothing more." The header comment states
  the doctrine this ADR extends: the keypair is generated client-side, the
  relay signs nothing on a harbor's behalf — "the relay stays a phone book,
  never a key holder."
- **The HarborChannel Durable Object** (`apps/relay/src/harbor-channel.ts`)
  is the per-`(harbor, channel)` serialization point: monotonic `seq`,
  `from_seq` replay, fan-out. Its own presence roster already models the
  split this ADR generalizes — the DO records raw `last_seen` timestamps and
  "does NOT decide who is online"; the policy verdict lives in the Worker.
- **ADR-0115** gives the sync spine: per-table replication classes
  (LOCAL-ONLY / G-Set / LWW), the relay as ciphertext journal, and — in §4 —
  the co-signed `PairingReceipt` (account key + daemon key, neither alone
  authoritative) for device binding.
- **ADR-0027** rejected the multi-writer daemon mesh in favor of event
  federation. That settled *transport*. It left open who orders a shared
  harbor's coordination stream when the harbor has many members.

Binder chapter 02 states the local rule — the local daemon is authoritative
for a local harbor — and then enumerates what a harbor authority protocol
needs (`harbor_id`, authority epoch, writer lease, event sequence, causal
parents, revocation list, per-artifact ACLs, retention policy, control
command ack/failure records) before demanding this ADR. Binder chapter 21
left open question 5: whether a relay-buffered trigger firing may *start* a
run remotely while the owner's laptop sleeps, or may only queue it.

Two doctrines constrain every answer here. The two-plane doctrine
(`docs/proposals/relay-grand-plan.md` §5.1) forbids migrating
discovery-plane promises onto fabric-plane convenience. And the "Trusted
Sequencer for Merkle Order" anti-pattern
(`skills/pd-relay-zero-trust/SKILL.md`) names the failure this ADR must
close: centralized sequencers are operationally seductive, and the reflex to
make the relay the trust root must be resisted in writing, as a rule, not
case by case.

These decisions were settled by the operator in the 2026-08-16 shared-harbors
program review.

## Decision

### 1. Exactly one authoritative writer per harbor

Per harbor, at any moment, exactly one daemon holds the writer lease and owns
the harbor's state.

- **Local harbor → the local daemon.** Binder chapter 02's authority rule,
  restated normatively. Clients (app, CLI, FleetBar, mobile, MCP, web) cache,
  display, and request; the daemon owns.
- **Hosted remote node → the remote harbor is authoritative for that node,
  only while it runs.** It streams events back to the user's local or
  account harbor (binder ch02's hosted-remote-session mode). When the run
  ends, authority for that node's record returns home; the streamed events
  are the record.

Every other member — colleague daemon, phone, CI publisher, remote body —
may propose or stream events, but the authority orders them into the
canonical sequence. There is no co-writing and no election; a writer-lease
handoff is an explicit, signed, epoch-bumping act.

### 2. The authority record (normative)

Every harbor carries exactly one authority record. Its fields are binder
chapter 02's list, made normative:

- **`harbor_id`** — the harbor's stable identity (locally the harbor row,
  remotely the X2 `namespace/name` + pubkey).
- **`authority_epoch`** — a monotonically increasing integer. Any membership
  or device change bumps it (see §4).
- **`writer_lease`** — the current holder's daemon fingerprint, granted-at,
  and expires-at, signed by the outgoing authority (or, at harbor creation,
  by the harbor key). An expired lease means no writer, not an implicit one.
- **`event_seq`** — the canonical, gapless sequence number the writer
  assigns to each ordered event within the current epoch.
- **`causal_parents`** — the event ids an entry depends on, so a proposed
  event from a remote body can be ordered after what it actually saw.
- **`revocation_list`** — revoked devices and cards with `revoked_at`,
  mirroring ADR-0049's revocations and ADR-0115's receiver rule.
- **`artifact_acls`** — per-artifact access grants (who may read a
  transcript, take an artifact, issue a control command against a node).
- **`retention_policy`** — the harbor's retention terms, per member where
  members differ (see §8).
- **`control_commands`** — every control command issued against the harbor,
  each carrying the epoch it was authorized under and its terminal ack or
  failure record (see §5).

The record lives with the authority — in the owning daemon's ledger for a
local harbor, in the remote harbor for a hosted node while it runs — and is
streamed to the relay as signed events like everything else.

### 3. The relay is an ordering mirror, never a co-writer

The HarborChannel Durable Object mirrors the authority's stream and persists
it durably. Its transport `seq` remains what ADR-0115 §3 says it is —
"liveness/cursor convenience, not safety" — a replay cursor, never a claim
of authority. The relay:

- holds no writer lease and can never grant one;
- signs no epoch and no authority-record field;
- holds no harbor key ("phone book, never a key holder,"
  `apps/relay/src/harbors.ts` — extended here from keys to authority);
- cannot promote, admit, or revoke a member — it only broadcasts the
  authority's signed revocations (ADR-0049 `/v1/revoke`, ≤5s SLO).

Any relay code path that writes a lease, epoch, or ACL field is a defect,
the same class as a code path that decrypts payloads (invariant I1). This is
the Trusted Sequencer anti-pattern closed as a standing rule.

### 4. Authority epochs, and visible failure

The `authority_epoch` bumps on **any** membership or device change: member
added, member removed, device paired, device revoked, writer-lease handoff.
This aligns with X2's existing epoch boundary — member removal already
triggers forward channel-key rotation at the next epoch
(`docs/proposals/relay-grand-plan.md` §X2) — so key rotation and authority
rotation share one clock.

Every control command carries the epoch it was authorized under. On receipt
the authority checks the command's epoch and the issuing device against the
current revocation list:

- command from a revoked device → **fails visibly** with a recorded reason;
- command carrying a stale epoch → **fails visibly** with a recorded reason;
- in neither case is the command silently dropped, silently downgraded, or
  silently retried under the new epoch.

This is the command-plane twin of ADR-0115's data-plane receiver rule
("reject events from revoked fingerprint with `iat > revoked_at`").

### 5. Queued commands terminate in ack or failure — no third state

Mobile and offline-issued commands (binder ch02: "mobile commands are queued
with expiry and must receive ack/failure") queue with an explicit expiry and
must reach exactly one terminal state: acknowledged, or failed with a
recorded reason. Expiry without delivery is a failure record, not silence.

The binder's remote interrupt race test is the acceptance gate for this
section: start a remote Agent Node, issue a mobile interrupt, revoke the
issuing device before ack. The command must either have been acknowledged
before the revocation, or fail with a recorded reason naming the revocation.
Revoke-before-ack **must** fail, and the failure record is part of the
authority record's `control_commands` — no silent half-control state.

### 6. Relay-buffered trigger firings are queue-only in Phase 1

This resolves binder chapter 21's open question 5. A trigger firing that
lands on the relay while the owning daemon is unreachable (email, webhook,
cron — the wake sources of binder ch02) **queues a Work Intent for the
owning local daemon. It never starts a run remotely.** The daemon, on
reconnect, passes the dequeued firing through the same fail-closed
provenance trust gate as any live wake (ADR-0093) before materializing
anything.

Remote-start is deferred, deliberately, to the Phase-2 Cloudflare Sandbox
bodies lane: ADR-0117 already priced that substrate and concluded that
Sandbox/Container cost makes remote execution a paid, deliberate lane — not
a free side effect of a webhook arriving while a laptop sleeps. A firing
that would need remote-start today fails into the queue with that reason
recorded. ADR-0126 sequences when the Phase-2 lane opens.

### 7. Shared-harbor join tiebreak: the co-signed PairingReceipt

When shared-harbor admission must decide whether a device speaks for an
account — two devices contending for the same membership, a re-pairing
after device loss, a writer-lease handoff candidate — the tiebreak is
ADR-0115 §4's `PairingReceipt`: co-signed by the account key **and** the
daemon key, neither alone authoritative. A daemon key without an account
countersignature is a device nobody vouched for; an account signature
without a daemon key is a login, not a machine. A device without a valid
receipt cannot enter the lease rotation, whatever its card says.

### 8. Retention conflicts resolve to the stricter policy

For shared artifacts, when members' retention policies conflict, the
stricter policy wins — unless the artifact owner explicitly exports the
artifact or transfers ownership (binder ch02's rule, adopted verbatim). A
guest's 7-day policy on a transcript they appear in beats the host's 90-day
default; the host who wants to keep it must export under their own name,
leaving an ACL-visible record, not a quiet retention override.

### Where enforcement lives

Local enforcement direction is ADR-0087's separate-UID Rust broker: the
process that holds keys and verdicts is not the process agents can reach.
The authority-critical crypto — lease signatures, epoch attestation,
revocation checks, receipt co-signature verification — lives in the Rust
kernel per ADR-0120 (one canonical implementation, plane 1). TypeScript
surfaces read verdicts; they do not reimplement them.

### What this ADR does not change

ADR-0115's replication classes stand untouched: LOCAL-ONLY never syncs,
G-Set unions, LWW folds, and those merges remain order-insensitive for
correctness. The writer lease governs the class of state where
*who-ordered-it is the point* — control commands, membership, ACLs,
retention, canonical transcript order — not the CRDT-mergeable table rows.
And no consensus protocol is introduced: a lease with epochs is a
single-writer handoff, not Raft. The Part XVII trap (ADR-0027, ADR-0049
non-goals) stays closed.

## Consequences

- Binder chapter 02's demand line is discharged: team and public harbors
  now have their authority prerequisite on paper. ADR-0126 owns sequencing
  the build; nothing in the shared-harbors lane may ship ahead of the
  pieces this ADR makes normative.
- Every control command has a terminal record, so operator surfaces
  (pd-console, FleetBar, the ADR-0125 iOS surface) can always render a
  command's true state — queued, acked, failed-with-reason — instead of
  inferring it. The interrupt race test in §5 becomes a required test in
  the shared-harbors suite, not a suggestion.
- Epoch bumps on every membership and device change mean churn in large
  harbors. Acceptable: epochs are integers, and X2's key rotation already
  pays the real cost at exactly the same boundary, so the two share a
  clock instead of inventing two.
- Queue-only trigger firings mean a sleeping laptop delays automation.
  That is the honest Phase-1 behavior and must be stated in the trigger
  UI, rather than surprising the operator with a remote body they never
  priced. The pressure to "just run it in the cloud" now has a named,
  gated exit: the Phase-2 Sandbox lane, on ADR-0117's economics.
- Visible failure of revoked/stale commands depends on revocation actually
  propagating. ADR-0049 committed to a ≤5s broadcast SLO that (per the
  grand plan's ground truth) nothing yet measures; measuring it becomes a
  shipping prerequisite for shared harbors.
- The relay's D1/DO now mirror authority records they must never author.
  That asymmetry is a review rule: any `apps/relay` diff that writes
  lease, epoch, ACL, or retention fields is rejected on sight, the same
  way a payload-decrypting diff would be.
- Hosted remote nodes carrying temporary authority means the UI obligation
  from binder ch02 is load-bearing: every Agent Node card must say which
  harbor owns it right now. "Cloud agent" may never mean "mysterious thing
  somewhere."

## Cross-references

- `docs/architecture/agent-harbor-technical-binder/02-runtime-authority-and-deployment.md`
  — the authority rule, the protocol field list, deployment modes, remote
  sessions, wake sources, and the interrupt race test this ADR makes
  normative.
- `docs/architecture/agent-harbor-technical-binder/21-automations.md` —
  open question 5, resolved by §6.
- `docs/proposals/relay-grand-plan.md` — §5.1 two-plane doctrine; §X2
  remote harbors and epoch-bound key rotation; §X3 relay-orders /
  daemon-enforces boundary.
- `docs/adr/0013-unified-harbor-model.md` — the harbor as the unit of
  scope and security.
- `docs/adr/0027-relay-harbor-mesh.md` — event federation over state
  replication; daemons stay authoritative for their own state.
- `docs/adr/0049-relay-architecture.md` — per-publisher chains, publish
  path enforcement, revocation broadcast and SLO.
- `docs/adr/0087-trusted-computing-base-broker.md` — the separate-UID Rust
  broker as the local enforcement direction.
- `docs/adr/0093-event-spawn-trust-substrate.md` — the fail-closed wake
  trust gate dequeued firings pass through (§6).
- `docs/adr/0115-database-distribution-and-sync.md` — replication classes,
  the DO seq as cursor-not-safety, and the co-signed PairingReceipt (§7).
- `docs/adr/0117-fleet-v2-execution-adversarial-testing-ai-gateway.md` —
  Sandbox economics behind the Phase-1 queue-only rule (§6).
- `docs/adr/0120-rust-kernel-boundary.md` — where authority-critical
  crypto lives.
- ADR-0123 (Cloud Vault / Account KMS), ADR-0124 (Transcript Redaction),
  ADR-0125 (iOS Operator Surface), ADR-0126 (Shared-Harbors
  Re-sequencing) — the sibling ADRs of the 2026-08-16 shared-harbors
  program.
- `apps/relay/src/harbors.ts`, `apps/relay/src/harbor-channel.ts` — the
  in-tree reality (X2 v1 doctrine; DO-records / Worker-decides split) this
  ADR extends rather than contradicts.
- `skills/pd-relay-zero-trust/SKILL.md` — the Trusted Sequencer
  anti-pattern §3 closes as a rule, and the invariant catalog (I1–I5)
  this ADR leaves intact.
