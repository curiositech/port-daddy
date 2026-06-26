# References — rust-data-structures-advanced

Depth loaded on demand. `SKILL.md` points here; read only the file the decision in front of
you needs.

| File | Consult when |
|------|--------------|
| [01-arenas-and-graphs.md](01-arenas-and-graphs.md) | Arena/generational-index deep dive — slotmap vs generational-arena vs id-arena vs typed-arena, petgraph & StableGraph, Rc/Arc + Weak, intrusive-collections, the "Too Many Linked Lists" lesson |
| [02-concurrent-and-lockfree.md](02-concurrent-and-lockfree.md) | crossbeam (channel/epoch/queue) vs flume vs std mpsc, dashmap, atomics & memory ordering, the ABA problem, epoch reclamation, Loom/Miri verification |
| [03-small-and-cache-friendly.md](03-small-and-cache-friendly.md) | smallvec/tinyvec/arrayvec, struct-of-arrays & ECS, Cow, im/rpds persistent structures, string/symbol interning, roaring bitsets |
| [04-choosing-a-map.md](04-choosing-a-map.md) | BTreeMap vs HashMap vs hashbrown vs fxhash/ahash vs IndexMap, hasher security (SipHash/HashDoS), ordered/range/insertion-order tradeoffs |
