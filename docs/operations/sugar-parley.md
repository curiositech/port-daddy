# Sugar-first Parley contract

Sugar-first Parley consolidates the ordinary, bounded coordination experience
on top of existing Port Daddy authorities. It is a thin product façade, not a
second Parley subsystem: normal agents see human actions and typed receipts,
while raw Parley verbs remain debugging and protocol-inspection plumbing.

## Existing-surface map

| Surface | Canonical owner | Sugar-first use |
| --- | --- | --- |
| Raw convenience verbs, fan-out, and read receipts (#688) | `cli/commands/parley.ts`, `routes/parley.ts`, `lib/parley.ts` | Preserved as protocol/debug plumbing; Sugar never replaces it. |
| Automatic admission, lineage, records, turns, outbox, and terminal state | `lib/parley-auto-trigger.ts`, `lib/parley.ts`, `lib/parley-store.ts` | Sugar supplies one derived signal and a finalizer; it creates no record or receipt store. |
| Declared-claim overlap and address/evidence grammar | `lib/suggestion-broker.ts` and `lib/sessions.ts` claim-forest projection | Sugar intersects the existing `detectClaimOverlaps` result with a reviewed peer; it does not implement collision rules. |
| Edit-derived overlap | `lib/surface-overlap.ts` | Remains the source-derived overlap plane; Sugar does not duplicate it. |
| Semantic peer suggestions | `lib/whois.ts`, `routes/whois.ts`, and the ordinary `pd begin` selector | Sugar uses the same reviewed semantic/LLM admission rule, then adds structural grounding. |
| Exact claim releases and plan receipts | `lib/sessions.ts` `applySugarParleySettlement` | The Parley finalizer invokes it inside the owning transaction; Sugar never directly releases claims or writes notes. |
| #9914 consolidation façade | `lib/sugar-parley.ts`, `routes/sugar.ts`, `cli/commands/sugar.ts`, and the terminal renderer | Re-derives one card from canonical outputs, invokes the existing automatic Parley, and renders human actions, hooks, messages, and receipts. It owns no overlap detector or settlement store. |

This supersedes the earlier #9914 duplicate-authority plan, not the underlying
protocol. It removes Sugar-local claim collision, address/evidence formatting,
and duplicate signal reconstruction in favor of those canonical surfaces.

## Admission

After an interactive `pd begin` succeeds, or after default interactive
`pd attention` completes for an active context, a capable terminal may make
one bounded, authenticated request:

```text
GET /sugar/parley-card?sessionId=<session>
```

The client waits at most 150 ms and never invents a card. The daemon returns a
`sugar_parley_card` only when all of the following are true:

1. The caller presents a daemon-minted actor credential and that actor matches
   the session's verified identity stamp. The daemon takes the semantic query
   from that session's recorded purpose; client display handles and query text
   are never authority.
2. WhoIs returns a live peer admitted by the same semantic/LLM-reviewed policy
   used by ordinary `pd begin` suggestions. Exact and BM25 candidates may feed
   the shared resolver, but never admit a card themselves.
3. The canonical suggestion-broker overlap detector reports exact overlapping active claims on one file,
   symbol, or line range.

If a canonical actor has several active sessions, the card binds the exact
session whose claim supplies the structural evidence. Resolve together
revalidates those exact session bindings before delivery; it never substitutes
an arbitrary session held by the same actor.

The card schema is `kind: "sugar_parley_card"`, `schemaVersion: 1`. Its stable
fields are `cardId`, `signalId`, `surface`, `participants`,
`semanticEvidence`, `structuralEvidence`, `bounds`, and human-labelled
`actions`. The normal action labels are **Work separately**, **Send note**, and
**Resolve together**.

JSON, quiet, export, piped, CI, and explicitly non-interactive invocations
retain their existing deterministic `pd begin` output; they do not receive a
coordination card or prompt. A `NO_COLOR` interactive terminal receives the
same card in deterministic ANSI-free linework.

## Human actions and receipts

Every action re-derives the current card before changing durable state. Client
supplied display handles, parties, surface names, and evidence references are
never authority.

| Human action | Endpoint | Typed result |
| --- | --- | --- |
| Work separately | `POST /sugar/parley/work-separately` | `sugar_parley_work_separately_receipt` |
| Send note | `POST /sugar/parley/note` | `sugar_parley_note_receipt` |
| Resolve together | `POST /sugar/parley/resolve-together` | `sugar_parley_convening_receipt` |
| Send natural-language message | `POST /sugar/parley/message` | `sugar_parley_message_receipt` |
| Acknowledge typed settlement | `POST /sugar/parley/settle` | non-terminal `sugar_parley_settlement_acknowledgement`, or the terminal receipt below |

`Resolve together` constructs a `session_begin` / `task_convergence` signal
from the daemon-derived parties, surface, and evidence. The automatic Parley
delivers a distinct nested hook payload to both inboxes. The outer envelope is
still `parley_summons`; consumers must inspect `content.sugarHookContext`:

The card's automatic surface identity includes the claim forest's exact
repository and world scope as well as its readable file/symbol address. Thus
the same relative path in separate worktrees cannot share a cooldown, capacity,
or reminder lineage.

```json
{
  "type": "parley_summons",
  "content": {
    "kind": "parley_summons",
    "sugarHookContext": {
      "kind": "sugar_parley_hook_context",
      "schemaVersion": 1,
      "origin": "sugar-parley",
      "parleyId": "…",
      "cardId": "…",
      "surface": "…",
      "evidenceRefs": ["…"],
      "message": "⚑ PARLEY BEGUN ⚑ A bounded Sugar Parley is active. …"
    }
  }
}
```

The message endpoint accepts natural-language content only; it fixes the
underlying representation server-side and does not expose a protocol-verb
selector. Its peer delivery has `type` and `content.kind`
`sugar_parley_message`, `schemaVersion: 1`, `origin: "sugar-parley"`, IDs,
surface, message, sequence, and the exact automatic evidence references.

## Settlement

Each party supplies the same concise summary and next step (each bounded to
2,000 characters) to `POST /sugar/parley/settle`. The daemon canonicalizes a
bounded agreement (maximum 16,384 characters) into a proposal ID and waits for
every bounded participant to acknowledge the exact same object. Before
unanimity, the result is a **non-terminal**
`sugar_parley_settlement_acknowledgement` with `state: "awaiting-peer"`; it
makes no claim or plan change and must never be treated as a settlement receipt.
An acknowledgement remains current only while it is that party's latest
persisted turn. Sending another natural-language message deliberately revokes
that acknowledgement, so the party must acknowledge the exact typed settlement
again before it can terminalize.

On the second matching acknowledgement, Parley invokes the session authority
inside the same SQLite transaction. A false effect result becomes a throw, so
the agreeing turn, terminal outcome, cooldown release, outbox intent, claim
release, and plan receipt all roll back together. Only after that committed
effect does it enqueue the sole terminal contract to both inboxes:

```json
{
  "type": "sugar_parley_settlement_receipt",
  "content": {
    "kind": "sugar_parley_settlement_receipt",
    "schemaVersion": 1,
    "state": "settled",
    "origin": "sugar-parley",
    "harbor": "…",
    "parleyId": "…",
    "proposalId": "…",
    "surface": "…",
    "evidenceRefs": ["exact automatic evidence"],
    "outcome": { "status": "COLLAPSED" },
    "claimUpdates": [{ "sessionId": "…", "claimRef": "…", "released": true }],
    "planUpdates": [{ "sessionId": "…", "updated": true }],
    "remindersSuppressed": true,
    "replayed": false,
    "reason": "…"
  }
}
```

The receipt’s evidence array is copied from the recorded automatic Parley; a
caller cannot override it. A retry returns a distinct `replayed`
acknowledgement and does not fabricate another terminal receipt. Outbox
overflow remains durable `deliveryOverflow` state on the canonical Parley
summary, rather than a false claim that a receipt was delivered.

## Porthole integration boundary

The Porthole proof consumes this public contract only after canonical source
and focused tests are green. Its real tmux/asciicast scenario will show two
agent panes in a chummy Parley and a disagreeable-but-productive Parley. Each
will show the normal card, the nested flag-fanfare hook, natural-language peer
messages, and the terminal receipt with concrete forward work. It must not
synthesize a card, call raw Parley performatives as the primary interaction, or
treat an acknowledgement as settlement. Porthole has no runtime dependency on
these endpoints and remains independently deployable.
