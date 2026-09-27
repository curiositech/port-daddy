# Antichains and coordinates

An antichain is a set whose nodes are mutually unreachable under the selected
order. It is not a resource-safe execution wave; hidden data dependencies,
exclusive resources, and effect policy can still forbid concurrency. Preserve
height, stretch, and cycle-overlap/participation as distinct descriptors. Do not
enumerate successive barriers with a greedy maximal-antichain scan: maximal
antichains can overlap and all-maximal, maximum, and chain-cover problems differ.
