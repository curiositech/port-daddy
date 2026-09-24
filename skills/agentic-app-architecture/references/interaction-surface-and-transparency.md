# Interaction surface, artifact review, and disclosure

## Chat, workbench, and history

Use chat for intent, concise status, and links; use an artifact/workbench pane for diffs, files, renders, commands, and validation. Every produced artifact should link back to the request or message that caused it, and the request should link to the artifact and receipt. This lets a reviewer trace work without pasting an entire diff into chat.

A session history can expose running/done/failed status, duration, and a link to evidence. Forking and rename are useful review affordances when alternatives or long-lived work exist; their applicability is declared in the state axis, not presumed for every one-shot interaction.

## Action, evidence, uncertainty—not private chain-of-thought

Choose disclosure levels for proposed/attempted actions, evidence/tool provenance, and uncertainty. These support review. Do not require private chain-of-thought. A compact action summary can say “read sources A/B, produced report R, confidence limited by unavailable source C” without exposing internal reasoning text.

## Interruption differs from cancellation

`before-dispatch` prevents a future effect, `between-steps` stops after the present step, and `mid-run` asks an in-flight operation to stop where supported. Steering is different again: it supplies a correction. Record the real boundary and any in-flight effect that may remain unknown. Do not label a next-turn-only button as mid-run cancellation.

## Decision check

For a document agent that writes a reversible local draft, disclose the draft path and source evidence, state that it can cancel between fetches, and record the draft receipt. For an external post, add planned action/evidence/uncertainty disclosure and the authority/control required by the execution axis. Neither case needs private reasoning disclosure.
