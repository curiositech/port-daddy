# Commitment labels and per-node evidence joins

Use these as local planning labels, not calibrated probabilities or authority
claims. They describe what the next checkpoint must inspect.

| Label | Local meaning | Minimum record before a later admission |
|---|---|---|
| `COMMITTED` | A proposed node has a stated contract and current supporting evidence. | Node ID, graph revision, contract, evidence hashes, and any approval/risk/resource gate still required. |
| `TENTATIVE` | The node is presently planned, but an upstream result may change its approach or contract. | The exact predecessor IDs and what evidence would confirm, revise, or hold the proposal. |
| `EXPLORATORY` | The node is an investigation or conditional possibility whose necessity/output is still open. | A question, bounded artifact/stop condition, evidence owner, and the downstream nodes that must not assume its result. |

## Checkpoint procedure

1. Take `justFinished` from the completed wave and join each ID to exactly one
   outcome for the proposed graph revision. A partial, failed, missing, or
   untrusted outcome is not a successful producer.
2. For each upcoming node, look up its own label and its declared dependency
   IDs. Do not infer a wave-level label or use unrelated completed output.
3. Reassess a risk only when `risk.affectedNodes ∩ justFinished` is nonempty;
   retain the prior severity plus evidence hash and provenance.
4. A tentative node can become a new committed proposal only after its actual
   dependencies and revised contract validate. An exploratory node can supply
   a bounded result, remain held, or motivate a new revision. Neither label
   bypasses approval, authority, resources, or risk gates.
5. If evidence changes a prior decision, preserve that historical decision and
   create a successor revision that names its parent, supersession rationale,
   changed contract/edge, and validator result. It is an archival supersession,
   not a silent rewrite or a claim that an old receipt has a new revision.

Constructed example: `patch-X@r5` is `TENTATIVE` and requires
`inspect-call-sites@r5`. Its predecessor has evidence `h2` but returns
`partial`, so the checkpoint records `hold`; it does not promote `patch-X`.
A later successful `h3` may support a revision proposal, while `publish` still
waits for its own approval edge. The label guides re-evaluation only.
