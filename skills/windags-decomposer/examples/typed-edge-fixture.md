# Typed-edge fixture

Positive fixture: `inspect-current-auth` and `read-threat-model` have no dependency; `choose-auth-policy` consumes both evidence outputs; implementation consumes the decision record; test consumes implementation digest. Layers `{A,B}`, `{C}`, `{D}`, `{E}` satisfy all edges.

Negative fixture: add `inspect-current-auth -> read-threat-model` because threat-model review needs the endpoint list. Keeping A and B in one layer now violates an edge. Another negative case points C at `read-threat-model-v2`, which is absent: reject before computing waves.

These are graph invariants only. They do not prove a task is complete or safe to execute concurrently.
