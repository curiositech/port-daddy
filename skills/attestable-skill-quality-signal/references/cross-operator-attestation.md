# Cross-Operator Attestation: What Operator A Needs to Trust Operator B's Skill Quality

When two operators (distinct organizations running separate WinDAGs deployments) want to compose skills across trust boundaries, Operator A cannot audit Operator B's model weights, training pipeline, or internal judges. The attestation bundle described in SKILL.md covers the *mechanism*; this document covers what A actually needs to verify and how B must structure the commitment to make that verification possible.

## The Three-Layer Trust Stack

**Layer 1 — Identity anchor.** A must be able to tie a bundle to a specific legal/organizational entity and specific skill version. Mechanism: a Decentralized Identifier (DID; W3C spec, method-agnostic) plus a Verifiable Credential (VC) whose subject is the skill capability and whose issuer is B's organizational DID. A resolves B's DID document, verifies the Ed25519 signature over the VC, and confirms the skill's content hash matches the committed binary. Without this, A cannot distinguish "Operator B's code-review-v1.2" from an impostor. DID + VC infrastructure is production-ready (arxiv:2511.02841 for agent-capability VCs specifically).

**Layer 2 — Signed outcome logs.** The Merkle-committed outcome log (described in SKILL.md §Tamper-Evident Outcome Log) must be signed by the same key as the VC. Concretely: B computes `merkle_root = SHA256(leaf_0 || leaf_1 || ...)` over sorted, canonical JSON leaves; signs `(skill_did, merkle_root, timestamp)` with its private key; and publishes the signature alongside the root. A verifies: (1) signature valid against B's DID public key, (2) A receives a subset of leaves, recomputes the Merkle path to root, root matches signed value. A does *not* need the full log — Merkle inclusion proofs let B share only the leaves relevant to A's query context (k-nearest neighbors from Step 4 in SKILL.md). Leaf schema: `{input_hash: sha256(canonical_input), output_hash: sha256(output), judge_id: "self-consistency-v1", judge_result: 0|1, timestamp_unix: int}`.

**Layer 3 — Cryptographic commitments to quality bounds.** The conformal calibration certificate and Beta-Binomial interval both carry formal guarantees, but only if A can verify they were computed from the attested log. B must include: (a) the calibration set size `n` and the list of non-conformity scores (not raw outputs — just scores), or a Merkle proof that those scores derive from log leaves; (b) the score function identifier so A can run the same function independently on any leaves A holds; (c) the computed threshold `q = quantile(scores, ⌈(n+1)(1-α)⌉/n)` so A can recompute it and check for drift. If B provides only the final interval `[lo, hi]` without the underlying scores and log proof, A has no basis for trust — it's an unverifiable assertion.

## Reputation Bonds

Neither identity anchors nor Merkle proofs protect A from a strategically dishonest B who publishes real logs with cherry-picked calibration sets. Economic deterrence fills this gap. Mechanism: B locks a staked amount (e.g., 10 SOL or equivalent stablecoin) in a smart contract at skill registration time. The contract's slashing condition is any proof that a published quality bundle's stated coverage was violated on a randomly sampled audit set: if A (or a third-party auditor) can provide 30+ independently sampled (input, output) pairs from B's skill that fall *outside* the claimed conformal prediction set at the stated α, the contract auto-slashes B's stake and transfers a portion to A. The required stake scales with the SLA being claimed — a skill advertising 95% coverage on safety-critical tasks requires a larger bond than one advertising 80% coverage on low-stakes summarization. As of mid-2026, this is contractually feasible on EVM-compatible chains; no packaged skill-bond protocol exists, but the components (ERC-20 escrow + ZK-proof-of-violation) are present.

## What a Verification Implementation Looks Like

```python
def verify_cross_operator_bundle(bundle, skill_did_document, held_leaves):
    # Layer 1: identity
    assert verify_vc_signature(bundle["identity_vc"], skill_did_document)
    assert bundle["skill_content_hash"] == sha256(fetch_skill_binary(bundle["skill_ref"]))

    # Layer 2: outcome log
    for leaf in held_leaves:
        assert verify_merkle_inclusion(leaf, bundle["merkle_root"], bundle["merkle_proof"])
    assert verify_signature(bundle["merkle_sig"], bundle["merkle_root"], skill_did_document)

    # Layer 3: conformal certificate
    scores = [score_fn(bundle["score_fn_id"], leaf) for leaf in held_leaves]
    q_recomputed = quantile(scores, ceil((bundle["n"]+1)*(1-bundle["alpha"])) / bundle["n"])
    assert abs(q_recomputed - bundle["conformal_cert"]["threshold"]) < 1e-6

    # Posterior check from Merkle-verified leaves
    successes = sum(l["judge_result"] for l in held_leaves)
    interval = beta_credible_interval(1+successes, 1+len(held_leaves)-successes, 0.95)
    assert interval[0] >= bundle["quality_floor"]
```

A production implementation would also check bundle freshness (timestamp within acceptable staleness window, e.g., 72 hours for low-velocity skills) and TEE signature if B operates in an enclave environment.

## Key Points

- Operator A's minimum viable trust set is: B's DID + VC, Merkle root + sig, Merkle inclusion proofs for the leaves A will use, conformal certificate fields `{n, alpha, score_fn_id, threshold}`. Everything else (TEE sig, reputation bond) adds trust tiers above the minimum.
- The conformal certificate provides a *distribution-free* coverage guarantee — A does not need to model B's data distribution, only verify that B's calibration set was large enough (n ≥ 100 for α=0.05 gives ~1.4% coverage variance; n ≥ 500 is production-grade).
- Reputation bonds deter strategic calibration set manipulation; the slashing condition must be *mechanically auditable* (ZK proof or publicly sampled test set) to be credible, not reliant on human adjudication.
- Signed outcome logs without Merkle proofs are auditable in principle but not in practice — B must structure the log as a tree *at write time*, not retrofit after accumulation.
- TEE guardrail attestation (Proof-of-Guardrail, arxiv:2603.05786) provides the strongest current trust tier but verifies only that a specific code hash ran inside the enclave, not that the quality metric inside that code is calibrated — Layer 3 conformal verification is still required.

## See Also

- SKILL.md §Tamper-Evident Outcome Log — Merkle construction and leaf schema details
- SKILL.md §Conformal Calibration Certificate — threshold computation and coverage semantics
- `references/conformal-prediction-for-llms.md` — score function options and calibration set sizing guidance
