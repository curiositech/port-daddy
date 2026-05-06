# Red-team / White-hat Cadence

How adversarial review of the Bonded Commons + Anchor Protocol whitepapers
runs as a recurring, paper-versioned activity.

## One round at a glance

```
   v(N).0                              Phase 1                 Phase 2
   ─────                              ─ATTACK─                ─DEFEND─
   paper       ┌── Gate A ──┐    ┌────────────────┐    ┌────────────────┐
   today       │ open round │ -> │ red attacks,   │ -> │ white answers, │
              │ derive keys │    │ in sealed      │    │ in sealed      │
              └─────────────┘    │ redteam-review │    │ whitehat-      │
                                 │ namespace      │    │ defense        │
                                 │ (~1 wk)        │    │ namespace      │
                                 └────────────────┘    │ (~1 wk)        │
                                          │           └────────────────┘
                                          ▼                   │
                                  ┌── Gate B ──┐               ▼
                                  │ seal +      │       ┌── Gate C ──┐
                                  │ deliver     │       │ publish    │
                                  │ to defense  │       │ dialogue + │
                                  └─────────────┘       │ paper bump │
                                                        └─────────────┘
                                                              │
                                                              ▼
                                                        v(N+1).0
```

## Cadence: monthly, not continuous

A round is **one month**. Continuous adversarial review burns out the
defenders and produces shallow attacks. A month gives the red side time to
write real ProVerif/TLA+ models, the white side time to mechanize the
counter, and the lead time to assemble a real dialogue artifact.

| Phase            | Duration | Cadence within month                                        |
|------------------|----------|-------------------------------------------------------------|
| Gate A           | 1 day    | First Monday of the month, 09:00 PT                          |
| Phase 1 attack   | 10 days  | Red personas claim, probe, post sealed smells                |
| Gate B           | 1 day    | Lead seals + delivers; cleartext never lands on disk         |
| Phase 2 defense  | 10 days  | White personas claim smells, ship counters + proofs          |
| Gate C           | 1 day    | Lead assembles dialogue, bumps paper, publishes              |
| Reflection       | 7 days   | Public commentary; reading list; next-round target nominees |

Skip-a-round is allowed (no attacks survived peer review, paper unchanged)
but not silently — the audit log records "no semantic delta" with the
lead's signature.

## Versioning rule

A round produces a paper version bump iff the dialogue artifact actually
changes the paper. No paper text change → no version bump. The mapping:

| Round outcome                                                        | Paper bump  |
|----------------------------------------------------------------------|-------------|
| New theorem, lemma, or §                                            | minor (v2.1 → v2.2) |
| Added security assumption / scope clarification                     | minor               |
| New mechanization artifact closes a previously-informal claim       | minor               |
| Fixed a real bug in a paper claim                                   | patch (v2.1 → v2.1.1) |
| Tightened a parameter or threat-model phrasing without changing claims | patch         |
| No semantic delta                                                   | none, audited     |

Major bumps (v2 → v3) are reserved for re-architectures, not adversarial
rounds. The lead may declare a major bump out of band when a security
event or external publication forces a structural change.

## Carry-overs

Smells without a counter this round carry to the next round's target list,
with explicit reason. The carry-over is in the dialogue artifact under
`carried[]`, and the next Gate A re-spawns the smell as part of the open
manifest. Reasons that show up legitimately:

- "needs filter saturation harness — proof-completer is occupied with §7.x"
- "depends on Youle's pending Pareto-dominance proof — defer until §8.4 lands"
- "scope-bump required — defer until lead approves expanded threat model"

## Reputation + bonds

- Each smell posts a bond proportional to claimed severity.
- Theatrical findings (smell that does not survive review) slash.
- Real findings (smell the white-hat fleet must answer) accrue red
  reputation. Higher reputation raises the bond ceiling and the impact
  weight on the next round's target list ranking.
- Each counter posts a bond proportional to the smell it answers.
- A counter the red side accepts (no challenge in N+1) accrues white
  reputation. A counter that breaks in N+1 slashes hard.
- The lead's own bond is on the *round outcome* — if the round
  produced no real exchange (a flat round), the lead's reputation
  decays even though no one was caught lying.

## Tooling state at v2.1 (this round)

| Toolkit                | Installed | Version           |
|------------------------|-----------|-------------------|
| ProVerif               | yes       | 2.05              |
| Tamarin                | no        | -                 |
| TLA+ tools (TLC)       | yes       | tla2tools current |
| Apalache               | yes       | 0.47.2            |
| Kani                   | yes       | 0.67.0            |
| Z3                     | yes       | 4.15.4            |
| EasyCrypt              | yes       | recent opam       |
| Lean                   | no        | -                 |
| Mesa (agent-based sim) | yes       | (Python)          |
| graphviz               | yes       | 14.x              |

Lean and Tamarin land before v2.3 if any counter requires them.

## Visualization layer

Each round produces:

- `docs/shipwright/dialogue-v(N)-to-v(N+1).md` — human-readable artifact
- `docs/shipwright/dialogue-v(N)-to-v(N+1).json` — machine-readable, fed
  into the website changelog page
- `docs/shipwright/proof-audit-v(N+1).md` — gap status snapshot
- A coverage heatmap (paper § × class) showing where smells/fixes hit
- A reputation ledger (per persona) updated atomically at Gate C

The website changelog page renders the JSON with a timeline + per-class
filter. Operators get a one-glance view of paper state.

## Bootstrapping in v2.1

Round 1 is non-standard because the personas didn't exist at v2.0 — there
was no `redteam-review` project to attack from. The bootstrap procedure:

1. The pre-existing 17 issues (7 proof gaps + 10 attacks) the human authors
   already enumerated are entered as v2.1 smells, signed by the human
   author identity (not by red personas).
2. White-hat personas spawn for Phase 2 normally, claim smells, ship
   counters. The audit log records this as "round v2.1 — bootstrap".
3. Round 2 onward (v2.2) runs the full cadence.
