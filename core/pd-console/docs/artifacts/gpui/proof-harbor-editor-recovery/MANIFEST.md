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

An after-framebuffer image is intentionally absent. macOS denied Screen
Recording permission to the agent host (`screencapture` could not create an
image from the exact pd-console window). The JSON receipt is evidence from the
real native process, but it is not mislabeled as a GPUI screenshot.
