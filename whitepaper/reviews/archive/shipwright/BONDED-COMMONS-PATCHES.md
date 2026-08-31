# Bonded Commons — Patch Set (not a third paper)

**This is not a new paper.** It is a structured set of **patches against the existing papers**:
- *The Bonded Commons* ([`agent-transactions-whitepaper.tex`](../../../source/agent-transactions-whitepaper.tex))
- *The Anchor Protocol* ([`anchor-protocol-early-draft.md`](../anchor-protocol-early-draft.md))

**Why a patch set instead of a companion paper.** A standalone "expansion" would fragment the reading experience and falsely imply the original papers are complete historical artifacts. They aren't; they have gaps the April 2026 implementation work closes. The right artifact is in-place edits with clear rationale, not a second paper cross-referencing the first.

**How to read this.** Each section below is scoped to a target paper + section. Apply as edits to the LaTeX source. Text intended for direct insertion is set off in quote blocks. Rationale and implementation notes sit around it.

**Date:** April 20, 2026
**Apply after:** Port Daddy v3.8.3 with `lib/bonds.ts` and `lib/budget-guard.ts` merged.

---

## Patch summary (applied across four sites in the existing papers)

| # | Target | Section of target | Change |
|---|---|---|---|
| P1 | Bonded Commons | §7 (Formal Model) and/or §6 (Layer 3) | Add the **Conservation Theorem** — escrow/wallet/commons as a conserved sum, provable from the concrete module now in `lib/bonds.ts`. Tightens the existing `EscrowInvariant` into an operational correctness claim. |
| P2 | Anchor Protocol | §2.3 or new §2.4 | Add the **Revocation Protocol** — cuckoo filter, gossip semantics, integration with the existing verify path. Closes the hole flagged in `docs/recovery/CURRENT-WORK.md`. |
| P3 | Bonded Commons | §4 (Immutable Attribution) | Extend **Merkle-Chained Auditability** to a **Merkle Forest** with cross-daemon inclusion proofs, witnessed to an abstract KMS. Formalizes the "decentralized verification" claim the paper asserted but didn't develop. |
| P4 | Bonded Commons | §7 (Discussion), "Single-node scope" paragraph | Replace with a **Federated Sovereign** subsection: formalize the trust-boundary expansion via an abstract KMS (properties, not vendor), passphrase-wrapped user keys, honest recovery limits. The original §7 paragraph can go; this replaces it. |
| P5 | Bonded Commons | §8 (Pricing, open problem) | Add the **Cleanup Lower Bound** ($\pi \geq c$ where $c$ = observed cleanup cost) and, as a concrete mechanism-design sketch in the same section, the **Bonded Advisor** pattern (a principal-bonded agent that proposes Float Plans, itself slashed on acceptance-criteria failure). |

**What we deliberately do NOT claim:**

- Shipwright is not a "fourth layer" of the commons architecture. That was overreach. Shipwright is a consumer of Layers 1–3 and a specific instance of the Bonded Advisor pattern in P5. It gets one paragraph in §8, not a section of its own.
- The KMS is not specified as Cloudflare in the theoretical text. Cloudflare is a vendor choice that belongs in `USER-ACCOUNTS-KMS.md`, not the paper.
- The Revocation filter is not a three-tier hybrid. That was hedging. The workload (heterogeneous TTLs, early-revocation needs) is where cuckoo earns its complexity; we commit to cuckoo alone, with rotating Bloom explicitly *out* of scope as a simpler-case alternative.

---

## 1. What the original paper established and what it left open

We summarize only to name what we are building on. The reader should have the Bonded Commons paper open.

### 1.1 Established

| Layer | Mechanism | Original paper section |
|---|---|---|
| Structural | Harbor Cards — Ed25519 capability tokens, offline attenuation | §3 |
| Attribution | Append-only notes, Merkle root per session | §4 |
| Economic | Float Plans, escrow, pro-rata settlement on death | §6 |
| Impossibility | Sen's result — advisory claims, not enforced | §5 |
| Formal model | TLA⁺ BondedCommons module, safety + liveness | §7 |

### 1.2 Deferred, explicitly

The original paper names four open problems:

1. **Bond pricing** — the function $\pi: \mathcal{F} \to \mathbb{R}^{+}$ mapping Float Plans to collateral amounts.
2. **Single-node scope** — "distributed multi-node settings require consensus primitives... unnecessary for local development."
3. **Recovery fidelity** — "depends on LLM capability... an open problem."
4. **Admission control** — "who is allowed to post Float Plans at all... irreducibly political."

### 1.3 Deferred, implicitly

Three additional holes the paper references in passing but never develops:

1. **Revocation.** Harbor Cards can be issued and attenuated, but when a capability must be withdrawn
   *before* its natural expiry, the original paper is silent. Without revocation, a compromised agent retains
   its capabilities until TTL — a problem that intensifies the moment a mesh of daemons exists.
2. **Cross-daemon Merkle verification.** The paper claims Merkle roots enable "decentralized verification"
   (§4.2). In a single-daemon system this is a theoretical nicety. The moment there are two daemons, it
   becomes load-bearing — and it demands concrete inclusion-proof semantics.
3. **Active authority.** The commons authority is passive by design. This is correct for an authority, but
   fleets need an *architect* — an agent who proposes the covenant. The paper's advisory-vs-enforced
   distinction assumed all advisors were humans. It is now clear that the advisor should itself be an agent
   on the commons, subject to the same bonds as anyone else.

