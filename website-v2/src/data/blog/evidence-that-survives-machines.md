# Evidence That Survives Multiple Machines

You open last week's harbor on your other laptop — the desktop did the work, this machine is just looking — and you want to confirm a settlement happened the way the receipt claims. The receipt says it did. But the only thing that *knows* is a SQLite database on a machine that is currently asleep in another room. This laptop cannot check the claim. It can only believe it. That is the moment a note that only one machine can verify reveals itself as half a record.

The original Bonded Commons paper said "Merkle root commits to the evidence trail" and treated that as enough. For one daemon, it is. For two, it is not --- and the moment you have a laptop, a desktop, and a CI runner all touching the same project, you have two daemons. The v2 paper reworks §4.2 to close that gap, and adds a new §4.3 that does something the original was silent on: it makes coordination signals revocable without erasing them. Both changes pull in the same direction --- evidence you can carry to another machine and still verify.

![Evidence portable across three machines — a laptop, a desktop, and a CI runner each holding a short signed proof they can check without phoning home to the daemon that wrote it](/img/generated/blog-map-truth.jpg)

## What "Immutable" Was Quietly Missing

Bonded Commons §4.2 (v1) said three things about Merkle-chained evidence:

- It is tamper-evident.
- It commits to the full trail.
- It enables decentralized verification.

The first two are true with a single daemon and a single SQLite database. The third was a promise the paper never developed. The reason is mundane: there was nothing to verify across daemons, because there was only one daemon. Once Port Daddy supports a fleet that spans your laptop, your desktop, and a CI machine --- which it already does in practice --- you need a way for an auditor *without* database access to verify that a particular note was in a particular session, using only a short proof.

That auditor might be:

- You, on a new machine, looking at last week's harbor.
- A teammate, validating that a settlement actually happened the way the receipt claims.
- Your security team, spot-checking what an agent did under a Float Plan with `db:write`.
- A CI pipeline, gating a merge on whether the agent that produced the change actually had the bond it claimed.

None of those parties should need to trust a specific machine.

## The Merkle Forest

The v2 §4.2 commits to a three-level structure:

- **Note chain.** Same as v1: each note hashes the previous, the session commits to the last hash.
- **Session root.** All note hashes get assembled into a Merkle binary tree per session.
- **Harbor root.** All settled session roots in an epoch (per-settlement, or hourly) get assembled into a *harbor Merkle tree*, signed by the daemon's Ed25519 key.

The collection of epoch harbor roots is a Merkle *forest* --- one tree per epoch.

Drawn out, the structure is:

```
Note chain (per session):
  h_1 = H(n_1)
  h_2 = H(n_2 || h_1)
  ...
  h_k = H(n_k || h_{k-1})        ← session note commitment

Session tree (per session):
                R_session
              /          \
           m_12          m_3?
          /    \        /    \
        h_1    h_2    h_3   ...

Harbor tree (per epoch ℓ):
                R_harbor,ℓ                  ← signed by daemon
              /            \
        R_session_a    R_session_b   ...

Forest: { R_harbor,1, R_harbor,2, ..., R_harbor,ℓ }
        each witnessed to the KMS
```

To prove that a specific note belonged to a specific session in a specific harbor, the daemon emits ~700 bytes: the note inclusion path (`O(log k)` where `k` is the session's note count), the session inclusion path (`O(log N)` where `N` is the epoch's session count), and the signed root.

A light client verifies it with three signature checks and `O(log k + log N)` hashes. The verifier needs only the daemon's public key (bootstrapped via the Anchor Protocol) and the proof itself.

```typescript
interface InclusionProof {
  notePath: Hash[]      // O(log k) siblings up to R_session
  sessionPath: Hash[]   // O(log N) siblings up to R_harbor_ℓ
  harborRoot: Hash      // R_harbor_ℓ
  signature: Ed25519Sig // daemon's signature over harborRoot
  daemonPubKey: Hash    // bootstrapped via Anchor
}

function verify(note: Note, proof: InclusionProof): boolean {
  let acc = sha256(note.bytes)
  for (const sib of proof.notePath)    acc = sha256(concat(acc, sib))
  for (const sib of proof.sessionPath) acc = sha256(concat(acc, sib))
  return acc === proof.harborRoot
      && ed25519.verify(proof.daemonPubKey, proof.harborRoot, proof.signature)
}
```

In product terms: a settlement receipt becomes self-contained. You can hand it to your auditor or your CI pipeline and they can verify it was real, without asking your daemon, without trusting your SQLite, without running anything more privileged than a hash check.

## The KMS Witness

