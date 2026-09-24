# Typed dependency contracts and source scope

Python 3.14 [`graphlib`](https://docs.python.org/3/library/graphlib.html) relevant API sections were read on 2026-09-24: `get_ready()` emits nodes only after predecessors are done and `CycleError` has a cycle witness. [Kahn 1962](https://doi.org/10.1145/368996.369025) is cited only as a historical anchor because its body was inaccessible. Neither source defines evidence, authority, resources, optional input, revision admission, or artifact reuse.

For each hard edge record `producer output digest -> consumer requirement`, edge type, provenance/freshness/scope/meaning constraints, and missing-producer behavior. A resource reservation constrains concurrent execution without asserting precedence. Approval artifact plus action authority are required for protected effects. This contract is a local engineering proposal, not a theorem.
