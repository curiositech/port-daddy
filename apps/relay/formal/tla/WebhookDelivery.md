# WebhookDelivery — replay-freedom & ordering for relay webhook ingress

TLA+ spec for the GitHub-App → untrusted relay → daemon webhook path. It closes
the obligation the ProVerif origin-auth model (`apps/relay/formal/proverif/github-ingress/github_ingress_origin_auth.pv`)
deliberately left **open**: ProVerif proves *origin* (the daemon dispatches only
GitHub-signed events) but **not replay-freedom** — a MAC lets the attacker
re-deliver a genuine `(payload, mac)` pair. Replay-freedom and ordering are
mutable-state, ordering-sensitive properties, which are TLA+'s domain, not
ProVerif's.

## Model

The receiver emits a per-publisher chain of webhook events with monotonic `seq`
(the relay's Merkle chain). The **relay is the adversary**: `Deliver(s)` can carry
any already-emitted `s` to the daemon, in any order, any number of times
(reorder + duplicate + redeliver-forever). The daemon consumes with a
**chain-continuity guard**: dispatch `s` to the fleet iff `s = tip + 1`.

`Dedup` is a CONSTANT so one module checks both daemons:

| `.cfg` | `Dedup` | Meaning | Expected |
|--------|---------|---------|----------|
| `WebhookDelivery.cfg` | `TRUE` | fixed daemon (seq=tip+1 guard) | all properties hold |
| `WebhookDelivery_vuln.cfg` | `FALSE` | negative control (dispatch anything) | `AtMostOnce` violated |

## Properties

- **`AtMostOnce`** (safety): `\A s : dcount[s] <= 1` — replay-freedom; no webhook dispatched to the fleet twice.
- **`Contiguous`** (safety): dispatched set is exactly `1..tip` — in-order, gap-free; the daemon never acts on a later event while an earlier one is missing (the A2 stale-state defense).
- **`EventuallyDispatched`** (liveness): under fair delivery (`WF_vars(Deliver(s))`), every emitted webhook is eventually dispatched.

## Results

```
# fixed (deadlock check off — the terminal "all dispatched" state is the goal, not a bug)
java -cp ~/coding/tmp/tla2tools.jar tlc2.TLC -deadlock -config WebhookDelivery.cfg WebhookDelivery.tla
#  -> Model checking completed. No error has been found.
#     28 distinct states; 6 temporal branches checked (EventuallyDispatched holds).

# negative control
java -cp ~/coding/tmp/tla2tools.jar tlc2.TLC -deadlock -config WebhookDelivery_vuln.cfg WebhookDelivery.tla
#  -> Invariant AtMostOnce is violated.
#     trace: dcount <<0,0,0>> -> <<1,0,0>> -> <<2,0,0>>  (relay redelivers seq 1; daemon double-dispatches)
```

Java: Homebrew OpenJDK (`/opt/homebrew/opt/openjdk/bin/java`). `tla2tools.jar` v1.8.0.

## Honest scope

- **Bounded & exhaustive, not 1M states.** The guard collapses the adversary's
  branching, so the fixed model is fully explored at 28 states (`MaxSeq=6`). This
  is a focused protocol, not the multi-agent BondedCommons case where the >1M-state
  gate applies. Coverage is exhaustive for the bound; raising `MaxSeq` keeps it
  linear.
- **Design-level.** The model proves the *consumption discipline*: a daemon that
  ingests the **ordered** per-publisher chain (seq = tip+1) gets at-most-once +
  in-order + gap detection in one mechanism. Runtime conformance for the
  publish/store side is the relay's chain-continuity check
  (`UNIQUE(sender, channel, seq)` + `prev_hash`, exercised by
  `apps/relay/tests/chain.test.ts`). The implementation obligation this names: the
  daemon must consume GitHub webhooks over the relay's ordered `from_seq` subscribe
  path, **not** the raw forward — that is what makes the `seq=tip+1` guard real.
