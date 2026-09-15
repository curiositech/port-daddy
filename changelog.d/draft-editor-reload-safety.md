type: fixed

- Harbor editor reload and background refresh preserve in-memory CRDT operations, imported history awaiting dependencies, replica identity, claims and cached code. Failed reads retain the existing editor; mirrors cannot reseed from disk. This is reload protection, not crash-safe draft saving or shared acceptance.
