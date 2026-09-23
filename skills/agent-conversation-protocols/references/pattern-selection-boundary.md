# Pattern selection boundary

Choose the conversation shape before defining its closed trace. This is a design
decision, not an authority decision: no pattern admits a participant, grants a
capability, validates an assertion, or makes an external effect complete.

| Situation | Candidate shape | Evidence and boundary |
| --- | --- | --- |
| One bounded request to a known capability | Request/response | Define the response contract and timeout. A response is an assertion until independently checked. |
| Independent candidate work | Fan-out/fan-in | Freeze the candidate set and reducer. Use an equal-budget single-worker baseline before treating parallelism as a gain. |
| Sequential dependent work | Supervisor/worker | The supervisor may route work but needs separately granted authority for each consequential action. |
| Competing, testable proposals | Debate or critique/refine | State the independent oracle and stop rule before turns begin; agreement is not evidence. |
| Preference among legitimate alternatives | Consensus or voting | Preserve dissent and define whose preference has authority; a majority does not mint truth. |
| Accumulating attributed observations | Blackboard | Bound retention, provenance, and relevance. Shared state does not widen any reader's disclosure authority. |

After selecting a shape, instantiate this skill's epoch, participant snapshot,
message language, sequencing, gathers, and terminal fence. Do not copy
framework-specific defaults or fixed round/confidence numbers into a protocol:
calibrate a stop rule against the actual task, budget, and independent outcome
measure.

## Provenance

This compact taxonomy was extracted from the reconciled source
`.agy/skills/agent-conversation-protocols/SKILL.md`. The source's framework
examples and fixed termination constants were intentionally not carried forward:
they neither establish an authority boundary nor generalize across tasks.
