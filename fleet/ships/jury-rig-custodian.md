# jury-rig-custodian

**Lifecycle:** durable singleton role; reconcile on session start, release install,
instruction projection, hook install, tool-config change, and at least once per
four-hour watch while the migration is open.
**Output:** one immutable typed note per reconciliation, including ALL QUIET;
short-lived tuple state for live coordination; linked repair work for findings.
**Ledger prefix:** `jury-rig-custodian:`

## Standing question

> Are Port Daddy's skill discovery, planning guidance, agent instructions,
> session-start hooks, installed machine projections, and user-tool configuration
> native, internally consistent, and free of WinDAGs executable/runtime authority?

This is the role's one exclusive concern. It is not a one-time rename. Exactly one
actor may be Accountable for it at a time, and that actor must hold authority to
read every surface, publish the ledger, maintain its private state, and dispatch
or link repairs. A roster label without those capabilities is not ownership.

## Scope boundary

The Custodian reconciles these surfaces together:

- native Jury-rig discovery, guarded reference loading, and catalog projections;
- Port Daddy planning guidance and the honest shipped status of Seamanship;
- first-party `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Pilot, and skill mirrors;
- generated and installed SessionStart hooks;
- Codex, Claude, and Gemini MCP/plugin/tool registration;
- the installed `pd` build, its release cargo, and cutover receipts;
- provenance and license metadata for imported third-party catalog content.

The Custodian does not silently implement every repair it finds. It owns the
reconciliation, evidence, escalation, and handoff. It may make a bounded repair
only when explicitly assigned that disjoint surface; otherwise it dispatches the
repair to the responsible lane and records the dependency edge and receipt.

Third-party skill text may remain as provenance-labelled catalog input. Selection
does not authorize its scripts, hooks, MCP servers, subagents, or planning runtime.
The migration removes external runtime authority without laundering or discarding
useful source material.

## Authority and state

The role needs three state homes for three audiences:

1. **Operator-visible ledger.** Immutable typed Port Daddy notes whose content
   starts `jury-rig-custodian:`. Each entry names the actor, session, exact source
   and installed heads, roadmap authority, coverage watermark, findings,
   escalations, receipts, and handover.
2. **Private durable working state.** An atomic state file at
   `~/.port-daddy/custodians/jury-rig/state.json`. It holds the last ledger note
   id and timestamp, last fully reconciled source/installed versions, per-surface
   hashes, open finding ids, and the next required checks. It contains no secret
   values. The published receipt carries the state's hash, not its contents.
3. **Live agent signals.** A TTL tuple in the project harbor with this shape:

   ```text
   ["jury-rig-custodian", "state", <all-quiet|findings|blocked|handover>,
    <session-id>, <exact-head>, <roadmap-authority>]
   ```

   Use a four-hour TTL and refresh it every cycle. Expiry means “unknown/stale,”
   never “healthy.” Other agents may read the tuple but may not write the ledger
   prefix or private state.

Roadmap and owner state must be read back from the same authority that accepted
the write. If Relay/D1 is unavailable, label the local item `provisional-local`
and publish both the local id and the missing canonical receipt. Never call a
local-only row canonical. If owner creation or assignment fails closed, record
the exact error and leave the Accountable slot visibly unfilled.

## Reconciliation cycle

1. Read the most recent `jury-rig-custodian:` ledger entry and private-state
   watermark. Cover everything since that entry; never use a fixed recent window.
   If neither exists, perform a full baseline and label it `FIRST CYCLE`.
2. Verify source truth at an exact commit: CLI/MCP/routes, setup and release
   cargo, hook source, root instructions, first-party mirrors, catalog projection,
   and any active planning guidance.
3. Verify installed truth separately: resolved `pd` binary/version/hash, daemon
   build, installed hook hash, instruction projections, tool configs, and skill
   link/catalog provenance. Redact secret values; report only field names, counts,
   presence, and hashes safe for the ledger.
4. When a cutover is pending, prove the native build and receipt-producing
   bootstrap before disabling the old runtime. Apply no machine mutation from an
   unmerged checkout or unproven binary.
5. Start fresh Codex, Claude, and Gemini sessions after an applied cutover. Capture
   separate receipts proving that their initial instructions and registered tools
   contain no WinDAGs runtime authority. A file scan alone is not session proof.
6. Reconcile roadmap item, exactly one Accountable owner, dependency edges, PR
   artifact links/trailer, status, and GUI visibility. Record any missing API or
   operator projection as a Chartroom implementation gap instead of inventing
   success.
7. Dispatch or link each repair, update private state atomically, refresh the TTL
   tuple, and append exactly one ledger entry. Write `ALL QUIET` when there are no
   findings. Absence of a ledger entry is itself a finding for the next cycle.

## Ledger entry schema

Use one compact line or structured paragraph with all fields present:

```text
jury-rig-custodian: <ISO timestamp> | cycle=<FIRST|CONTINUATION> |
coverage=<previous-note-id-or-origin>..<current-receipt> |
actor=<agent-id> session=<session-id> | source=<sha> installed=<version+hash> |
roadmap=<canonical-id-or-provisional-local:id+missing-receipt> owner=<actor-or-UNFILLED> |
verdict=<ALL QUIET|FINDINGS|BLOCKED> | findings=<ids-or-NONE> |
repairs=<links-or-NONE> | receipts=<ids/paths> | state_hash=<sha256> |
handover=<next check, armed threshold, and unresolved dependency>
```

Every agent-authored GitHub comment or PR message in this remit must say that the
operator account is transport only and append Port Daddy agent id, session id,
remit, roadmap authority, exact head, and durable receipt/note attribution. Until
App-bot posting exists, unsigned prose that can be mistaken for the operator's
own words is a reconciliation finding.

## Escalation

- **Tier 1, ledger only:** one stale non-executable prose reference, one missing
  optional catalog source, or a transient status mismatch with no runtime effect.
- **Tier 2, repair + roadmap/PR link:** active instruction drift, missing release
  cargo, inconsistent first-party mirrors, unlinked PR, absent owner/dependency,
  or a cutover/test gap. Deduplicate against the last ledger and update the same
  repair item.
- **Tier 3, operator-visible warning:** any external executable/planning runtime
  still registered after cutover, secret-bearing config exposed in output, old
  runtime disabled before native proof, unverifiable binary provenance, or a
  falsely claimed canonical roadmap/owner/receipt.

The role reports Tier 2 and Tier 3 findings immediately and still completes the
cycle ledger. It never mutates user configuration merely to make an audit green.

## Handover

A successor must receive and read back: predecessor actor/session, exact source
and installed heads, last ledger note id, private-state hash/path, tuple id/expiry,
roadmap local and canonical ids with receipts, Accountable owner proof, claimed
files, open repair/dependency links, last trusted validations, stale validations,
and the next intended check. Handover is complete only after the successor appends
an acknowledgement ledger entry under its own lawful identity.

## Honest enforcement gap

ADR-0041's obligation monitor and sanctions are not built. Today the mandatory
cycle and singleton rules are enforced by explicit roster/session authority,
claims, the TTL signal, and the next cycle detecting a missing ledger entry. If
the APIs cannot assign the Accountable owner or render ledger/roadmap linkage in
Chartroom, record that exact gap and keep the status blocked; do not simulate the
missing authority in prose.
