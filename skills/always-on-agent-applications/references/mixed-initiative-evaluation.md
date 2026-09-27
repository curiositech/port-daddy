# Mixed-initiative methods and evaluation

Sources inspected on 2026-09-24. These are design inputs, not an experiment performed for this skill.

## Earlier interface method

[Eric Horvitz, *Principles of Mixed-Initiative User Interfaces*, CHI 1999](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/chi99horvitz.pdf): read the official PDF's principles, LookOut interaction description and action/inaction utility analysis (PDF pages 1–6). LookOut combines goal uncertainty, attention and action costs; a calendar aid can wait, ask or prepare a result for editing. It supports direct invocation and termination and can offer a less precise service when detail is uncertain. Its expected-utility model compares acting and withholding assistance under both desired and undesired goals. This motivates a user-specific decision model, not a universal confidence threshold, modern LLM result or permission to act.

## Recent diagnostic designs

[Li, Pan and Wang, *ProEvent*, arXiv:2607.17701v1](https://arxiv.org/html/2607.17701v1): read §§3–5 and the construction/quality descriptions. Synthesized chats drive timetable insert/update/delete operations. Evaluation separates response timing, operation correctness and state correctness across steps; equivalent operation sequences can yield the same event state. The reported setup includes LLM judgments for open-ended location descriptions and ceases tracking an event after an incorrect prediction. Use those details when interpreting success rates: the benchmark does not establish human interruption cost or recovery after error. A method worth transferring is separate scoring of unnecessary actions, missed needed actions and maintained state. Preserve the no-action denominator; do not rename that rate precision.

[Wu et al., *Ask Now, Use Later*, arXiv:2605.28108v2](https://arxiv.org/html/2605.28108v2): read §§2.2–3.3 and Appendix B.5/C. Hidden standing preferences are linked to later tasks; learning transcripts are frozen before testing. A supplied-preference oracle helps distinguish acquisition from later application. Router/classifier scaffolding decides which questions obtain hidden answers, so asking scores depend on that scaffold. This provides a controlled question-acquisition design, not field evidence that more questions improve a user's life. Do not expose hidden rules to the evaluated agent or mistake the oracle's extra information for an equal-information control.

## Constructed local event fixture

This proposed trace is original to the skill; it is not a reproduced benchmark. Start with delegated authority to prepare drafts, an empty timetable and a declared quiet period.

| Observation | Expected state or response | Failure distinguished |
|---|---|---|
| Tentative lunch discussion with no agreed time | No committed event; optional draft if requested | premature insertion |
| Participants agree to noon Thursday | One source-bound draft at that time | missed update |
| One participant corrects noon to 13:00 | Amend the same draft, preserving its identity | duplicate event |
| Participants cancel | Retire the draft; retain only permitted audit data | cancellation failure |
| An unrelated old message is replayed | No resurrection from stale evidence | temporal contamination |
| Relevant signal arrives during quiet period | Follow the declared deferral rule; record a pending draft | interruption policy failure |

Run equal-information on-demand, scheduled and event-triggered arms. Measure correct state after each transition, redundant or omitted actions, recovery after a deliberately injected error, review time and useful completion. Obtain interruption-burden evidence from consenting users; simulation cannot supply it. Separately test preference acquisition using a hidden rule and a supplied-rule diagnostic, with the same later task and memory mechanism. Include a changed rule and an irrelevant optional question so question count cannot masquerade as value. No universal cutover or published performance is implied.
