# Computation versus control

The paper separates computation—what a participant does to form a response—from control flow—the sequence or conditions under which those computations occur (arXiv:2308.08155, §2.2). Make both explicit in a worked decomposition:

| Concern | Direct repair example | Managed-group example |
| --- | --- | --- |
| Computation | Assistant proposes code; UserProxy executes it and emits stdout/error. | Selected role analyzes the shared message and emits a reply. |
| Control | Receiving agent chooses `generate_reply`/registered reply; a message predicate and per-agent auto-reply cap govern exit. | `GroupChatManager` selects a configured speaker, collects its response, broadcasts it, and stops at group termination or `max_round`. |
| Observable evidence | Received artifact, reply function, tool result, changed repair, terminal reason. | Selected-speaker trace, broadcast history, group-round terminal reason. |

Custom `register_reply` functions can implement a nested conversation, and function calls can route into additional code; both are control choices to log, not evidence that all participants may communicate freely. The separation helps diagnosis but does not make natural-language routing deterministic or transcripts complete system state. [Paper v2](https://arxiv.org/html/2308.08155v2); [0.2 ConversableAgent API](https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/conversable_agent/); [0.2 GroupChat API](https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/groupchat/), accessed 2026-09-24.
