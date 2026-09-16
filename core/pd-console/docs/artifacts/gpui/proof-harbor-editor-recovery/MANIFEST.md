# Harbor Editor recovery proof

This is the operator-provided failure state that started the repair:

![Permission-denied editor with no visible recovery](before-permission-denied.png)

The rebuilt native GPUI process was then driven through its local control socket
and macOS input events. [`runtime-proof.json`](runtime-proof.json) records the
observed outcomes: physical typing changed the in-memory Loro buffer exactly
once, Rust syntax was detected, wrapping and blame reached visible view states,
an edit invalidated blame instead of showing false provenance, a failed normal
open preserved the current editor, and Escape returned a failed deep link to
its parent Files view.

This still is from the rebuilt native GPUI process. It shows the editable Rust
buffer, caret, syntax status, replica provenance column, and explicit wrap and
blame controls:

![Rebuilt Harbor Editor ready for native editing](after-editor-ready.png)

No motion artifact is included. The operator explicitly ended further movie
capture attempts after the native process, structured state transitions, and
still had been verified. The JSON receipt remains the authoritative evidence
for interactions that a still cannot prove; it is not mislabeled as motion
capture.
