# Paper case cards: distinct evidence roles

| Paper case | Participants and method | Evidence boundary |
| --- | --- | --- |
| OptiGuide A4 | User question goes to Commander; Writer produces code; Commander sends code to Safeguard. In this application, Commander conditionally executes when the Safeguard response clears the code; otherwise it returns the flagged issue/debugging information to Writer. Writer interprets a tool result after execution. | This is the paper's application route. Its LLM-backed safety assessment is not a general deterministic security guarantee or generic veto protocol. |
| ALFWorld A3 | Assistant proposes actions and executor performs them in the environment. The paper supplies grounding facts at task start and again when the Assistant emits the same action three times in a row. | This trigger and facts are scoped to the paper's ALFWorld setup; they do not promise universal loop prevention. |
| Conversational Chess A6 | Custom `register_reply` functions parse a natural-language move into a structured representation such as UCI, push it to the Board, return an error if the move is illegal, and send the move to the opponent only after a successful push. | Board legality is a domain-specific external rule check. It does not make generic natural-language conversation grounded. |

Choose separate roles when their evidence or effects differ: writer proposes, executor reports what ran, an external deterministic policy may decide an effect, and a human may provide an input. Test a critic-accepts/policy-rejects case. Specialization does not automatically establish safety, correctness, or one-role-one-concern. [Paper v2](https://arxiv.org/html/2308.08155v2) A3–A6, accessed 2026-09-24.
