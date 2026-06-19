# Port Daddy — the unified model (consolidation)

**Status:** Synthesis (operator-direct, 2026-06-05). Folds dispatch · nightshift ·
spawn · sortie · fleet · cartographer · coast guard · tube · console · pd-tui ·
pd-console into ONE model. Extends ADR-0048 (What Port Daddy Is).

> "I don't know the difference between them. Consolidate the visions. Fast and
> sleek, the V11 console, agents that actually use PD because it compels them to
> communicate, a proactive pd-cutter, cooperative vibe coding, remote harbors,
> and my data super-fucking encrypted."

There should be nothing for the operator to *track*. One system, named parts.

---

## 1. The one sentence

**Port Daddy is a harbor you run from the console, worked by voyages, policed by
the Coast Guard — which makes coordination the price of access — feeding a
suggestibility layer, all encrypted.**

Everything below is just where each existing word sits in that sentence.

```
        ┌──────────────── THE CONSOLE (V11) ────────────────┐   ← the operator's one surface
        │  talk to agents · voyage manifest · the Ledger ·   │     (pd-console = GPU face,
        │  the living harbor · cost intelligence             │      pd-tui = terminal face —
        └───────────────────────┬────────────────────────────┘      ONE console, two renderers)
                                 │ directs
                          ┌──────▼───────┐
                          │   VOYAGES     │   ← the one noun for "an agent doing work."
                          │ (spawn/sortie/│      dispatch/nightshift/spawn/sortie/fleet are just
                          │  nightshift/  │      LAUNCH VERBS × {when, review, recurring}.
                          │  fleet)       │
                          └──────┬───────┘
                  hosted in      │ each runs in a
                  a HARBOR  ◄────┤ sandboxed worktree from…
            (local or REMOTE)    │
                          ┌──────▼───────────┐
                          │  COAST GUARD      │   ← pd-cutter (ADR-0050). Hands out sandboxes,
                          │  (pd-cutter)      │      watches proactively, and ENFORCES the
                          └──────┬───────────┘      compulsion (§2). Safety + access control.
                                 │ all comms over
                          ┌──────▼───────┐
                          │   THE BUS      │   ← tube + notes + channels. How voyages talk.
                          │ (tube/notes)   │      Compulsory (§2). Subscribe or go deaf.
                          └──────┬───────┘
                                 │ aggregated by
                          ┌──────▼───────────┐
                          │  CARTOGRAPHER →   │   ← turns coordination signal (notes, rebases,
                          │  SUGGESTIBILITY    │      outcomes) into roadmap + suggestions.
                          └───────────────────┘      The system gets smarter as agents coordinate.

        ░░░ ENCRYPTED END-TO-END (envelope crypto, ProVerif-verified) ░░░   ← §4
```

---

## 2. The keystone — coordination is the price of access (mechanism design)

This is what makes agents *actually use* Port Daddy instead of working in the dark.
It is not politeness; it is the rent.

