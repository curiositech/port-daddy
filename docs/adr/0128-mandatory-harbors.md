# ADR-0128: Should every project root have a harbor, and does that mean everything is encrypted?

- **Status:** Proposed — Context and options only. **The decision is deliberately not made here.**
- **Date:** 2026-08-22
- **Builds on:** ADR-0013 (unified harbor model — harbors key to the project
  root), ADR-0027/0049 (relay), ADR-0115 (database distribution and sync),
  ADR-0122 (harbor authority), ADR-0123 (cloud vault / account KMS)

## Why this ADR exists

The operator asked three questions when "mandatory harbors" was raised as an
option:

> *Does this mean all data encrypted? Do we or the binder or other docs or
> whitepaper have good thoughts on how to do shared remote harbors? And what
> the product experience and user value is?*

They are three separate questions with three different answers, and the first
one is the one most likely to be answered wrong by assumption. This ADR answers
all three from the corpus and then lays out the options. It does not choose.

## Question 1 — does mandatory harbors mean all data encrypted?

**No. They are orthogonal, and conflating them would overstate what ships.**

"Mandatory harbors" is a **scoping** decision: every project root gets a
coordination scope so no work is homeless. It says nothing whatsoever about
encryption.

What is encrypted **today**:

- **Session notes, at rest.** Envelope encryption — a daemon master key at
  `~/.port-daddy/master.key` (0600, never in the DB), a random per-session
  AES-256-GCM key wrapped under it and stored in
  `sessions.wrapped_session_key`, and a random 12-byte IV per note. The Merkle
  chain hashes the **ciphertext**, so integrity holds without revealing
  content. Implemented and ProVerif-verified (`docs/NOTE_ENCRYPTION_DESIGN.md`).

What is **not** encrypted:

- Everything else in local SQLite — sessions, roadmap items, claims, ports,
  locks, receipts, transcripts. Plaintext on the operator's own disk. The
  binder's local-only deployment mode says this is deliberate: *"Secrets stay
  in Keychain or local encrypted storage. Transcripts stay local unless the
  user exports them."*

And the **N1 invariant** (ADR-0123 §6) is a **transit** rule, not an at-rest
one: every relay-bound event must be AEAD-sealed or explicitly labelled
`relay_readable` with a human-readable reason. That is what PR #9219 builds. It
governs what crosses the relay; it says nothing about the local database.

So: mandatory harbors ≠ encryption. Making local state encrypted at rest is a
separate and much larger decision, and it should not be smuggled in under a
scoping change. **Anyone citing "we made harbors mandatory" as evidence that
data is encrypted would be wrong.**

## Question 2 — what does the corpus say about shared remote harbors?

It says a lot, and **the most important thing it says is an argument against
what we are currently building.** That is the part worth the operator's
attention.

### The corpus contains its own refusal

`skills/pd-relay-zero-trust/references/v4-remote-harbor-redefinition.md`
argues that Remote Harbor should be **federation of messages, not federation of
state** — a shared harbor keypair plus a relay namespace:

> **Remote Harbor (V4)**: A harbor whose membership is shared across multiple
> daemons ... and pub/sub coordination across members is provided by the PD
> Relay using harbor-fingerprint namespacing.

It is explicit about what that gives up, and does not hedge:

> **No automatic state replication.** If you delete a session on machine A, it
> still exists on machine B.

It rejected Part XVII's peer state sync as "the wrong problem", and said state
sync should be a **separate later ADR atop the relay, not instead of it**.

ADR-0115 (2026-06-23) then specified exactly the state sync that document
deferred — replication classes, HLC-LWW, G-Set union, event replay, R2
snapshots. That is WS-C in the current program.

**This is not necessarily a contradiction.** The V4 document left the door open
in as many words — *"State sync atop the relay is a coherent v1 ADR... it's
much smaller atop the relay since the transport problem is solved"* — and the
transport problem is now solved. But the current plan never says why the
earlier refusal stopped applying, and it should, because the refusal was
specific and well argued.

### What the binder requires before any of it ships

Binder ch02 is the crispest requirement in the corpus, and it is a hard gate:

> Shared, remote, and public harbors need a **single-writer story, not just
> signed events.**

with an enumerated authority record: `harbor_id`, authority epoch, current
writer lease holder, event sequence, causal parent ids, revocation list,
per-artifact ACLs, retention policy, control-command ack/failure records — and
the rules that one authority writes the canonical sequence per epoch, remote
bodies propose but the authority orders, mobile commands are queued with expiry
and must be acked, and revoked guests cannot read new transcripts. It closes:

> This deserves a dedicated Harbor Authority ADR before team/public harbors
> ship.

That ADR is ADR-0122, which is why it is a Phase-0 blocker rather than a nicety.

## Question 3 — what is the product experience and user value?

The corpus's own empirical answer, from the V4 document, is a list of what
people actually mean when they say "remote harbor":

1. *"My laptop's agent should react to events from my CI runs."*
2. *"My team should see each other's fleet in the dashboard."*
3. *"My agents should coordinate across machines."*
4. *"I want a single identity across my devices."*

And, stated just as plainly, what is **absent** from that list:

> Notably absent: "my SQLite db should replicate to my desktop." That's a niche
> feature being mistaken for the user-facing demand.

The acceptance bar is binder product test 9 — *"Share a harbor with another
user or device using explicit capabilities"* — with product test 11 as the
honesty check: *"Produce a Work Receipt ... and verify it in a browser or CLI
without trusting the app's current UI."*

Binder ch02 sets the presentation law:

> "Cloud agent" cannot mean "mysterious thing somewhere." It must show
> authority, data path, billing path, and controls.

**Mandatory harbors serves value 4 and only value 4** — one identity, one scope
per project, nothing homeless. It is a precondition for the other three, not a
delivery of them.

## The options

### Option A — auto-create a harbor per project root, silently
`pd` resolves the project root and creates a harbor for it on first use if none
exists. ADR-0013 already keys harbors to the project root, and
`resolveRoadmapHarbor` (`cli/commands/roadmap.ts:602`) already collapses every
worktree back to the canonical repo root, so the resolution logic exists.
- **Cost:** near zero. One creation path, idempotent.
- **Risk:** harbors accumulate for throwaway clones. A harbor with one member
  is just a name, so the cost of a stray one is a row.

### Option B — refuse to start without a harbor
`pd` errors out in a directory with no harbor and tells the operator to create
one.
- **Cost:** makes `pd` hostile in a fresh clone, for no safety gain.
- **Buys:** nothing that A does not, because the failure mode A prevents
  (homeless work) is prevented equally by creating the harbor.

### Option C — keep harbors optional, scope work to the root without one
Leave creation explicit; derive scoping from the project root regardless.
- **Cost:** two states to reason about everywhere — scoped-with-harbor and
  scoped-without — which is the ambiguity harbors exist to remove.

## Recommendation

**A. Auto-create, never refuse to start.** Refusing to start buys no safety
that auto-creation does not, and makes the tool hostile at exactly the moment a
new user meets it. A harbor with one member is a name; making the operator
type a command to get one is friction without a corresponding guarantee.

And **whatever is chosen, do not let it be described as an encryption change.**
Question 1's answer is the one most likely to be lost in summary.

## What this ADR deliberately does not decide

The decision. The operator asked the three questions above; this records the
answers and the options. Choosing A, B or C — and deciding separately whether
local at-rest encryption should widen beyond session notes — is the operator's
call, and neither follows from the other.
