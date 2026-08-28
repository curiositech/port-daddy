# Sugar-first Parley contract

Sugar-first Parley is the ordinary, bounded coordination experience for two
active agents whose work is both semantically related and structurally
overlapping. It is not a wrapper around the raw Parley protocol: normal agents
see human actions and typed receipts, while raw Parley verbs remain a
debugging and protocol-inspection surface.

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
2. WhoIs returns a live peer whose cosine similarity *and* final score both
   clear the semantic review threshold. BM25 may nominate candidates for the
   shared resolver, but never admits a card by itself.
3. The two canonical actors hold exact overlapping active claims on one file,
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
| Acknowledge typed settlement | `POST /sugar/parley/settle` | `sugar_parley_settlement_receipt` |

`Resolve together` constructs a `session_begin` / `task_convergence` signal
from the daemon-derived parties, surface, and evidence. The bounded automatic
Parley receives a distinct hook payload on both participants' inboxes:

```json
{
  "kind": "sugar_parley_hook_context",
  "schemaVersion": 1,
  "parleyId": "…",
  "cardId": "…",
  "surface": "…",
  "evidenceRefs": ["…"],
  "message": "A bounded Sugar Parley is active. …"
}
```

The message endpoint accepts natural-language content only; it fixes the
underlying representation server-side and does not expose a protocol-verb
selector.

## Settlement

Each party supplies the same concise summary and next step to
`POST /sugar/parley/settle`. The daemon canonicalizes that object into a
proposal ID and waits for every bounded participant to acknowledge the exact
same receipt. Before unanimity, the receipt state is `awaiting-peer` and makes
no claim or plan change.

Once unanimous, the authoritative Parley collapses and the receipt state is
`settled`. It records only these bounded effects:

- release the claims named by the original structural evidence;
- append a checked settlement item to each participating session plan; and
- release automatic admission capacity, which suppresses the settled reminder
  lineage.

A failed claim or plan effect is returned as `state: "failed"` with its
per-effect arrays intact; it is never reported as a successful settlement.

## Porthole integration boundary

Porthole may later join this public contract by capturing the normal `pd begin`
or `pd attention` arrival card, its human labels, the distinct hook context, natural-language
message receipt, and final typed settlement receipt. It must not synthesize a
card, call raw Parley performatives as the primary interaction, or treat a
non-terminal acknowledgement as settlement. Porthole has no runtime dependency
on these endpoints and remains independently deployable.