**The Coast Guard hands every voyage a sandboxed worktree. You keep it only if you
pay coordination rent:**
- **Every commit must publish a note.** No note, no commit (the guard already
  blocks; now it's load-bearing, not advisory).
- **Stay rebased** onto the live branch, or the sandbox goes stale and is reclaimed.
- **Feed the suggestibility layer** — leave the inputs cartographer needs (scope,
  result, remaining-risk) — or your lane is judged idle and revoked.

A voyage that hoards (works without coordinating) **loses its live sandbox.** So the
Nash-equilibrium behavior is: communicate. Agents coordinate because the alternative
is being cut off — incentive-compatible by construction (mechanism design for agent
labor). It also fixes the operator's "inbox empty / subscribed to nothing" gap:
**you don't receive the bus unless you subscribe, and you don't keep access unless
you participate.** Listening becomes mandatory, not optional.

---

## 3. The consolidation table — every word, one home

| Today's word | Is really | In the model |
|---|---|---|
| dispatch / nightshift / spawn / sortie | launch verbs | ways to start a **voyage** (when × review) |
| fleet agent | a recurring voyage | a standing voyage (a *line*) |
| voyage | the unit of agent work | **the noun** (spend↔outcome↔roadmap) |
| harbor | the workspace | where voyages run (local **or remote**) |
| cartographer | the mapper | turns bus signal → roadmap → suggestibility |
| coast guard / pd-cutter | safety + access | sandboxes + the §2 compulsion |
| tube / notes / channels | the comms | **the bus** voyages must use |
| roadmap item | intent | a voyage's destination |
| pd-tui | terminal renderer | the console's **always-on/SSH face** |
| pd-console | GPU renderer | the console's **rich (GPUI) face** |
| signal value / budget boxes | dead UI | replaced by the **Ledger** (cost intelligence) |

There is **one console** with two renderers (terminal + GPU), one noun (voyage),
one workspace (harbor), one comms fabric (bus), one safety/access layer (Coast
Guard), one intelligence loop (cartographer → suggestibility). Nothing else to learn.

---

## 4. Encrypted — "my data and activity, super-fucking encrypted"

The recording/transcript hazard the operator flagged is answered here, structurally:
- **Envelope crypto over the substrate** (PD already has ProVerif+TLA⁺-verified
  envelope crypto): notes, tuples, transcripts, harbor data — encrypted at rest and
  in transit. Keys keychain-backed; per-actor.
- **Recordings are demo-world-only + redacted** (the security gate already on the
  bus): the isolated seeded daemon, never real operator sessions; a hard redaction
  gate on anything committed.
- **Remote harbors** ride the same envelope — a remote harbor is just an encrypted
  bus endpoint; your code/activity never travels in clear.
- Principle: **PD should know what HAPPENED (encrypted, attributable) without your
  activity being readable by anyone but you.** Coordination signal ≠ surveillance.

---

## 5. Cooperative vibe coding + remote harbors (fall out of the model)

- **Cooperative vibe coding** = multiple voyages (and you) in one harbor, the bus
  carrying turns, the Coast Guard enforcing fair play (claims, rebase, no steamroll).
  The console multiplexes the conversations; the cutter keeps them from colliding.
- **Remote harbors** = a harbor on another machine, reached over the encrypted bus.
  Same voyages, same console, same Ledger — the work just isn't local.

---

## 6. What this means right now

1. **pd-console + pd-tui are ONE console, two faces** — not a decision to agonize
   over. Shared engine (the backend-agnostic, on-bus, OKLCH multiplexer just built
   in `core/pd-console`), two renderers. Reconciled.
2. **The compulsion (§2) is the next real build** — wire "commit ⇒ note publish ⇒
   keep sandbox" into the Coast Guard, so coordination is enforced, not hoped for.
3. **The console (V11) is the surface** for all of it — voyages, Ledger, the living
   harbor, the conversation multiplexer — fast and sleek, the locked Editorial /
   OKLCH / General Sans design.
4. **Encryption is a substrate invariant**, applied before any remote/recording
   feature ships.

This doc is the map. The console spec (PR #274) is how the surface looks; this is
why every part exists and how they're one thing.

---

## 7. What collapses — and what gets DELETED

Operator rule, updated 2026-06-05: *never-delete is demote-by-default, BUT you may
**delete** a thing once its value is merged into its near twin.* Consolidation is
the licensed exception. Each collapse below: merge the good parts, then delete the
husk — **after** coordinating on the bus (the fleet is live; no solo deletions of
code another voyage owns).

| Redundant set | Collapse to | Fate of the twin |
|---|---|---|
| `pd-console` + `pd-tui` | ONE console: shared engine (the on-bus, backend-agnostic, OKLCH multiplexer) + two renderers (GPU + terminal) | merge engines; **delete** whichever crate becomes the empty shell — coordinated with the pd-tui lane |
| `signal-value` box + `budget` box (fleet-ui) | the **Ledger** (cost intelligence) | **delete** both — fully superseded |
| broken Editor / Finder / Open buttons (local-path bug) | native console open (correct, global) | **delete** the broken handlers |
| dead/legacy fleet-ui surfaces (cockpit islands, metrics.html, etc.) as the console lands | the V11 console panes | **delete** as each is replaced + verified |
| overlapping launch nouns in docs/help | **voyage** + the launch verbs as aliases | keep the verbs (wanted); **delete** the redundant *concept docs* that describe them as separate systems |
| duplicate daemon-talk / config paths (the kind PR #261 already killed) | the one canonical helper | **delete** stragglers; CI guard already enforces |

Not deleted (genuinely distinct, not twins): dispatch/nightshift/spawn/sortie as
*entry verbs* (different when/review), cartographer, the Coast Guard, the bus.
Those are parts of the one model, not redundancies.

**Sequencing:** each collapse is its own coordinated PR — merge value, verify, then
delete, with a bus note. The compulsion (§2) means every such commit publishes its
note anyway. No big-bang; no solo deletion of live-fleet surfaces.