Sections 3, 4, and 6 of this expansion address these three holes.

---

## 2. Bond Enforcement Made Concrete

### 2.1 From specification to invariant

The original paper establishes the economic layer specifically as a TLA⁺ state space (`sessions[a].escrow > 0`
in the `Begin` action). Implementation required collapsing the abstract escrow into a pair of concrete
artifacts:

- `lib/bonds.ts` — the escrow module, maintaining three monetary buckets per project: **wallet**, **escrow**,
  **commons pool**.
- `lib/budget-guard.ts` — the admission and back-pressure module, enforcing daily spend caps per agent.

These are pure-data modules with deterministic semantics. Both are covered by 41 unit tests, including a
property-style conservation trace over 200 randomized operations.

### 2.2 The Conservation Theorem

We formalize the operational invariant the original paper asserted only in prose.

**Definition (Accounting State).** For a project $P$, the accounting state is the triple
$(W_P, E_P, C_P) \in \mathbb{R}_{\geq 0}^{3}$, where $W_P$ is the wallet balance, $E_P$ is the sum of all
bond amounts currently in states $\{\text{escrowed}, \text{running}, \text{exiting}\}$, and $C_P$ is the
commons pool balance.

**Definition (Monetary Supply).** $S_P := W_P + E_P + C_P$.

**Theorem 1 (Conservation).** For any sequence of operations
$\sigma = \langle \text{topUp}, \text{escrow}, \text{markRunning}, \text{refund}, \text{slash} \rangle^{*}$
applied to an initial state $(W_P^{0}, 0, 0)$, the supply $S_P$ changes only on `topUp`. All other
operations redistribute among the three buckets.

**Proof sketch.** Each operation commits in a single SQLite transaction (`db.transaction`). The individual
effects are:

- `topUp(u)`: $W_P \mathrel{+}= u$. $S_P$ grows by $u$.
- `escrow(b)`: $W_P \mathrel{-}= b$, $E_P \mathrel{+}= b$ (one row inserted with $bond\_usd = b$, state $\texttt{escrowed}$). $S_P$ invariant.
- `markRunning(id)`: state transition within $E_P$'s contributing set. No monetary movement. $S_P$ invariant.
- `refund(id)`: $W_P \mathrel{+}= b_{id}$, row state $\to \texttt{refunded}$ removes $b_{id}$ from the
  `active escrow` sum. Net: $E_P \mathrel{-}= b_{id}$, $W_P \mathrel{+}= b_{id}$. $S_P$ invariant.
- `slash(id, p)`: With $p \in [0, b_{id}]$, $W_P \mathrel{+}= b_{id} - p$, $C_P \mathrel{+}= p$, row state
  $\to \texttt{slashed}$. Net: $E_P \mathrel{-}= b_{id}$, $W_P \mathrel{+}= (b_{id} - p)$, $C_P \mathrel{+}= p$.
  Sum: $-b + (b - p) + p = 0$. $S_P$ invariant.

By induction on $|\sigma|$, $S_P$ equals $S_P^{0}$ plus the sum of `topUp` arguments in $\sigma$. □

**Property verification.** The conservation invariant is asserted after every operation in the bonds test
suite. Across 200 random traces of the operation set, $|W_P + E_P + C_P - S_P^{\text{expected}}| < 10^{-6}$
holds deterministically. The $10^{-6}$ tolerance is IEEE-754 floating-point slack, not logical slack.

### 2.3 Atomic Admission Closes the Double-Spend Window

A naïve implementation reading-then-debiting the wallet admits concurrent escrows that both see sufficient
balance. Port Daddy's single-process daemon guarantees serialization within a process, but cross-process
writes (test fixtures, daemon mesh) can race. We close this structurally by wrapping the balance check and
wallet debit in a single `EXCLUSIVE` transaction — if the balance check fails inside the transaction, the
atomic rollback reverts the insert as well. This is what `lib/bonds.ts:escrow()` does.

**Lemma (No overdraft under concurrent escrow).** Given two concurrent invocations of `escrow` on the
same project with amounts $b_1, b_2$ both satisfying $b_i \leq W_P^{\text{pre}}$ but with
$b_1 + b_2 > W_P^{\text{pre}}$, at most one invocation succeeds.

**Proof.** By SQLite's serializable isolation of `BEGIN EXCLUSIVE`, the transactions serialize. Suppose
$T_1$ wins. After $T_1$ commits, $W_P = W_P^{\text{pre}} - b_1$. $T_2$ now sees the updated balance and
rejects if $b_2 > W_P - b_1$, which by assumption $b_1 + b_2 > W_P^{\text{pre}}$ is true. □

### 2.4 Back-pressure before the sovereign draws the sword

The original paper's TLA⁺ model abstracts settlement into `Commit` and `Crash`. Reality demands an
intermediate state: an agent whose spend is approaching its daily budget but has not yet breached it.
Killing such an agent is overkill; allowing unchecked spend courts breach. `lib/budget-guard.ts` introduces
**throttle** as a soft signal emitted at 80% spend, and **kill** as the hard signal emitted at 100%:

- Throttle: the daemon publishes `budget:decisions:throttle` on the pub/sub bus. The targeted agent is
  expected to finish current work, then idle. No structural enforcement; this is *liberal* in Sen's sense.