A daemon could still equivocate --- publish two different harbor roots for the same epoch to different parties. v2 closes that hole by witnessing each `R_harbor,ℓ` to a Key Management Service running the Certificate Transparency pattern.

The KMS:

- Enforces append-only monotonicity. A daemon cannot replace a witnessed root.
- Periodically publishes a signed tree head over all witnessed roots.
- Lets auditors run consistency proofs across tree heads, detecting equivocation.

The paper deliberately does not name a vendor. v2 specifies the KMS by *properties* --- five of them, the Definition of Admissible KMS in §7.1 --- and any service meeting those properties is admissible: a Cloudflare Worker, an HSM, a self-hosted Tang server, a paranoid in-house implementation. Vendor choice belongs in design docs, not in the protocol.

An auditor checks consistency between two signed tree heads issued at different times to detect equivocation:

```
STH_t1 = (root_t1, signed by KMS at time t1)
STH_t2 = (root_t2, signed by KMS at time t2 > t1)

consistency_proof(STH_t1, STH_t2):
  reconstruct root_t1 from a subset of root_t2's leaves
  if the reconstruction matches: KMS has not equivocated
  if it does not match: published proof of misbehavior
```

For the product, the KMS buys you:

- **Cross-machine audit.** A user on a new machine can verify historical work against the witness without restoring a SQLite database.
- **Freshness guarantees.** No more "is this PDF the latest version?" --- the witness tells you.
- **Third-party inspection.** A security team can fetch witnessed roots directly without touching internal daemons.

## Mutable Signals on an Immutable Substrate

§4.3 (new in v2) is the part that surprised me when I wrote it. Stigmergic coordination borrowed pheromones from biology, where they are accumulate-only --- ants deposit, the environment evaporates. Software agents need more: coordination signals must be revocable, renamable, and provenance-attributable as understanding evolves.

What v2 commits to is a dual:

- The **view** is mutable. A pheromone can be revoked, renamed, forked into a new namespace.
- The **substrate** is immutable. Every change is itself an event. The event ledger is monotone.

So an agent that sprays a hint, later realizes the hint was wrong, and revokes it has not erased anything. The hint, the revocation, and the reasoning are all in the chain. A consumer that read the hint at time `t` and later discovers a revocation timestamped `t' < t` can compute the correct counterfactual view by replaying events.

This matters for the product: notes and tuples can become richer without becoming dangerous. Today, the rule is "notes are immutable --- once written, they cannot be edited or deleted." That rule is correct for audit but blunt for coordination. With the mutable-signal ledger, the public record is *"this note was deposited; this revocation was deposited; the current view is the diff."* You get retraction without rewriting history.

![The harbor surface in FleetBar with a retract affordance on a note — retraction appends a revocation event and updates the public view while the original signal stays in the chain for audit](/img/app-screens/shipwright-harbor-light.webp)

## What This Lets the Product Do

Concrete things that become possible once the forest is built:

1. **Portable settlement receipts.** Every settlement emits a receipt with the inclusion proof embedded. You can hand it to anyone with the daemon's public key and they can verify it was real.
2. **Cross-daemon harbor membership.** A user with two laptops can have both of them verifying a single harbor's evidence without picking a "primary" machine.
3. **Light-client auditors.** A CI pipeline can verify that a merged PR was produced by an agent with a properly bonded Float Plan, without running a Port Daddy daemon. A 700-byte proof, three hashes, a signature check.
4. **Pheromone retraction in the UI.** The activity feed gets a "retract" affordance for notes and tuples that does the right thing: it appends a revocation event, the public view updates, the original signal is preserved for audit.
5. **No more "oops" support tickets that require database surgery.** Today, fixing a bad note means an admin reaching into SQLite. The mutable-signal ledger gives operators a sanctioned, auditable retraction path.

## The Honest Limit

None of this makes evidence indestructible. If you lose your passphrase *and* your old machine, harbor session keys wrapped only for that pubkey cannot be recovered --- this is the price of zero-knowledge at-rest encryption. The paper documents that limit explicitly in §7. I'm not going to pretend it away. The opt-in Shamir escrow mode (`t`-of-`n` secret sharing across the KMS, email, and recovery contacts) is there for users who want stronger recovery at the cost of giving up some of the zero-knowledge property.

Cross-machine evidence is a feature you opt into. The default for solo developers stays single-daemon. The forest exists to make multi-machine usage *honest*.

For the identity side of multi-machine usage --- how a passkey on a new device unwraps the keys without exposing them to the daemon you bought it from --- see [the federated-sovereign post](/blog/passkey-identity-across-machines).
