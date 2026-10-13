# Model boundaries before decomposition

Graph decomposition requires defined vertices and dependency semantics. Split a node only when its outputs, effects, authority, and dependency edges can be represented; otherwise record it as a composite node with an explicit unresolved internal boundary. “Atomic” is a modeling choice, not a theorem from Dilworth or Chen.

Check whether a cycle is a modeling error, feedback relation, or genuine coupled operation. Preserve source IDs and effects when producing a diagnostic SCC condensation. Constructed agent/task examples must identify their contracts and measurement plan.

See [validation](correctness-through-induction.md) and [Chen version boundary](virtual-nodes-deferred-decisions.md).
