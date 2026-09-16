# ADR-0124: Transcript Redaction — fail-closed states for transcript egress

- **Status:** Accepted
- **Date:** 2026-08-16
- **Closes:** binder ch11 R6's required change — "Milestone 1 must include a
  transcript-redaction fixture and a 'raw secret cannot persist unredacted'
  test. Milestone 10 cloud sync must fail closed if redaction state is
  unknown"
  (`docs/architecture/agent-harbor-technical-binder/11-redteam-whitehat-cross-lens-review.md`)
- **Builds on:** ADR-0045 (loud-fail invariants), ADR-0058 (durable
  transcript retention), ADR-0101 (egress assertion), ADR-0115 (database
  distribution & sync), ADR-0122 (harbor authority), ADR-0123 (cloud vault /
  account KMS)
- **Siblings (2026-08-16 shared-harbors program):** ADR-0122 (Harbor
  Authority), ADR-0123 (Cloud Vault / Account KMS), ADR-0125 (iOS Operator
  Surface), ADR-0126 (Shared-Harbors Re-sequencing)
- **Doctrine drawn from:** `skills/derived-index-consent-boundary`,
  `skills/responsible-logging`

## Context

Transcript-by-default is the substrate bet of the whole binder: resume,
search, compaction, memory, receipts, and skills all stand on the event
trail (binder ch04). The same bet is R6's attack surface: a provider key,
SSH URL, token, customer name, or private bug detail lands in a tool output
and is saved forever; the user later enables cloud sync or shares a harbor,
and the payload travels (binder ch11 R6, ch15 C6).

What ships today, honestly inventoried:

- **`lib/transcripts.ts`** scrubs message content and tool-call args at
  write time through `redactSecrets()` — a curated pattern set (secret env
  conventions, Bearer tokens, GitHub/OpenAI/Anthropic/Stripe/AWS key
  shapes). Its own header calls it "best-effort; not a substitute for
  keeping secrets out of prompts." Nothing records that it ran, or which
  pattern set ran.
- **`lib/transcript-archive.ts`** (ADR-0058) copies every finalized
  `TranscriptEntry` verbatim into the fsync'd JSONL archive under
  `~/.port-daddy/transcripts/`. The archive is the retention floor and the
  declared on-ramp to external warehouses (S3/R2/BigQuery) — an on-ramp
  with no redaction check at the ramp.
- **ADR-0115** builds the sync spine that will carry events off-machine:
  the relay as ciphertext journal (D1 hot, R2 archive), `from_seq` replay,
  and encrypted `VACUUM INTO` snapshot blobs for new-device bootstrap.
- **ADR-0123** seals everything that crosses the relay under the harbor
  key hierarchy, and abolishes the unlabeled middle state on the wire.
- **Binder ch04** already lists "redaction state" as a required field of
  every transcript event. It is aspiration, not schema: no column, no
  enum, no gate reads it.

So redaction today is a *function* that runs, not a *state* that is
recorded and checked. The moment Milestone 10 wires ADR-0115 sync or the
ADR-0125 iOS tail to the transcript store, every historical best-effort
scrub becomes an unverifiable claim traveling to another device. R6 names
the fix: cloud sync must fail closed when redaction state is unknown. This
ADR makes that normative before any transcript byte leaves a machine.

These decisions were settled by the operator in the 2026-08-16
shared-harbors program review.

## Decision

### 1. Redaction state is a closed enum, stamped per transcript segment

Every transcript event (and the transcript header over its segments)
carries a first-class `redaction_state` from a closed enum:

- **`raw`** — the original payload, retained deliberately. Exists only
  when the operator enables encrypted raw retention for that harbor (the
  R6 whitehat defense); it is never a default and never an accident.
- **`scrubbed`** — the automatic redaction pipeline ran at persistence
  time: the `redactSecrets()` pattern set plus the ch11 R6 whitehat
  additions (entropy scanning, `.env` path detection, SSH/private-key
  markers, OAuth token patterns, user-added regexes). A `scrubbed` stamp
  always carries the pipeline version that produced it, so "scrubbed by
  which rules" is answerable forever.