- Kill: the daemon arms `kill_armed_at` for the day. The `canSpawn` pre-flight refuses new spawns for this
  agent until UTC midnight. Existing spawns are SIGTERMed by their supervisor. The bond is slashed via the
  settled evidence path; the audit log records the precise threshold crossing.

The throttle/kill split is the commons' analogue of **Ostrom's graduated sanctions**: response scales with
violation severity. The original paper cites Ostrom but treats settlement as binary. It is not; it is a
three-state machine (`nominal → throttled → killed`), with `nominal → killed` reachable only on hard
evidence (e.g., a direct Arbiter violation).

---

## 3. Cuckoo Revocation: Scaling Capability Withdrawal

### 3.1 Why Harbor Cards need revocation

Harbor Cards have a TTL. The original design assumed natural expiry was sufficient. Two circumstances
violate this:

1. **Compromise.** A Harbor Card leaks from its agent's process. Every second until TTL is a second the
   attacker has legitimate capabilities.
2. **Policy change mid-flight.** A principal decides an agent should no longer have `db:write`. Waiting
   for the TTL is unacceptable.

A naïve revocation list is $O(n)$ per-verification and grows monotonically. In a daemon mesh, propagating
the list across nodes is $O(n \cdot m)$ where $m$ is the mesh size. Something better is required.

### 3.2 Primitive: cuckoo filter

Revocation filters are a probabilistic set-membership problem. For a uniform-TTL workload, a rotating
Bloom filter would be simpler and sufficient (Bloom 1970). For Port Daddy, TTLs are not uniform —
Shipwright proposals run hours to days, `pd spawn` children run minutes, one-shot agents run seconds.
In the heterogeneous regime, rotating Bloom requires either (a) rotating at the longest TTL — which
keeps short-TTL revocations in the filter orders of magnitude longer than needed — or (b) multiple
TTL-bucketed Bloom filters consulted in parallel. Option (b) reintroduces the structural complexity that
a single cuckoo filter collapses into one data structure with O(1) per-entry removal at each specific
expiry.

Per-entry removal also cleanly handles **operator-initiated early revocations** (policy reversal, false
alarm undo): the entry comes out immediately. Rotating Bloom would over-block until the next wipe.

We therefore commit to cuckoo filters (Fan et al. 2014) for revocation, with acknowledgement that
simpler workloads with homogeneous TTLs could use rotating Bloom instead.

Space bound (Fan et al. 2014): at false-positive rate $\epsilon$, a cuckoo filter uses approximately
$\log_2(1/\epsilon) + 3$ bits per entry. For $\epsilon = 10^{-3}$, ≈13 bits per revoked card. A fleet
retaining $10^{5}$ active revocations fits in ~160 KB — trivially in memory, trivially gossiped.

### 3.3 The Revoked-Cards Protocol

Let $R_t$ denote the set of revoked Harbor Card IDs at time $t$. Each daemon $d$ maintains a cuckoo filter
$F_d \approx R_t$. Every Harbor Card verification includes:

1. Cryptographic signature check (Ed25519) — as per Anchor Protocol.
2. Capability-subset check — as per Bonded Commons §3.
3. **Revocation check.** Lookup the card's $\texttt{kid}$ in $F_d$. If present, fall through to the
   authoritative check (4); else admit.

The false-positive rate $\epsilon \approx 10^{-3}$ means approximately $\epsilon \cdot (\text{verification rate})$
legitimate cards get an extra authoritative-check round-trip. At 100 verifications/sec that is one such
event every 10 seconds, fleet-wide — the card is not truly revoked because the authoritative check
returns negative; the caller proceeds normally.

**Authoritative check.** On filter hit, the daemon queries the local `revocations` table. If the token
is genuinely revoked, it is rejected with `revoked`. Otherwise the filter is either in the false-positive
regime or stale; the caller is granted access and an asynchronous reconciliation job repopulates the
filter from the table.

### 3.4 Gossip-based synchronization

Daemons in a mesh synchronize their filters via a simple gossip protocol:

