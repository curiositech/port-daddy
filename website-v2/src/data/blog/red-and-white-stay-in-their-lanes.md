# Red and White Stay In Their Lanes

A whitepaper sits in the repo. Someone proofread it once, a reviewer nodded at it, and then it ossified. Section 4.2 still says "[the Merkle Forest binding holds](/blog/evidence-that-survives-machines)" in a tone of finished confidence, and nobody in the building is paid a single cent to wake up tomorrow and try to break that sentence. The claim is true the way a bridge is sound right up until the morning a heavier truck drives across it.

That is the quiet rot we set out to stop. The two papers that govern Port Daddy's economic and cryptographic claims --- the Bonded Commons whitepaper and the Anchor Protocol whitepaper --- now have a permanent adversarial-review apparatus around them: a standing attacker fleet and a standing defender fleet, both persisted as reusable skills, and one mechanized property that keeps the whole thing honest. Neither fleet can read the other's work in progress. The rest of this post is what that costs, why we paid it, and what shows up in the changelog month over month.

![Two sealed glass-walled war rooms side by side, red attackers on the left, white-hat defenders on the right, with a single signed gate as the only passage between them](/img/generated/blog-map-truth.jpg)

## The premise

A whitepaper makes claims. Some claims are formal --- "ProVerif confirms" or "we prove" or "by induction." Most claims are informal: a paragraph of careful reasoning, an appeal to a citation, a "we assume the daemon is non-equivocating." Both kinds rot if no one is paid to challenge them.

Adversarial review answers that pressure with personas:

- A **red-team fleet** of five attackers, each focused on one class: cryptographic primitives, mechanism-design economics, coordination substrate, recovery surface, and a cross-cutting proof-gap auditor.
- A **white-hat fleet** of six defenders. Five mirror the red side; the sixth is `sec-eng-lead`, the round coordinator.
- A monthly **round** that opens with `sec-eng-lead` deriving fresh fleet keys, runs ten days of attack inside a sealed namespace, ten days of defense inside a different sealed namespace, and closes with a published dialogue artifact and a paper version bump.

The personas live as Markdown specs in the repo (`skills/redteam-review/agents/`, `skills/whitehat-defense/agents/`). Each spec names the persona's target paper sections, its toolkit (ProVerif, Tamarin, TLA+, Apalache, Kani, EasyCrypt, Z3, agent-based market sims), the structured shape of every probe or counter, and the persona's bond. They are real specs intended to drive real agent runs --- not slide-deck personas.

## Why isolation matters

Adversarial review fails when the attacker can see the defender's mitigation sketches. It also fails when the defender can pre-empt attacks they were told about informally. Both biases destroy the epistemic value of the round. Everyone knows this --- responsible-disclosure embargoes exist because of it, capture-the-flag competitions enforce it, external pentests literally call it "rules of engagement." We had to reproduce it inside the daemon.

The naive way is to use namespaces and ACLs. Red-team agents in the `redteam-review` project, white-hat agents in `whitehat-defense`, the daemon refuses cross-namespace reads. That's the perimeter. It's not enough.

A perimeter falls to a buggy ACL change, an operator with read access to the SQLite file, a debug dump shared with an auditor, a backup left on disk. If the only thing keeping red and white apart is the daemon's say-so, then the daemon becomes a single point of trust that the whole adversarial-review process leans on.

So we built the second layer.

## The crypto layer

`sec-eng-lead` holds an Ed25519 root key in the OS keychain. Every round, the lead derives two symmetric keys via HKDF: one for `redteam-review`, one for `whitehat-defense`. The derivation is rotated per round (a fresh salt is emitted in the round-open audit event) and per fleet, so a leaked key from one round does not retroactively unseal previous rounds.

Every note, message, and pheromone payload posted into a fleet namespace is encrypted under that fleet's key before it reaches the daemon. The daemon stores ciphertext only. Tags stay public --- they have to, so routing works and the audit log is legible --- but the contents are sealed.

The encryption is AES-256-GCM with associated data binding the project, namespace, and round into the AEAD construction. This matters: even if both keys leak (say, an operator who is on both fleets accidentally derives both, which the orchestration scripts refuse to allow), a payload encrypted for `redteam-review/v2.1` cannot be decrypted as if it were for `whitehat-defense/v2.1`. The AD is wrong; the AEAD authentication tag fails. That is defense in depth: the namespace boundary is enforced by cryptography, not just by routing.

Persona processes hold one fleet key, in their own keychain entry, scoped to their fleet. The lead is the only entity that holds both, and only at the three explicit gate moments per round. Every other moment, the daemon and the personas are mutually opaque.

```ts
// lib/coordination-crypto.ts (excerpt)
export function encryptEnvelope(payload, opts) {
  const fleetKey = loadFleetKey(opts.fleet, opts.round);
  if (!fleetKey) {
    throw new Error(`persona "${opts.signedBy}" cannot encrypt for ` +
      `${opts.fleet}/${opts.round.round}: not authorized for this fleet/round.`);
  }
  const ad = buildAd({ fleet: opts.fleet, project: opts.project,
                       round: opts.round.round, ts });
  const ct = aeadEncrypt(payload, fleetKey, iv, ad);
  return { key_id, iv, ct, tag, ad, ts, signed_by, sig, v: 1 };
}
```

## The proof

We [modeled the property in ProVerif](/blog/the-macaroon-gate). The daemon is the Dolev-Yao adversary --- it controls the public channel, can read every ciphertext, replay them, drop them, write its own. It does not hold either fleet key. The personas hold one fleet key each plus their own signing key. `sec-eng-lead` holds both fleet keys plus its own root.

Three queries:

