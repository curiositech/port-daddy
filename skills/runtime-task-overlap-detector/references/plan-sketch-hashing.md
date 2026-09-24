# Plan sketches and representation-aware hashes

A plan sketch is a declared representation, not proof of work identity. Declare entity IDs, action type and arguments, target, dependency edges, required deliverable, acceptance checks, authorized scope, and `workVersion`. Preserve action order and dependencies where they matter. A type-only `read → write → test` sequence loses arguments and targets; equality means only that its lossy representation matched.

## Exact and approximate comparisons

- Canonical serialization supports **exact equality of that serialization**, not task identity after omissions, aliases, or stale versions.
- **MinHash** estimates resemblance of sets, such as normalized plan atoms. It is not an exact-string detector and is distinct from ROUGE and dense embeddings.
- **SimHash** fingerprints a feature representation and uses Hamming distance. It is not MinHash; neither carries a universal overlap cutoff.

```text
PlanSketch = { workVersion, scopeId, deliverable, acceptance[],
  nodes: [{id, actionType, arguments, target}],
  edges: [{before, after, kind}] }
exactKey = canonicalSerialize(PlanSketch)
atomSet = declaredAtoms(PlanSketch)        # MinHash candidate feature
featureBits = declaredFeatures(PlanSketch) # SimHash candidate feature
```

Missing fields mean `unknown`; do not invent targets or acceptance criteria. Same target with independent outputs, or same output under a mandated independent review, remains an adjudication distinction. Compare candidate recall against declared-scope and semantic baselines, inspecting false matches from generic sequences, aliases, missing arguments, and stale plans. Report cost and missing-field coverage; do not claim a scale crossover or universal threshold.


## Primary method anchors

- [Broder, On the resemblance and containment of documents](https://www.cs.princeton.edu/courses/archive/spring13/cos598C/broder97resemblance.pdf), §§2–3, read 2026-09-24: shingle-set resemblance uses intersection over union, while containment is directional. Random sampling estimates these quantities. Tokenization, shingle size and whether repetitions are retained change the representation. This supports a representation-level feature, not identity of agent objectives.
- [Charikar, Similarity Estimation Techniques from Rounding Algorithms](https://www.cs.princeton.edu/courses/archive/spring04/cos598B/bib/CharikarEstim.pdf), §3 and introductory sketch discussion, read 2026-09-24: random-hyperplane sign bits have a collision probability determined by vector angle; repeated bits allow Hamming-based estimation. The result concerns chosen vectors. Do not apply its guarantee to an unspecified feature-hash recipe or call its output exact task identity.

For a declared task-atom set, the local sketch must specify how node attributes and dependency edges enter the features. These papers do not decide that policy. Measure what information the representation discards before using its similarity for candidate retrieval.