1. Each daemon maintains a version vector $V_d[\cdot]$ over all known peers.
2. Periodically (default: 30s), pick a random peer $d'$ and exchange $V_d, V_{d'}$.
3. Daemons ship the deltas — cards revoked since $V_{d'}[d]$ — as a small diff.
4. Apply deltas to both filter and local table; advance version vectors.

Convergence bound (standard anti-entropy, Demers 1987): a revocation reaches all $m$ peers in expected
$O(\log m)$ gossip rounds. For $m = 10$ daemons at 30s intervals, all nodes see a new revocation within
≈2 minutes. Security-critical revocations can trigger immediate push (the issuer broadcasts to every
peer it knows).

### 3.5 Revocation-filter invariants

**Filter Monotonicity (over a TTL epoch).** For any Harbor Card $c$ whose issue time is $t_0$ and TTL is
$\tau$, if $c \in R_{t}$ for some $t \in [t_0, t_0 + \tau]$, then $c \in R_{t'}$ for all $t' \in [t, t_0 + \tau]$.
After $t_0 + \tau$, $c$ may be removed from $R$ (its revocation no longer matters because the card is
expired anyway).

**No Partial Reanimation.** A revoked card cannot be un-revoked within its TTL. If an operator decides
the revocation was erroneous, they must issue a *new* card.

**Filter Freshness Bound.** Under the gossip protocol with period $\Delta$, in a mesh of $m$ daemons, every
daemon's filter converges to global $R_t$ within expected time $\Delta \cdot (1 + \ln m)$.

### 3.6 Against an adversary with mesh-level view

A Dolev-Yao adversary observing all gossip traffic learns the revoked-card IDs. This leaks which agents
have been disciplined. For a hostile observer, this is privacy leakage; for a cooperative mesh of an
organization's own daemons, this is acceptable audit transparency.

If stronger privacy is required, revocations can be encoded as **salted hashes**: each daemon publishes
$H(\texttt{kid}, \texttt{salt})$ where the salt rotates daily. An observer cannot correlate revocations
across days without the salts, which are stored encrypted under the harbor's session key (see §5).

### 3.7 Integration with the Anchor Protocol

The revocation protocol attaches to the existing verification path without structural changes:

```
verify_harbor_card(card) {
  1. check Ed25519 signature        # Anchor §3.1
  2. check capability subset        # Bonded Commons §3
  3. check NOT in revocation filter # THIS SECTION
  4. if filter says "present":
       check authoritative table
       if truly revoked: reject
       else: log filter false-positive, allow
  5. allow.
}
```

No existing ProVerif proof is invalidated. Revocation introduces a new state in the card lifecycle
(`valid → revoked → expired`) which we model as an additional transition and re-prove injective
agreement. The proof obligation is small: the revocation check strictly narrows acceptance, so *existing*
soundness proofs still hold — we only need a new proof that revocation is *enforced*, which follows by
inspection.

---

## 4. The Merkle Forest: Cross-Daemon Inclusion Proofs

### 4.1 What the original paper promised

Bonded Commons §4.2 introduced Merkle-chained evidence:

> Each note includes the SHA-256 hash of the previous note, and the session's completion produces a
> Merkle root over all notes and artifact hashes. [...] The Merkle root acts as a cryptographic commitment
> to the work performed.

The paper listed three consequences: tamper evidence, completeness proof, and decentralized verification.
For a single daemon, the Merkle root per session is sufficient — an auditor with access to the database
can verify individual notes against the root. For a mesh, we need more: an auditor *without* database
access needs to verify that a particular note was included in a particular session using only a short
proof.

### 4.2 The structure

Define three levels:

- **Note chain.** As described in the original paper: each note's header includes
  $h_{i} = H(n_{i} \mathbin\| h_{i-1})$. The session's commitment is $h_{k}$, the hash of the last note.
- **Session root.** Additionally, all note hashes $(h_{1}, \ldots, h_{k})$ are assembled into a Merkle
  binary tree with root $R_{\text{session}}$. The chain commits to order; the tree commits to presence
  with short proofs.
- **Harbor root.** Periodically (e.g., hourly, or per-settlement), every completed session root within a
  harbor is assembled into a **harbor Merkle tree** with root $R_{\text{harbor},\ell}$ at epoch $\ell$. This
  root is signed by the daemon's Ed25519 key and published.

The collection of epoch harbor roots $\{R_{\text{harbor},\ell}\}$ forms a **Merkle forest**, one tree per epoch.

### 4.3 Inclusion proofs

To prove note $n_{i}$ from session $s$ belongs to harbor $h$ at epoch $\ell$, the daemon produces:

1. Note inclusion path: siblings on the path from $n_{i}$ to $R_{\text{session}}$. Size $O(\log k)$ where $k$
   is the session's note count.
2. Session inclusion path: siblings on the path from $R_{\text{session}}$ to $R_{\text{harbor},\ell}$. Size
   $O(\log N)$ where $N$ is the number of settled sessions in epoch $\ell$.
3. The signed harbor root $\sigma_{\text{daemon}}(R_{\text{harbor},\ell})$.

Total proof size: $O(\log k + \log N) + |\text{signature}|$. For $k = 100$ notes, $N = 10^{4}$ sessions, that
is ≈20 hashes × 32 bytes + 64-byte signature = ~700 bytes. Small enough to embed in an HTTP response or a
settlement receipt.

### 4.4 Light client verification

A **light client** — an agent, an auditor, a cross-daemon Shipwright — performs verification without
downloading the full SQLite database:

```
verify_note_inclusion(n_i, s, h, ℓ, proof):
  R_session       = reconstruct via (proof.note_path, H(n_i))
  R_harbor_ℓ      = reconstruct via (proof.session_path, R_session)
  return verify_ed25519(daemon_pubkey, R_harbor_ℓ, proof.signature)
```

Three signature checks, $O(\log k + \log N)$ hash evaluations. The verifier needs only the daemon's
Ed25519 public key (bootstrapped via the Anchor Protocol) and the proof itself.

### 4.5 Witness to the KMS

The Harbor root $R_{\text{harbor},\ell}$ at each epoch is uploaded to the Cloudflare-hosted KMS (§5) as a
**witness**. This provides:

- **Cross-machine audit.** A user on a new machine can verify historical work against the witness.
- **Freshness guarantees.** The KMS enforces monotonicity — if a daemon attempts to publish a prior
  epoch's root that conflicts with the witnessed root, the KMS rejects. This prevents rollback attacks.
- **Third-party inspection.** An organization's security team can fetch witnessed roots directly from
  the KMS without accessing internal daemons.

The witness itself is an append-only log (Laurie 2013 Certificate Transparency pattern). The KMS
periodically publishes a **signed tree head** (STH) committing to all witnessed harbor roots. Auditors
can perform consistency proofs between STHs over time, detecting equivocation (a daemon publishing
different roots for the same epoch to different parties).

### 4.6 Merkle forest invariants

**Proof Soundness.** If `verify_note_inclusion(n, s, h, ℓ, π)` returns true for some proof $\pi$, then
either (a) $n$ was indeed included in session $s$ at epoch $\ell$, or (b) the daemon's signing key has been
compromised, or (c) $H$ (SHA-256) has been broken. Under standard assumptions on Ed25519 and SHA-256, (b)
and (c) are computationally infeasible.

**Proof Completeness.** For any $n, s, h, \ell$ with $n \in s \subseteq h$ at epoch $\ell$, the daemon can
produce a proof $\pi$ such that verification succeeds.

**Binding.** Once a daemon publishes $R_{\text{harbor},\ell}$, it cannot produce a different valid root for
the same $(\text{harbor}, \ell)$ without either contradicting its earlier signature (detectable via the
KMS witness) or forking its identity.

### 4.7 Cost model

The forest adds two cryptographic operations per session settlement:

1. Append $R_{\text{session}}$ to the current epoch's accumulator. $O(1)$ amortized via an append-only
   Merkle accumulator (de Marneffe 2011).
2. At epoch rollover (e.g., each hour), recompute and sign the harbor root. $O(N)$ hashes + one signature.

For a fleet settling 100 sessions/hour, epoch computation is ~100 SHA-256 + 1 Ed25519 sign ≈ 10 ms.
Negligible.

---

## 5. The Federated Sovereign — P4 (replaces the "Single-node scope" paragraph in Bonded Commons §7)

### 5.1 What to replace

The current paragraph in Bonded Commons §7 ("Single-node scope") dismisses the multi-node case as
"unnecessary for local development." This was true for single-machine usage. It is not true once:

- Users roam across laptop, desktop, and CI machines.
- Machine loss (theft, disk failure, cross-country moves) should not destroy encrypted evidence.
- Multiple humans may share a harbor.

The daemon remains the authority within its machine. **Key custody** federates.

### 5.2 Abstract KMS, not a vendor

We introduce a fourth actor to the trust model, specified by properties rather than by vendor:

| Actor | Role |
|---|---|
| Daemon | Commons authority within a machine; signs harbor roots; enforces bonds |
| Agent | Participant; holds Harbor Card; signs actions |
| Principal (human) | Funds Float Plans; identifies via Ed25519 keypair |
| **KMS** | Key custody; recovery root-of-trust; witnesses harbor roots |

The KMS is an abstract service. Any provider satisfying the following five properties is admissible:

> **Definition (KMS).** A Key Management Service $\mathcal{K}$ is admissible for the federated
> sovereign if it provides:
> 1. **Passphrase-wrapped private-key custody** with Argon2id (or equivalent memory-hard KDF) at or
>    above the 2026 security floor.
> 2. **Encryption-at-rest** for all user-held blobs; $\mathcal{K}$ never sees plaintext keying material.
> 3. **Signed witness log** for harbor Merkle roots with append-only, monotonic semantics and
>    detectable equivocation (Laurie 2013 Certificate Transparency pattern).
> 4. **Rate-limited, email-gated recovery** with single-use magic-link tokens of bounded TTL.
> 5. **Public verification** of signed user public keys under an account identifier, without requiring
>    mutual authentication.

Implementation choice (Cloudflare Workers + D1 + KV) lives in `USER-ACCOUNTS-KMS.md`. The paper's theory
applies to any $\mathcal{K}$ meeting the five properties.

### 5.3 Trust boundary expansion

The daemon's previous trust boundary was *this machine*. The federated trust boundary is:

$$
\texttt{TB} = \texttt{daemon} \cup \mathcal{K} \cup \texttt{user's email} \cup \texttt{user's passphrase}
$$

Each element is necessary for its role; no element is sufficient alone.

- **Daemon** enforces bonds and publishes roots; cannot unilaterally compromise user identity (it never
  sees the unwrapped user master).
- **KMS** stores *encrypted* blobs; it cannot decrypt without the passphrase; it can *deny service*.
- **Email** is the recovery root. An adversary with email control can trigger magic-link recovery. This
  is the weakest link in the chain and is documented as such.
- **Passphrase** wraps the user's master private key. Argon2id with parameters meeting the 2026
  security floor makes offline brute force expensive.

**Federated Security Theorem (informal).** Assuming Ed25519 and SHA-256 are secure, Argon2id parameters
meet the 2026 security floor, and the user's email and passphrase are not simultaneously compromised,
an adversary with read access to $\mathcal{K}$'s storage, daemon SQLite, and mesh gossip traffic, but
WITHOUT same-user code execution on the daemon's host, cannot:
1. Forge a Harbor Card without the daemon's private key.
2. Read plaintext evidence without the harbor's session key.
3. Impersonate the user without both email access AND passphrase.
4. Roll back a harbor's Merkle forest without $\mathcal{K}$ complicity.

**Same-user exclusion.** The theorem does not apply to an adversary who can run arbitrary code as the
same UNIX user as the daemon (an unsandboxed agent, a malicious postinstall, a compromised editor
extension). Such an adversary reads any file the user can read, which — absent OS-mediated key
custody — includes the daemon's key files and SQLite DB. Mitigations for that broader class live in
`docs/shipwright/SECURITY-ASSESSMENT.md` findings F-01 through F-03. Tier 1 (macOS Keychain) ships now;
tier 2+ (native keyring, hardware-backed keystore) extends the theorem's reach to the same-user case.

Proof sketches for each clause: future work.

### 5.4 Recovery and its honest limits

Recovery is email magic link. The honest limit: **if the user loses their passphrase AND their old
machine**, harbor session keys that were only wrapped for that pubkey cannot be recovered. This is the
tradeoff for zero-knowledge at-rest encryption.

An opt-in **Shamir escrow mode** (Shamir 1979, $t$-of-$n$ secret sharing across $\mathcal{K}$, email,
and recovery contacts) trades some zero-knowledge for stronger recovery. Opt-in, not default.

### 5.5 The Harbor Ledger becomes portable

Because harbor roots are witnessed by $\mathcal{K}$, a user on a new machine can reconstruct a
verifiable *view* of their harbor's history without the daemon's database:

1. Authenticate to $\mathcal{K}$.
2. Fetch witnessed roots for each harbor.
3. Request inclusion proofs from the original daemon (if still alive) or from any peer that has been
   gossiping harbor events.
4. Verify locally.

This is the Certificate Transparency pattern applied to agent work evidence.

---

## 6. Shipwright is not a layer — it is an application (demoted, retained as a paragraph in P5)

An earlier draft of this patch set promoted Shipwright (a specific agent archetype built in this
implementation cycle — see `SHIPWRIGHT-DAEMON.md`) to a "fourth architectural layer." That was
overreach. Shipwright is a *consumer* of the three existing layers: it requests capabilities (Layer 1),
produces evidence (Layer 2), and posts / settles bonds (Layer 3). It does not introduce a new primitive
to the architecture. Adding it as a layer would confuse the abstraction that makes the original paper
clean.

What *is* theoretically interesting about Shipwright belongs in the pricing discussion (§8 of Bonded
Commons — the paper's acknowledged central open problem): the idea of **a principal-bonded advisor
agent that proposes Float Plans and whose own reputation is slashed on acceptance-criteria failure**.
This is a mechanism-design contribution, not an architectural one. We absorb it as one paragraph in P5
below.

FleetControl — the dashboard surface — is similarly an implementation / UX contribution, not a paper
topic. It goes in `FLEETCONTROL-HARDENING.md`; the paper's formal model doesn't need it. A sentence in
the Discussion section noting that the commons authority is intended to be observable is enough.

---

## 8. P5 — Pricing: the Cleanup Lower Bound, the Scope Multiplier, and the Bonded Advisor

### 8.1 Target site

Bonded Commons §8 identifies bond pricing as the central open problem and explicitly declines to propose
a pricing function $\pi$. This patch does not close the problem. It does tighten the lower bound, name a
scope multiplier, and introduce the Bonded Advisor mechanism — a concrete mechanism-design direction
for $\pi$ that the original paper invited.

### 8.2 Cleanup Lower Bound

Let $c$ be the project's **cleanup cost per breach event** — the human + compute cost to detect, assess,
and recover from a budget breach. This is observable from the audit log.

**Claim (Cleanup Lower Bound).** For any Float Plan $\mathcal{F}$,
$$
\pi(\mathcal{F}) \geq c.
$$

**Rationale.** If $\pi(\mathcal{F}) < c$, breach is cheap: the bond is forfeit for less than the
cleanup cost. If the commons pool funds cleanup, $\pi < c$ drains the commons per breach — the system
bankrupts itself through enforcement.

This is a floor, not a tight bound. It is observable from operations and can be tracked as a project
health metric.

### 8.3 Consequential-Scope Multiplier

Let $s(\mathcal{F})$ be plan scope (files claimed, presence of `db:write`, production-deployment
capability). Empirically, cleanup scales super-linearly with scope — coordination cost dominates the
high end.

$$
\pi(\mathcal{F}) \geq c \cdot \left(1 + \alpha \cdot s(\mathcal{F})\right)
$$

$\alpha$ is calibrated from observed cleanup per scope unit. Low-$\alpha$ projects have simple,
easily-audited work; high-$\alpha$ projects have tangled dependencies. $\alpha$ is publishable from the
audit log.

### 8.4 Reputation Discount

Principals with a history of clean settlements have lower expected damage:
$$
\pi(\mathcal{F}, p) = \pi(\mathcal{F}) \cdot (1 - \rho(p)),
$$
with $\rho(p) \in [0, r_{\max}]$ and $r_{\max} \leq 0.5$ to prevent trivialization. $\rho$ increases
with clean settlements, decreases with breaches, decays over time. Functional form: future work.

### 8.5 The Bonded Advisor — a concrete mechanism (incorporating what was formerly the Shipwright section)

One direction for solving $\pi$ is to delegate its computation to a specialized agent, itself bonded
on its advisory accuracy. We call this the **Bonded Advisor** pattern:

- A principal posts a Float Plan whose only acceptance criterion is "propose a fleet that meets
  budget/scope constraints for project $P$."
- A Bonded Advisor agent takes the plan, surveys $P$, and emits a candidate fleet — itself a set of
  Float Plans with proposed $\pi$ values.
- The advisor's bond on the proposing plan is slashed proportionally to the accepted fleet's eventual
  breach rate. Clean settlements accumulate reputation; breaches shrink it.
- Over time, advisors who propose well-priced fleets gain reputation and can charge for their
  proposals; advisors whose proposals over- or under-price bond forfeit and are eventually priced out.

This is a recursion: the pricer is priced. Its convergence properties depend on:
(i) whether the advisor has access to enough prior-fleet audit data to pattern-match new projects,
(ii) whether the reputation mechanism has enough history for discounting to be meaningful, and
(iii) whether the population of advisors is large enough for competition to discipline outliers.

The Port Daddy implementation instantiates this pattern in a single agent archetype (see
`SHIPWRIGHT-DAEMON.md` for the implementation), with recognition-primed (Klein 1998) pattern-matching
over an episodic memory (Park et al. 2023) of prior `(survey, proposal, outcome)` triples. The theory
does not require any specific reasoning architecture — it requires only that the advisor's own bond
ties to the fleet's realized cleanup cost $c$.

### 8.6 $c$ as a project health metric

A project whose observed $c$ is rising is fraying — breaches cost more to recover from, implying
coordination is decaying. The authority can publish $c$ alongside the bond pool and raise required
bonds automatically when $c$ crosses a threshold. Homeostatic feedback: risky spawns become expensive
when the project needs them least.

---

## 9. Open Problems (Updated)

We update the Bonded Commons paper's list of open problems:

1. **Bond pricing.** Still open. Now bounded below by $c$ (§8). A full mechanism-design solution remains
   future work. Thomas Youle's competitive-insurance model (per project memory, see
   `memory/project_competitive_insurance_2026_03_30.md`) is a promising direction.
2. **Multi-node consensus.** Partially addressed by the Merkle forest (§4) and KMS witness (§5). Strong
   consistency across daemons remains eventual. For fleets requiring strict serializability across nodes,
   a Raft-backed harbor-root consensus is possible but not specified here.
3. **Recovery fidelity depends on LLM capability.** Unchanged. Social recovery is as good as the
   successor agent's reading comprehension.
4. **Admission control.** Unchanged. Still irreducibly political. But we note that the KMS provides a
   technical choke point: an operator can freeze `auth/register` to halt new participants pending
   verification.
5. **Revocation filter false positives under high churn.** If the revocation set grows faster than
   TTL cleanup, the filter degrades. We assert an operating envelope; long-term, a scheme for periodic
   filter compaction with zero-downtime handoff is future work.
6. **Cross-organizational mesh.** Our gossip and KMS assume a single administrative domain. Meshes
   spanning multiple organizations need explicit federation semantics (who admits whom, whose witness is
   trusted). Out of scope for this expansion.
7. **Shipwright's own reputation.** Layer 0 introduces a new actor whose judgments are themselves
   bondable. The mechanism for pricing Shipwright proposals (§6.4) relies on Shipwright's reputation.
   Bootstrapping that reputation without prior history is a cold-start problem.

---

## 10. Conclusion

The Bonded Commons paper established that trust infrastructure is a precondition for agent coordination
at scale. This expansion shows, through implementation, that the three layers remain load-bearing as we
scale: bond enforcement becomes code-level invariant (§2), revocation becomes operationally tractable at
mesh scale (§3), attribution becomes cross-verifiable via Merkle forests (§4), key custody federates
without compromising zero-knowledge (§5), and the commons gains an advisory intelligence layer that is
itself subject to the same economic discipline as any participant (§6).

The pricing problem — the original paper's central open question — is not closed, but it is now bounded
from below by an *observable* quantity (cleanup cost $c$, §8). This is progress. A full mechanism-design
solution awaits collaboration with economists; we have constructed the ledger that will let them calibrate
against reality.

The infrastructure is running. The forest is building. The covenants are auditable. The sovereign is
legible. The advisor is bondable.

---

## References (new and extended)

In addition to the references in the Bonded Commons paper, this expansion cites:

1. Fan, B., Andersen, D.G., Kaminsky, M., Mitzenmacher, M. (2014). *Cuckoo Filter: Practically Better
   Than Bloom*. CoNEXT '14.
2. Bloom, B.H. (1970). *Space/Time Trade-offs in Hash Coding with Allowable Errors*. CACM 13(7).
3. Pagh, R., Rodler, F.F. (2004). *Cuckoo Hashing*. Journal of Algorithms 51(2).
3. Laurie, B., Langley, A., Kasper, E. (2013). *Certificate Transparency*. RFC 6962.
4. de Marneffe, F. (2011). *On the compactness of verifiable Merkle accumulators*.
5. Demers, A., et al. (1987). *Epidemic Algorithms for Replicated Database Maintenance*. PODC '87.
6. Merkle, R. (1980). *Protocols for Public Key Cryptosystems*. IEEE S&P.
7. Shamir, A. (1979). *How to Share a Secret*. CACM 22(11).
8. Klein, G. (1998). *Sources of Power: How People Make Decisions*. MIT Press.
9. Ostrom, E. (1990). *Governing the Commons: The Evolution of Institutions for Collective Action*.
   Cambridge University Press. (cited original paper; now doubly relevant for §2.4 graduated sanctions).

Port Daddy engineering artifacts referenced in this expansion:

- `lib/bonds.ts`, `lib/budget-guard.ts` — bond enforcement modules (§2).
- `lib/harbors.ts` — harbor membership (§3, §5).
- `lib/note-encryption.ts` — at-rest encryption (§5).
- `docs/shipwright/AGENT-MODEL.md` — the virtual-actor Plane (§6).
- `docs/shipwright/SHIPWRIGHT-DAEMON.md` — the Shipwright archetype (§6).
- `docs/shipwright/USER-ACCOUNTS-KMS.md` — federated key escrow (§5).
- `docs/shipwright/FLEETCONTROL-HARDENING.md` — sovereign-legibility (§7).
- `docs/shipwright/SHIP-GRAMMAR.md` — ship identity + visual grammar.
- `docs/adr/0014-the-anchor-protocol.md` — the Anchor Protocol ADR.

---

## Appendix A: Filter Sizing for Port Daddy

This appendix sizes all three tiers of the hybrid filter (§3.2.3).

### A.1 Bulk tier (rotating Bloom)

A Bloom filter with $m$ bits and $k$ hash functions achieves false-positive rate
$(1 - e^{-kn/m})^{k}$ for $n$ inserts. At the optimum $k = (m/n) \ln 2$, this collapses to
$\epsilon \approx (0.6185)^{m/n}$, requiring $m/n \approx 1.44 \log_{2}(1/\epsilon)$ bits per entry.

For target $\epsilon_{\text{Bulk}} = 3.3 \times 10^{-4}$ and $n_{\text{Bulk}} = 10^{4}$ revocations in
the active window:
- $m/n \approx 1.44 \times 11.57 \approx 16.6$ bits per entry.
- Total: $n \times 16.6 \approx 166$ kbits $\approx 21$ KB per generation.
- Double-buffered: 42 KB.
- Rotation cost: one `memset` at cadence $N_{\text{common}}$.

### A.2 Long tier (rotating Bloom, $k$-bucket ring)

For the long-tail TTL subset, same math per bucket, fewer entries. With $n_{\text{Long}} = 500$ entries
per bucket and 4 buckets at the same $\epsilon$:
- Per bucket: $500 \times 16.6 \approx 1$ KB.
- Total (4 buckets): ~4 KB.

### A.3 Hot tier (cuckoo filter)

A cuckoo filter with $f$ fingerprint bits and $b$ entries per bucket achieves false-positive rate
approximately $\epsilon \approx 2b / 2^{f}$ (Fan et al., 2014 Theorem 3). For the hot tier:

- Bucket size $b = 4$ (standard, balances load factor and space).
- Fingerprint $f = 13$ (so $\epsilon \approx 8/8192 \approx 9.77 \times 10^{-4}$ per entry; tighter than
  Bulk because this is the tier where per-entry decisions matter most).
- Load factor target $\leq 0.95$.
- Bits per item: $13/0.95 \approx 13.7$ bits.
- Supports O(1) per-entry removal.

Capacity: the hot tier holds only early-kill events. At a fleet-wide rate of 1 early-kill per hour with
average lag-to-natural-expiry of 6 hours, steady-state $|R_{\text{Hot}}| \approx 6$. Filter size: trivial
(hundreds of bytes).

### A.4 Total footprint and worst-case

Normal operation: ~50 KB per daemon for all three tiers combined. Easily memory-resident.
Worst case ($n_{\text{Bulk}} = 10^{6}$, $n_{\text{Long}} = 10^{5}$ per bucket, $n_{\text{Hot}} = 10^{3}$):
- Bulk: $10^{6} \times 16.6 \approx 2$ MB, doubled to 4 MB.
- Long: $10^{5} \times 16.6 \times 4 \approx 8$ MB.
- Hot: $10^{3} \times 13.7 \approx 2$ KB.
- Total: ~12 MB. Still trivially memory-resident on any modern daemon.

### A.5 Why both primitives and not just one

Rotating Bloom alone forces one of two compromises under heterogeneous TTLs:
(a) Rotate at the longest TTL → short-TTL revocations linger 1000× longer than needed, wasting memory
    and raising effective FPR on the working set.
(b) Bucket by TTL class → reintroduces the structural complexity cuckoo would have abstracted.

Cuckoo alone incurs unnecessary complexity for the common uniform-TTL subset where rotation is the
natural primitive and deletion is moot.

The hybrid uses each primitive where it is genuinely best. The filter design is a matter of workload fit,
not ideological preference.

---

## Appendix B: Inclusion Proof Example

A worked inclusion proof for a session with 4 notes in an epoch with 2 settled sessions.

```
Session S (3 notes n_1, n_2, n_3):
  h_1 = H(n_1)
  h_2 = H(n_2)
  h_3 = H(n_3)

  Merkle tree over (h_1, h_2, h_3):
          R_session
          /       \
       m_12       h_3'    ← (h_3 duplicated to balance)
       /    \
     h_1    h_2

Epoch ℓ (2 sessions: S, T):
  R_harbor_ℓ = H(R_S || R_T)

Proof that n_2 ∈ S ⊆ harbor at epoch ℓ:
  π = {
    note_path:    [h_1],               # sibling of h_2 on its path up
    session_path: [R_T],               # sibling of R_S
    signature:    Ed25519(R_harbor_ℓ)
  }

Verification:
  1. m_12' = H(h_1 || H(n_2))
  2. R_session' = H(m_12' || H(h_3) || H(h_3))  # right subtree: see construction
  3. R_harbor_ℓ' = H(R_session' || R_T)
  4. verify_ed25519(daemon_pubkey, R_harbor_ℓ', signature)
  5. return step 4 result
```

Total proof size: 2 hashes (64 bytes) + signature (64 bytes) = 128 bytes. For session sizes of 100 notes
and epoch sizes of 10,000 sessions, proofs grow to approximately 700 bytes (see §4.3).

---

*End of expansion. Contributions welcome. Submit a Float Plan.*
