# Compliance Mode Gate Ladder

Use this when you need to decide what a body's declared compliance mode (`C0`-`C6`) actually obligates it to, or when you're gating a body's promotion from advisory to enforced coordination.

## The ladder

| Mode | Coordination posture | Legacy verb surface |
| --- | --- | --- |
| `C0`-`C3` | **Advisory.** The body is adopting coordination discipline but is not yet held to the enforced broker. | May still call the legacy etiquette verbs directly. This is expected and not a finding. |
| `C4`-`C6` | **Enforced.** The body has claimed the enforced-coordination bar. | **Must** call only the 5 broker tools (`work`/`act`/`ask`/`recall`/`status`). Zero legacy-verb calls. |

The boundary is `C4`. Below it, the legacy surface is fine to keep using — advisory bodies are still migrating and penalizing them for calling verbs that still exist would just push the migration underground. At `C4` and above, the body has told the rest of the system "you can rely on me only touching the enforced surface," and the IT-018 Broker Collapse gate exists to make that claim provable rather than aspirational.

## IT-018 Broker Collapse gate

The gate's check is exactly one boolean: `emitsLegacyVerbCalls`. A body reporting `complianceMode: "C4"` or higher with `emitsLegacyVerbCalls: true` has made a claim its own telemetry contradicts — this is not a style nit, it's the single fact the gate exists to catch. `scripts/broker_migration_audit.mjs` fires `c4plus-emits-legacy-verbs` (critical) in exactly this case, and does not accept "we're mostly through the migration" as a mitigating factor: the gate is binary because a coordination substrate that's "enforced except for a few legacy calls" is not enforced at all.

**How to actually prove `emitsLegacyVerbCalls: false`**, not just assert it:

1. Grep the body's own tool-call transcript (not its source code — a code audit proves intent, not runtime behavior) for any of the ~19 legacy verb names over a representative recent window.
2. Confirm zero hits. A single legacy call in the transcript means the declaration is false, regardless of how rare it is.
3. Re-run the check after any dependency upgrade or prompt change — a body can regress from `C4`-clean back to emitting legacy calls without anyone changing its declared compliance mode.

## Denial shape and transcript event: the other half of "enforced"

A tool being present in the broker surface is necessary but not sufficient. Each of the 5 tools must carry:

- **Exactly one denial shape** — a single, documented structure for "this call was rejected," so every caller (and every downstream auditor) can recognize a denial without special-casing per-tool response formats.
- **Exactly one transcript event** — a single, documented event emitted per call, so the coordination substrate has one place to look for "did this call happen and what did it do," rather than five different logging conventions to reconcile.

`broker-tool-no-denial-or-transcript` fires the moment either is missing on any of the 5 tools, because a tool without a denial shape can't be audited for correct rejection, and a tool without a transcript event can't be audited for having happened at all — both defeat the purpose of collapsing to a small enforced surface in the first place.

## Advisory bodies are not exempt from the mapping, just from the runtime gate

Don't read `C0`-`C3`'s tolerance for `emitsLegacyVerbCalls: true` as tolerance for an incomplete migration plan. `verb-unmapped`, `broker-grew`, `broker-tool-missing`, `broker-tool-no-denial-or-transcript`, and `parallel-runtime-migration` all fire regardless of compliance mode — those are structural properties of the migration plan itself, not runtime claims a body is making about its own behavior. Only `c4plus-emits-legacy-verbs` is gated on the compliance mode.