```
RESULT not attacker(red_msg[]) is true.
RESULT not attacker(def_msg[]) is true.
RESULT inj-event(DefenseLearnsRed(x)) ==> inj-event(LeadEmitsToDefense(x)) is true.
```

The first says no message a red-team persona sends in Phase 1 is derivable by the daemon. The second says no message a white-hat persona sends in Phase 2 is derivable by the daemon. The third is the central claim: any red plaintext that the white-hat fleet eventually learns must have been emitted by `sec-eng-lead` at Gate B. There is no direct red-to-white forgery path the daemon can construct.

ProVerif checked all three under the symbolic model. The artifact lives at `whitepaper/formal/proverif/coordination/isolation.pv`, the run log next to it. Anyone can re-run them with `eval $(opam env) && proverif whitepaper/formal/proverif/coordination/isolation.pv`.

![ProVerif treats the daemon as a Dolev-Yao adversary holding every ciphertext but no fleet key, so the only path from red plaintext to the white-hat fleet runs through sec-eng-lead at Gate B](/img/generated/blog-coordination-guard-policy.jpg)

## What this lets us do

For the first round under this apparatus, we converted the seventeen open issues that the human authors had already enumerated --- seven proof gaps and ten attacks --- into structured smells, routed them to white-hat personas, and produced staged or landed counters for each one. The dialogue artifact is `whitepaper/reviews/archive/shipwright/dialogue-v2.0-to-v2.1.md`. Notable moves:

- Bonded §4.2 (Merkle Forest binding) had an informal claim that assumed the daemon's signing key was uncompromised. The counter narrowed the claim to "binding under non-equivocating daemon OR honest KMS witness," and the paper now says so explicitly. This is not a fix --- it is honesty about what the proof actually established.
- Bonded §4.3 (pheromone retraction race) had no specified conflict-resolution rule. The counter specified "highest-bond-wins, tie-break by signature hash" and a TLA+ artifact target.
- Bonded §7 (same-user adversary) had a single-line exclusion. The counter expanded it to a three-tier table covering UID-read, UID-spawn, and Keychain-API access, with explicit per-tier scope.
- Bonded §9.2 (distress-class abuse) had no concrete blast-radius bond ceiling. The counter specified one per enum value and committed to a TLA+ model in v2.2.

A round that produces a real paper-text change earns a version bump. Round v2.1 produced eight paper-text changes plus a registry of mechanization gaps that future rounds will close one by one.

## What this does not solve

Three honest gaps:

- **Side channels.** Tag taxonomy is public. An attacker who watches when red personas write, how often, and which tags they touch can infer activity. The taxonomy was designed to be public-tolerant (the smell schema is `<class>:<subclass>:<paper>:<§>:<id>`), but cardinality leaks remain.
- **Compromised personas.** If a red persona's process is itself compromised, its fleet key leaks. Defense at that layer is per-process hardening, not the comms layer. The orchestration scripts refuse to spawn a persona that can also load the opposing fleet's key, but they cannot defend against a process that lies after spawn.
- **Compromised lead.** If `sec-eng-lead`'s keychain is breached, the round is compromised. The mitigation is rotation: per-round HKDF salt, annual root rotation, and an audit chain that external observers can verify retroactively.

We document those gaps where they live. The point of running adversarial rounds is to surface gaps; pretending we have closed all of them on day one would defeat the exercise.

## What an operator should expect to see

Once a month, a new entry on the changelog page. Each entry links to a dialogue artifact (the smells and counters), an updated paper PDF, an updated proof-audit document (which cited claims now have artifacts vs. which are still informal), and a short blog post like this one summarizing what changed.

If the round produced no semantic delta --- nobody landed a real attack, nobody closed a real proof gap --- the changelog still has an entry. It says "no semantic delta" with the lead's signature, and the audit chain proves the round happened in the right order. Silence is not allowed; "no change" is allowed if it is signed.

## What an operator should do

Nothing, unless you operate a fork of the papers or want to contribute a smell. The personas live in this repo's `skills/` tree; the orchestration scripts live in `skills/{redteam-review,whitehat-defense}/scripts/`. To run your own private round, derive your own root, run the open/seal/publish sequence, and replace the personas with your own focus areas.

```bash
skills/whitehat-defense/scripts/run-secops-lead.sh open v3.1
skills/redteam-review/scripts/run-redteam.sh v3.1
# ten days later
skills/whitehat-defense/scripts/run-secops-lead.sh seal v3.1
skills/whitehat-defense/scripts/run-whitehats.sh v3.1
# ten days later
skills/whitehat-defense/scripts/run-secops-lead.sh publish v3.1
```

If you want to contribute a smell to the canonical Port Daddy rounds, the entry point is the changelog page on the website (the next round opens 2026-06-01). Bring a probe and a bond.

## What we are still deferring

We have a long list of mechanizations the next round will land. The high-priority ones are the Conservation Theorem TLA+ spec, the No-Overdraft Lemma Kani harness on `lib/bonds.ts`, and the passkey-pairing ProVerif model. Each is a real artifact obligation, not a marketing promise. The proof-completer persona carries them as standing target gaps; if they aren't closed in v2.2, the persona's bond slashes.

Adversarial review is not a feature you ship and walk away from. It is a recurring cost the project pays to keep its papers honest. We are paying it now, on the cadence in `docs/shipwright/REDTEAM-WHITEHAT-CADENCE.md`, and the dialogue artifacts will accumulate in `docs/shipwright/dialogue-*.md`. If a future round catches us shipping a counter that does not survive its next probe, the persona that signed it slashes. If it catches the lead writing a lazy round outcome, the lead's reputation slashes too.

The papers will get more honest, or the apparatus that proves they're getting more honest will get less honest. Either way, you'll see it in the changelog.
