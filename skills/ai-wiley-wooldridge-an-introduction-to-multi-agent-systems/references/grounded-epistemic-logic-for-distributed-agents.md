# Possible-world semantics and communication evidence

Epistemic models help when a design depends on what participants can distinguish or infer. They do not make messages reliable, expose hidden state, or prove implementation conformance.

## Possible-world model

Let W be modeled worlds and R_i a relation of worlds agent i considers possible from w. Then K_i p holds at w iff p holds in every w' with (w,w') in R_i. The chosen worlds and relation encode assumptions. If an observation is absent from the model, the formula cannot recover it.

Normal modal logic can make knowledge closed under logical consequence (logical omniscience). That is an idealized semantic property, not a claim that software derives every consequence.

## Constructed delivery example

Let p mean “job J was committed.”

| World | J committed? | Sender logged request? | Receiver got request? | Receiver sent ack? | Sender received ack? |
|---|---:|---:|---:|---:|---:|
| w1 | yes | yes | yes | yes | yes |
| w2 | no | yes | no | no | no |
| w3 | yes | yes | yes | no | no |
| w4 | no | yes | yes | yes | yes |

If sender sees only its local log, it may not distinguish these worlds; the log alone does not establish K_sender p. A received acknowledgement narrows the sender’s possibilities about delivery, but w4 shows a receive-only acknowledgement need not prove the commit effect. Only an acknowledgement contract that is tied to the commit operation, identity, and version can serve as evidence for that proposition, and the effect boundary still determines what is authoritative. Send, delivery, ack transmission, ack receipt, and effect receipt are different propositions.

A practical event record may include request ID, generation, actor, event type, authoritative source, and timestamp. This is a suggested schema, not proof of authenticity or freshness.

## Individual, everyone, common, distributed knowledge

For group G:
- E_G p (“everyone knows p”) means every i in G knows p.
- C_G p (common knowledge) includes p, everyone knowing p, everyone knowing everyone knows p, and so on.
- D_G p (distributed knowledge) is true when p holds in every world accessible under the intersection of the members’ accessibility relations, representing pooled information in that model; no single member need know it.

Do not substitute these. Broadcast, shared database, and acknowledgements imply different observation models. If a protocol needs a group epistemic property, define and analyze the communication/failure model. A successful delivery receipt is not a common-knowledge proof.

Halpern and Moses’ coordinated-attack result applies to a formal distributed model with unreliable communication and its specific assumptions. It does not justify saying common knowledge is impossible regardless of assumptions. The original skill’s detailed attack-round argument is removed pending full-body verification.

## Derive an evidence requirement

1. State the proposition needed at decision time.
2. Identify observations each actor actually has.
3. Enumerate an alternate world consistent with those observations.
4. Ask whether the action remains safe in every such world.
5. If not, add an observation/query or choose a safer action.
6. Include delay, duplication, reordering, restart, and stale-generation cases where relevant.

A hand table is not model checking. A model checker needs an explicit transition system, property, and tool/result record.

## Runs, local states, and observability

A run is a sequence of states/actions admitted by a transition model. A local state is information available to one agent along that run. Different global states can be indistinguishable when local state is the same. This motivates keeping sent, delivered, acknowledged, and committed states separate.

Specify whether a relation represents knowledge, belief, or uncertainty. Knowledge models usually impose factivity; belief may be false. Accessibility properties determine valid axioms. Do not add idealized axioms casually.

## Model-checking boundary

Finite-state checking evaluates a property over a specific encoded model. It does not prove the model includes every implementation behavior. Record variables/domains, transitions/fairness, property/temporal interpretation, abstraction/bounds, tool/version, result/counterexample, and model-to-implementation correspondence.

## Sources and access

- Wooldridge, [chapter 17 author lecture slides](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/distrib/pdf-slides/lect17.pdf), full deck read; supports possible-world semantics, accessibility relations, logical omniscience caveat, group knowledge, and high-level intention logic.
- Wooldridge, [2e contents](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/Contents.html), topic map.
- Halpern & Moses, [“Knowledge and Common Knowledge in a Distributed Environment”](https://arxiv.org/abs/cs/0006009), abstract and bibliographic record opened; 1990 JACM article republished on arXiv. Full body not relied on.
- Full Wooldridge book/Wiley body was not accessed.

