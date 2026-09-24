# Six discourse topologies for a checkpoint

These are optional coordination shapes. They describe how evidence is exchanged;
they do not select an award, override authority, or admit an effect. Record the
measured message/call budget for the particular run instead of treating a shape
as a fixed-cost algorithm. Contract Net is a source for task-announcement and
proposal vocabulary, not a rule to choose the most confident participant.
[Smith (1980), §§II–VI](https://cse-robotics.engr.tamu.edu/dshell/cs631/papers/smith80contract.pdf)
describes manager/contractor task sharing; [FIPA Contract Net SC00029H,
§1.1](https://citeseerx.ist.psu.edu/document?doi=e560bbf29d1af433792fb5419845db1ab29bf7fc&repid=rep1&type=pdf)
describes `cfp`, `propose`/`refuse`, acceptance/rejection, and result/failure
branches, while leaving cancellation and abnormal termination outside its base
interaction.

| Topology | Mechanism and conditional use | Concrete checkpoint example | Tradeoff and failure mode |
|---|---|---|---|
| Request-response (RPC) | One caller asks one named evaluator a bounded factual question when the needed evidence and evaluator are unambiguous. | `patch-X` asks the compatibility reviewer whether `scan@r5:h1` lists the endpoint it edits. | Low coordination burden; a single mistaken or unavailable responder leaves the question unresolved, so hold rather than infer agreement. |
| Supervisor-worker | A coordinator gives separately scoped evidence requests to workers and joins their returned artifacts. Use when one checkpoint needs distinct retrievals. | A coordinator asks one worker for call sites and another for test coverage, then records both hashes before proposing revision 5. | Aggregation can hide a missing worker or incomparable artifact; each reply needs its node ID, revision, and contract. |
| Fan-out/fan-in | Send the same defined question to independently scoped assessors, then reduce only comparable outputs under a declared rule. | Three reviewers each classify the same supplied migration contract against the same acceptance checklist; the reducer records the checklist results, not a confidence vote. | Independence and comparability are assumptions to test; shared stale input or mismatched contracts makes the reduction meaningless. |
| Critique-refine | A producer offers a concrete artifact; a critic returns evidence-bound objections; the producer may revise a new candidate. | A proposed `patch-X@r5` is criticized for lacking a compatibility test, then revised with a test reference. | Repetition can cycle or merely restate opinions. Stop on an explicit hold, unresolved objection, or stated review budget; no confidence threshold establishes correctness. |
| Debate | Parties state incompatible, evidence-bound positions and a named decision process records the unresolved issue or chosen next investigation. Use when genuine disagreement affects a proposed revision. | One reviewer recommends pruning `publish` after a contract change; another identifies a replacement dependency. The recorded outcome is “revalidate successor,” not an automatic prune. | More participants do not create truth, and a judge’s assertion is not authority. A dispute without a common decision rule ends in hold/escalation. |
| Blackboard | Actors append partial artifacts to a shared, revisioned workspace for later readers. | Call-site and test artifacts are posted under revision 5; a checkpoint consumes one snapshot only after checking both entries name revision 5 and their producing nodes. | Asynchronous writes can mix revisions. A revision-consistent snapshot can feed a synchronous checkpoint; a moving or unbounded board cannot substitute for the checkpoint join. |

## Selection procedure

1. Name the decision question, permitted evidence, owner, and stop condition.
2. Select a shape because it supplies a missing artifact or resolves a defined
   disagreement. Do not invoke one merely because a future wave is tentative.
3. Bind every submitted artifact to node ID, graph revision, and evidence hash.
4. At the checkpoint, join the artifacts to the proposed dependency contracts.
   Missing, partial, untrusted, or cross-revision material produces a hold.
5. Record the actual exchanges and decision/revision result. An RCP-3-like
   `cfp` remains a local extension; a scope-change reissue is nearer the
   [FIPA Iterated Contract Net family](https://citeseerx.ist.psu.edu/document?doi=549b7fcda2d0b05ced04776ae38ba4f835921f6a&repid=rep1&type=pdf), not proof of base-CNP cancellation semantics.
