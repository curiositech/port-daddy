# Grand Harbor architecture ledger

**Status:** PROPOSED RECONCILIATION LEDGER  
**Snapshot date:** 2026-09-02  
**Repository base inspected:** `main@5e438c7f932d26e6b313534fd6bc02dc472ba9e4`  
**Intended successor authority:** signed, production-proven Chartroom read/write authority; that cutover has not happened.

This folder is the harpoon: a versioned, adversarially editable design object that prevents the newest chat, comment, mock, or implementation convenience from silently replacing the architecture accumulated before it.

It is deliberately not another claim that the product is already built. **Chartroom** (`docs/adr/0122-harbor-authority.md`) is the intended one-writer program authority, but [PR #9989](https://github.com/curiositech/port-daddy/pull/9989) is still a draft and explicitly excludes production deployment and Grand Harbor import. Until signed production write/readback exists, this folder is repository reconciliation material under review.

## Authority order

1. A ratified constitutional amendment may change the constitution.
2. An accepted repository decision may refine contracts but may not contradict the constitution.
3. Accepted contracts define runtime semantics.
4. System maps, dependency programs, UX documents, wireframes, and roadmaps are projections over those records.
5. Open questions, tensions, protected hypotheses, and stubs are deliberately non-decisions.
6. Archived conversation material preserves motivation and lineage but has no authority by itself.
7. If accepted sources conflict without explicit supersession, record the conflict as a tension. “Newest prose wins” is forbidden.
8. A draft PR, maintainer comment, proposed ADR, research paper, or chat synthesis remains `proposed` or `source` until repository governance accepts it.

The only currently accepted decisions imported directly from PR #9987 are the named `convoy` primitive, the `ConvoySource → staged instance → ConvoyReleaseCapsule → target → operation` lifecycle, its contract-first staging, and an owner PWA after the first compiler proof. The Grand Harbor and action-adjudicator amendments are the strongest current direction, but they remain maintainer intake records rather than merged architecture.

## How future ideas enter

Every proposal must name affected record IDs and declare exactly one primary relation:

| Relation | Meaning |
|---|---|
| `EXTENDS` | Adds a compatible capability or scope. |
| `REFINES` | Makes an existing record more precise without changing its promise. |
| `IMPLEMENTS` | Supplies code or proof for an existing contract. |
| `EXPERIMENTS_WITH` | Tests a protected hypothesis without granting it authority. |
| `CONTRADICTS` | Cannot coexist with an existing record as written. |
| `SUPERSEDES` | Explicitly replaces a record through the required decision/amendment path. |
| `ORTHOGONAL_TO` | Does not materially change the cited records. |

A new idea never silently becomes new architecture. If it contradicts a constitutional candidate, the review must expose that fact and either preserve the candidate or propose an amendment.

## Maturity is evidence, not adjectives

```text
OBSERVED → HYPOTHESIS → DESIGNED → CONTRACTED → IMPLEMENTED → PROVED → DOGFOODED → SHIPPED
```

No stage implies the next. A proposed ADR with code is not automatically accepted; a merged implementation is not proved; a local proof is not dogfooding; a branch preview is not shipping.

## Navigation

| Need | Start here |
|---|---|
| What must not drift silently? | [00 — Constitution](00-constitution.md) |
| What does each noun mean and what may it decide? | [01 — System map](01-system-map.md) |
| What must each boundary guarantee? | [02 — Contract registry](02-contract-registry.md) |
| What does Erich actually get at the computer? | [03 — Product experiences](03-product-experiences.md) |
| What depends on what, and what cut is funded next? | [04 — Program](04-program.md) |
| What is genuinely unanswered? | [05 — Open questions](05-open-questions.md) |
| Which good properties remain in tension? | [06 — Tensions](06-tensions.md) |
| Why do we believe any of this? | [07 — Research provenance](07-research-provenance.md) |
| How do skills enter implementation rather than prompt seasoning? | [08 — Skill grafts](08-skill-graft-plan.md) |
| Which strange ideas are protected experiments? | [09 — Protected hypotheses](09-protected-hypotheses.md) |
| What are the legal lifecycle states? | [10 — State machines](10-state-machines.md) |
| What would count as proof? | [11 — Proof catalog](11-proof-catalog.md) |
| What attacks or failures must be carried? | [12 — Threat model](12-threat-model.md) |
| How does existing machinery move without dual truth? | [13 — Migration](13-migration-and-compatibility.md) |
| What can be lightning fast, and where might Cedar fit? | [14 — Performance and Cedar](14-performance-and-cedar.md) |
| Which exact files and modules are seams today? | [15 — Implementation seams](15-implementation-seams.md) |
| What are the product stories and complete flows? | [UX index](ux/README.md) |
| What earlier context must not disappear? | [Archive](archive/README.md) |
| What has not been designed yet? | [Stubs](stubs/README.md) |

## Edge-case protocol

When an edge case arrives, the reviewer must:

1. locate the affected invariants, contracts, questions, tensions, proofs, and source records;
2. state what is already decided, what is only proposed, and what is unknown;
3. classify the new idea with the relation vocabulary above;
4. preserve both sides of any tension;
5. propose the smallest compatible change or an explicit amendment;
6. name lifecycle, failure, timeout, cancellation, replay, delegation, revocation, concurrency, budget, privacy, provenance, migration, observability, cross-Harbor, operator-override, compatibility, and proof implications;
7. update repository state only through review.

That protocol is the answer to sycophantic architecture drift: the baby has stable IDs, and the bathwater has somewhere else to go.

## Mechanical use

`ledger.yaml` indexes stable records. `checks/check-ledger.mjs` rejects missing indexed documents, duplicate IDs, ephemeral conversation-only citation markers, broken local links, and unlabeled stubs. Run from this directory:

```bash
node checks/check-ledger.mjs
```

The check is intentionally modest in this seed. Its completeness profile in `checks/completeness-profile.yaml` is the contract for a stronger schema-backed validator.
