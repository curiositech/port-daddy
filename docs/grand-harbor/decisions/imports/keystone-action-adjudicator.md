# Imported source — Keystone action-adjudicator amendment

**Source authority:** maintainer intake comment on draft PR #9987  
**Source:** [Keystone amendment](https://github.com/curiositech/port-daddy/pull/9987#issuecomment-5504065272)  
**Import status:** PROVISIONAL SOURCE; NOT MERGED ARCHITECTURE

## Motivation preserved

Effects should pass through an evidence-producing reference monitor:

```text
ActionIntent → adjudication → ActionPermit or denial
ActionPermit → actuator → ActionReceipt
```

The source separates six correctness layers:

1. policy meaning;
2. compilation;
3. evaluator correctness;
4. substrate truth/freshness;
5. complete mediation;
6. permit/effect binding.

It argues for an offline compiler, a zero-LLM hot path, exact permit binding, the accepted Rust TCB boundary, and one small vertical proof before generalization.

## Ledger reconciliation

Imported into GH-I-001, GH-C-004 through GH-C-008, GH-P-004, GH-P-012, and the Cedar performance candidate. Proposed p50 under 100 microseconds and p99 under 1 millisecond remain **unbenchmarked targets**. The policy language, schemas, complete-mediation set, substrate materialization, proofs, revocation semantics, and runtime implementation remain open.