- **`redacted`** — a targeted redaction event was applied on top:
  retroactive removal of a known leak, or a stricter per-harbor policy
  pass. Before egress, the payload is replaced locally. After egress, the
  authority appends a signed tombstone naming the affected event; stores Port
  Daddy controls delete the ciphertext payload and retain only the chain
  commitment and audit marker (binder ch06: "redact a secret leak
  retroactively while preserving an audit marker"). This blocks future reads
  through Port Daddy but cannot make an already-authorized recipient forget a
  payload or key it copied. Deletion never silently rewrites shared history.
- **`unknown`** — the absence of any stamp. Unknown is a real state, not
  a missing value, and it is **never assumed clean**.

The transcript header's state is the most restrictive state of any of its
segments. Schema-wise this is two columns (`redaction_state`,
`redaction_pipeline_version`) on `fleet_transcripts` and
`fleet_transcript_messages`, mirrored into the binder ch09 canonical event
schema; the ch04 field list stops being aspiration.

### 2. Fail closed: nothing leaves the machine unless scrubbed or redacted

The export predicate is one line and it is the whole point:

```
exportable(event) := event.redaction_state ∈ { scrubbed, redacted }
```

`unknown` and `raw` are non-exportable, without exception. Every egress
path checks the predicate at the machine's edge:

- **relay publish** — no transcript-carrying event enters `/v1/publish`
  unless exportable;
- **cloud sync** (ADR-0115 change-event journal and `from_seq` replay) —
  non-exportable events are withheld from the outbox, not filtered by the
  reader;
- **R2 snapshot** — this ADR supersedes ADR-0115's `VACUUM INTO` physical-copy
  step. The builder opens the source in a consistent read transaction, creates
  a new private database at a new path and inode, installs schema from a
  versioned allowlist, and logically inserts only allowlisted tables, columns,
  and exportable rows. It never copies source pages or blindly replays
  `sqlite_master`. Non-exportable transcript rows become freshly constructed
  stubs containing event id, sequence, redaction state, and a signed audit
  marker; no plaintext hash is retained because that would give recipients a
  dictionary oracle. The rebuilt database is finalized and verified before it
  is encrypted. Any failed export or verification aborts upload and destroys
  the staging artifacts. A bootstrapping device renders "withheld: redaction
  state unknown" instead of a silent hole;
- **iOS transcript tail** (ADR-0125) — the tail streams exportable events
  only; a withheld segment renders as withheld;
- **export flows** (binder ch06 "export before delete", `pd transcripts`
  output leaving the machine) — same predicate, same refusal shape.

`raw` retention is therefore a *local-only* promise by construction: an
operator who opts into encrypted raw retention has opted into material
that can never ride sync, snapshots, or the tail. The consent screen for
that opt-in says so in plain words.

This discharges R6's Milestone 10 clause exactly: an event whose redaction
state is unknown does not sync. It does not "sync with a warning."

### 3. Redact before seal: the relay never holds unredacted ciphertext

Composition order with ADR-0123 is normative:

```
wire_event = seal(redact(event))
```

Redaction runs at the daemon boundary, before the pd-vault seal, and the
seal call sites accept only state-stamped events. The rationale is the
shadow-index trap from `skills/derived-index-consent-boundary`: a
read-side filter over an always-on pipeline leaves the dangerous copy in
existence — a breach, insider, and subpoena target no API gate protects.
Applied here: if unredacted payloads were sealed and shipped, the relay's
D1 journal and R2 archive would durably hold ciphertext whose plaintext
still contains the leak, and every future key disclosure — a removed member
who retained a prior epoch key, a recovered device, a
subpoenaed snapshot plus a compelled key — would disclose secrets the
product had promised were gone. The gate must sit at the write side of
the pipeline, not the read side of the API. Encryption is not redaction;
sealing a secret preserves it.

The relay itself can never inspect or scrub: it sees only ciphertext
(ADR-0115 I1, ADR-0123 §3) and holds no keys. There is exactly one place the
plaintext and the authority to change it coexist — the owning daemon
(ADR-0122) — so that is where redaction lives. Retroactive redaction of an
already-published event is a new, exportable `redacted` tombstone ordered by
the harbor authority. The relay and receivers can authenticate that tombstone
without decrypting the old event, delete ciphertext they still control, and
keep the minimal chain marker. History gets corrected forward, never silently
rewritten; copies already taken outside those stores remain outside the
system's power to revoke.

### 4. The archive and the delete flows carry the state; backfill says unknown

- **JSONL archive lines** (ADR-0058) carry `redaction_state` and pipeline
  version, so the retention floor and any future warehouse sink inherit
  the same predicate — a cloud `TranscriptArchiveSink` is an egress path
  under §2, not an exception to it.
- **Backfill is honest.** The migration stamps every pre-existing row and
  archive line `unknown`. Yes, `redactSecrets()` ran at write time for
  most of them — but unstamped, unversioned, and best-effort by its own
  comment. Retro-claiming `scrubbed` for rows that cannot prove which
  pattern set ran would be laundering, the exact move ADR-0123 §6 forbade
  for `relay_readable` backfill. `unknown` is escapable, not a dead end:
  a re-scrub job re-runs the current pipeline over historical rows and
  stamps them `scrubbed` at the current version, after which they may
  sync.
- **Delete and redact propagate into everything derived.** The delete and
  retroactive-redaction paths name every transcript-derived store in an
  explicit inventory — live tables, JSONL archive, search indexes, memory
  distillations — and CI fails when a new transcript-derived store is
  added without touching that inventory (the consent-boundary skill's
  erasure rule: derived tables are the rows erasure audits always miss).
  Derived memories whose sources were redacted are marked degraded rather
  than left masquerading as fully sourced (binder ch06).

### 5. The redaction verifier: a named gate with teeth

Redaction gets the same treatment ADR-0101 gave "local-only uploads
nothing": a named, runtime-verifiable check, not a marketing sentence.
`lib/safe/egress-assertion.ts` is the model — fail-closed, names every
offender, and refuses the vacuous pass. The redaction verifier
(`lib/safe/redaction-verifier.ts`, proposed — not yet built, stated
plainly the way ADR-0115 stated `r2.ts`) proves, in CI and on demand as
an audit surface:

1. **Raw secrets cannot persist unredacted.** A fixture corpus seeds each
   ch15 C6 class — provider keys, SSH private keys, `.env` paths, OAuth
   tokens, npmrc, Docker auth, shell history, MCP config — into message
   content and tool output. After persistence, no fixture substring
   survives in any stored payload, and the stored events are stamped
   `scrubbed` at the current pipeline version. Any survivor fails the
   build. This is R6's Milestone 1 fixture.
2. **The predicate holds at every edge.** Each egress path from §2 is
   offered an `unknown` and a `raw` event; every path must refuse, and
   the refusal must be observable. A new egress path that skips the check
   is a failing test, not a review hope.
3. **No exported row is non-exportable.** A table-scan invariant over the
   sync outbox and archive-export records — the consent-boundary skill's
   "the test is a table scan, not an API probe" — runs in CI, forever.
4. **No vacuous pass.** Like the egress assertion's `verified` flag, an
   empty corpus or an unobservable path reports `verified: false`; a
   check that could not observe anything never reports clean.
5. **The finalized snapshot contains no recoverable source bytes.** A hostile
   SQLite fixture writes unique canaries into ordinary cells and large overflow
   payloads, then updates and deletes them so copies remain in freelist pages
   and WAL/journal history. Snapshot construction must use the §2 logical
   rebuild, close and finalize the fresh database, remove or reject every
   `-wal`, `-shm`, and `-journal` sidecar, and scan the exact plaintext file
   that will be sealed. The test fails if any canary byte sequence survives,
   if `freelist_count` is nonzero, or if schema/table/column inspection finds
   anything outside the export allowlist. Encryption is permitted only after
   both the logical invariant and finalized-byte scan pass. Scanning an earlier
   staging copy is not evidence about the file that is uploaded.

### 6. Refusals are visible, bounded, and never a storm

Fail-closed gates in sync loops have two classic failure modes, and this
ADR closes both by doctrine from `skills/responsible-logging`:

- **Visible.** A withheld event is surfaced, never silently dropped: sync
  status shows "N events withheld: redaction state unknown" with the
  re-scrub action attached, and surfaces render withheld segments as
  withheld. The `docs/hitl-interruptions.md` rule generalizes here: a
  failed check renders "unknown," never "all clear," and `unknown` never
  renders as clean.
- **Bounded.** A backlog of N unknown events replayed on every reconnect
  is a per-event refusal inside a retry loop — the cardinal log-storm
  shape. Refusals route through the governed logger under a stable
  low-cardinality key (`transcript_egress_blocked`), event ids in meta,
  with rollups reporting the true suppressed total.
- **Fail-safe, fail-closed.** A throwing redaction pipeline must not
  crash the daemon and must not wave the event through: the event stays
  (or becomes) `unknown` — and therefore stays home — while the failure
  is reported loudly once, not per event. Observability can never crash
  the process; a broken scrubber can never widen egress.

## Consequences

- **Milestone 10 inherits a hard gate.** Cloud sync, the R2 snapshot
  path, and the ADR-0125 tail cannot ship ahead of state stamping and the
  §5 verifier. ADR-0126 sequences this; the ordering cost is deliberate.
- **Historical transcripts do not sync until re-scrubbed.** Day one after
  the migration, an operator's whole history is `unknown` and stays
  local. The re-scrub job is therefore part of this ADR's minimum ship,
  not a fast-follow — `unknown` must be escapable through work, never
  through a default.
- **Hot-path cost.** Redaction (patterns + entropy scan) now runs before
  every seal on the export path. Acceptable: it already runs at write in
  `lib/transcripts.ts`; the change is stamping and placement, not a new
  class of work. The stamp makes re-runs skippable by version check.
- **Pipeline versioning is a contract.** Every pattern-set change bumps
  the version. Old `scrubbed` rows stay exportable at their recorded
  version; a harbor that requires a minimum scrub version gets an honest
  re-scrub pass, not a silent re-grade.
- **`raw` retention is permanently local.** Operators who want raw
  payloads off-machine do not get it from Port Daddy; that is a product
  boundary, priced in, stated at opt-in.
- **Retroactive redaction has an honest limit.** It removes future Port Daddy
  access and propagates deletion through stores and derived indexes the system
  controls. It cannot revoke plaintext, ciphertext, or keys an authorized
  recipient already copied; the redaction UI states that boundary before the
  operator confirms it.
- **The R2 snapshot is a logical rebuild, never a sanitized physical copy.** A
  fresh allowlisted database makes bootstrap snapshots honest subsets plus
  signed stubs without carrying recoverable source freelist, overflow, or
  journal pages. The manifest authenticates which rows were withheld without
  exposing a plaintext digest, and the gap remains renderable ("no transcript
  because…" is already the binder's Milestone 1 honesty rule).
- **A quiet failure mode is converted into a loud one.** Before this ADR,
  a scrubber regression leaked silently; after it, a scrubber regression
  fails the §5 fixture, and a stamping regression stalls sync visibly.
  Both beat the alternative, which was neither.

## Alternatives considered

- **A boolean `redacted: true/false`.** Rejected: it cannot distinguish
  "pipeline ran at version N" from "operator redacted a known leak" from
  "nobody checked," and a default-false boolean invites exactly the
  grandfathering backfill this ADR forbids.
- **Grandfather legacy rows as `scrubbed`** because `redactSecrets()` ran
  at write time. Rejected: unstamped, unversioned, self-described
  best-effort. Claiming it retroactively is the laundering move; §4 marks
  history `unknown` and earns `scrubbed` by re-running the pipeline.
- **Read-side filtering** (serve sync from the full store, filter at the
  API). Rejected by the shadow-index rule: the unredacted copy would
  still exist on the far side of the boundary — and on the relay — as a
  breach and subpoena surface. The gate belongs at the write side of the
  egress pipeline (§3).
- **Redact at the relay.** Rejected outright: the relay sees ciphertext
  only (I1), holds no keys (ADR-0123), and must never gain a reason to.
- **Fail closed at persistence** (refuse to store `unknown` locally).
  Rejected: local capture-by-default is the R6 whitehat defense; killing
  local capture degrades resume, search, memory, and accountability. The
  boundary that matters is the machine's edge, and §2 holds it.
- **`VACUUM INTO` the source, then sanitize rows in place.** Rejected: deleting
  or updating rows in a physical copy does not prove their prior bytes vanished
  from freelist, overflow, WAL, or journal pages. Encryption would faithfully
  preserve those recoverable bytes. Section 2 instead rebuilds from an explicit
  logical allowlist and §5 scans the finalized file that will actually be
  sealed.

## Cross-references

- `docs/architecture/agent-harbor-technical-binder/11-redteam-whitehat-cross-lens-review.md`
  — R6: the attack, the whitehat defense, and the required change this
  ADR discharges.
- `docs/architecture/agent-harbor-technical-binder/04-context-memory-and-skills.md`
  — the transcript substrate and the event-field list ("redaction state")
  made normative in §1.
- `docs/architecture/agent-harbor-technical-binder/06-security-privacy-billing-and-accounts.md`
  — redaction before persistence, retention/deletion controls, tombstones
  and audit markers, degraded derived memory.
- `docs/architecture/agent-harbor-technical-binder/07-milestones-and-work-dag.md`
  — Milestone 1 (transcript truth) and Milestone 10 (cloud sync,
  export/delete) that §2 and §5 gate.
- `docs/architecture/agent-harbor-technical-binder/15-recursive-critical-synthesis.md`
  — C6: the fixture-class list the §5 corpus implements.
- `docs/adr/0058-durable-transcript-retention.md` — the JSONL archive and
  backfill this ADR stamps (§4).
- `docs/adr/0101-fleet-run-pages-github-login-and-user-funded-fleets.md`
  — the egress-assertion gate (`lib/safe/egress-assertion.ts`) whose
  shape §5 reuses.
- `docs/adr/0115-database-distribution-and-sync.md` — the sync spine,
  `from_seq` replay, and R2 snapshot path gated by §2.
- `docs/adr/0122-harbor-authority.md` — the single writer that orders
  retroactive redaction events (§3), and retention-conflict resolution
  for shared artifacts.
- `docs/adr/0123-cloud-vault-account-kms.md` — the seal this ADR composes
  under (`seal(redact(event))`), the retained-prior-key disclosure boundary
  §3 defends against, and the honest-backfill precedent §4 follows.
- ADR-0125 (iOS Operator Surface) — the transcript tail as a gated
  egress path; ADR-0126 (Shared-Harbors Re-sequencing) — where this
  ADR's prerequisites land in the build order.
- `lib/transcripts.ts`, `lib/transcript-archive.ts` — the in-tree scrub
  and archive reality this ADR upgrades from function to state.
- `docs/hitl-interruptions.md` — the never-fabricate surface rule
  ("unknown" never renders as "all clear") §6 adopts.
- `skills/derived-index-consent-boundary/SKILL.md` — gate position
  (write-side, never read-side), honest backfill, erasure inventory.
- `skills/responsible-logging/SKILL.md` — governed refusal logging,
  rollups, and fail-safe observability for the §6 rules.
