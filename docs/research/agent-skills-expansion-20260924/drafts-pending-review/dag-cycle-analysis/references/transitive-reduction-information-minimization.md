# Transitive reduction

For a DAG, TR is unique and preserves reachability while removing edges implied
by longer paths. It can remove shortcut cycles and change circuit rank/MCB
selection. Keep original and reduced graph IDs and state which is analyzed. The
paper reports low variability of selected descriptors on specified generated
families after TR; it does not make MCB output generally deterministic or prove
that removed edges lacked domain value.
