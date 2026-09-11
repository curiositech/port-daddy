# GH-D-001 — Establish a Grand Harbor reconciliation ledger

**Status:** PROPOSED  
**Date:** 2026-09-02  
**Relation:** `EXTENDS` repository design documentation; does not amend accepted runtime contracts

## Context

Grand Harbor, Convoy, Chartroom, action adjudication, actor continuity, BDI, Parley, claims, stigmergy, Porthole, Relay, evaluation, and Anchor have accumulated across accepted ADRs, proposed ADRs, code, skills, design documents, pull-request comments, and chat synthesis. Conversational presentation rewards locally coherent restatement while hiding sampled-out context and does not itself update shared authority.

## Proposal

Establish this folder as a reviewable reconciliation object with stable IDs, explicit authority/maturity, sources, invariants, contracts, open questions, tensions, protected hypotheses, dependency program, proofs, archived motivation, UX projections, and a mechanical completeness check.

Future proposals declare `EXTENDS`, `REFINES`, `IMPLEMENTS`, `EXPERIMENTS_WITH`, `CONTRADICTS`, `SUPERSEDES`, or `ORTHOGONAL_TO`. Constitutional changes require an amendment; a mock cannot decide a contract.

## Non-decision

This proposal does **not**:

- declare itself production Chartroom authority;
- merge or amend the Convoy RFC;
- select Cedar, Soufflé, generated Rust, Lean, or any policy engine;
- ratify typed action schemas;
- rename `Body` to `Incarnation`;
- declare Grand Harbor, Porthole evidence, federation, reputation, or markets shipped;
- replace existing accepted ADRs or runtime stores.

## Migration target

After Chartroom has signed production mutation and exact readback, import this ledger with source digests and explicit conflict resolution. The signed target revision becomes authority; this folder becomes a repository projection/export rather than a parallel writer.

## Proof

- all indexed records resolve;
- no ephemeral chat/file citations remain;
- every external amendment names its exact repository source and status;
- every UX state traces to a contract candidate or open question;
- a future edge case can modify the smallest stable records without rewriting the package.

## Consequences

The package is larger than a manifesto because it preserves disagreements and testable seams. It imposes review overhead. In exchange, architecture change becomes diffable, edge cases become local, and older motivation remains inspectable without pretending it is settled.

