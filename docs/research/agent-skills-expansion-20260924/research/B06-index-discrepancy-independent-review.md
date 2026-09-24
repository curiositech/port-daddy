# B06 index discrepancy: independent source and Book review

2026-09-24. Root's central finding is confirmed with two small independent fixtures. No manuscript, skill, prior accepted artifact, Git state or runtime was changed. Scope is the literal printed algorithm versus the pinned author representation, not paper-experiment invalidation or full Java certification.

## Sources, pins and read depth

- SEA 2023, Kritikakis–Tollis, Fast Reachability Using DAG Decomposition, DOI10.4230/LIPIcs.SEA.2023.2. Primary PDF: https://drops.dagstuhl.de/storage/00lipics/lipics-vol265-sea2023/LIPIcs.SEA.2023.2/LIPIcs.SEA.2023.2.pdf . Local PDF SHA256 a62af6321ac242f95f6ccc1455dd1e4096af3034d1fc0fc686a54ee3f49b3c9e. Read printed pp2:9–2:11 and AppendixA.1 on2:16. Opened the actual rendered Algorithm1 page (SEA-2023-algorithm-1.png), independently confirming early self insertion at line7 and the strict conditional test at line13. This is a targeted primary-body review, not a new full-paper replication.
- Author source: https://github.com/GiorgosKritikakis/OnGraphHierarchies/blob/1af62b3d379f06c890bba87f4640f8bd1db31305/src/graphhierarchies/transitiveclosure/IndexingScheme.java . Commit1af62b3d379f06c890bba87f4640f8bd1db31305; file SHA256 cfd91becc6c28e449890d456471069e2d33b0b754a7bab2c6ef5c65903a99764. Read the complete supplied Java file. Its Git blob hash was independently computed and matched the entry in the supplied author-tree.json. This binds the bytes to the saved tree receipt; no claim of freshly fetching the remote repository or compiling the project.
- Read both repaired skill references, root's finite-index-check.py and its result JSON. The separate arXiv2404.17954v2 claim is inherited from root's source receipt; it was not independently reopened in this pass and is unnecessary for the SEA counterexample.
- Exact local source hashes and current Book/worktree boundary are in ../book-B06-index-discrepancy-plan/readback-receipt.json. All eight active manuscript hashes match manuscript-snapshot.json.

## Literal printed combination fails

The paper states inclusive reachability in §4.1: source row's target-chain minimum <= target position. §4.3 and Algorithm1 seed the source's own-chain slot with its own position before processing edges. At line13 an outgoing target is merged only if its position is smaller than the source row's slot on that chain.

Take a→b→c, supplied paths C0=[a,b], C1=[c], zero-based positions. The array trace is:

| Step | a | b | c | Consequence |
|---|---|---|---|---|
| Self seed | [0,∞] | [1,∞] | [∞,0] | Inclusive rows begin with own position |
| b→c | [0,∞] | [1,0] | [∞,0] | 0<∞, merge succeeds |
| a→b | [0,∞] | [1,0] | [∞,0] | 1<0 is false; merge is skipped |

Query a↝c returns false although the path exists. This cover is valid under the stated arbitrary supplied-decomposition contract. To eliminate an unstated minimum-cover defense, use a→b→c,d→c with C0=[a,b],C1=[d,c]. In topological order a,b,d,c, the same skipped a→b update loses a↝c. Width is2 because a,d are incomparable and the supplied two chains cover the graph.

This is not an off-by-one convention: one-based positions produce the same false comparison. It is not an adjacency-order issue, cycle, self-query issue, numerical tolerance or invalid cover. The skipped edge a→b is not transitive in either fixture. AppendixA.1 explains why a transitive edge can be skipped after a predecessor has already propagated the target's information; the counterexample shows the literal condition also skips a nontransitive same-chain edge solely because of the early seed. Knowing a can reach b does not mean a's array already includes b's cross-chain descendants.

## Author representation is different and coherent on both fixtures

The Java constructor initializes every slot to infinity (Indices constructor :59–64), without self seeding. update_indices (:118–133) takes minima with the successor row, then explicitly inserts the successor's position. getPosition (:136–144) reconstructs that position as next same-chain slot minus1, or chain length minus1 at infinity. isReachable (:25–35) explicitly accepts identical vertices; otherwise it uses strict source-slot < target-own-slot.

The intended invariant is earliest **strict descendant** in each chain. For a vertex at position p in a valid reachability chain, its completed own-chain slot is p+1 if it has a next chain member, or infinity if it is last. This explains both the helper and the strict query: a finite source minimum j satisfies j < p+1 exactly when j<=p, while infinity needs its own boundary handling. Acyclicity prevents a source from reaching an earlier member of its own chain. In the three-node case the completed author-style rows are a=[1,0], b=[∞,0], c=[∞,∞]; a↝c is correctly 0<∞.

The returned arrays cannot be interchanged with inclusive self-seeded arrays while keeping the same query. The source comments cite another paper title; this audit does not establish that this exact repository revision was the code used for SEA2023 experiments. Neither the counterexample nor these two successful code translations support saying the author implementation or experimental tables are broken.

## Independent bounded execution and reference proof

I wrote a new tiny-check.py without importing or executing root's sweep. It uses independent stack traversal as the closure oracle and locally transcribes four variants: literal printed, all-successor merge, delayed-self seed, and the pinned author representation. Only the supplied three- and four-node graphs run. All100 query comparisons (four methods times9+16 ordered pairs) are recorded; literal printed fails on both cases, while the other three match traversal on both. See ../book-B06-index-discrepancy-plan/tiny-check-results.json. No actual Java class execution, graph library integration, random generation or broader enumeration occurred.

Root's 75 ordered DAGs,460 valid covers,42,888 query comparisons and55 failing printed-cover cases are accurately labeled as **root's bounded translated-code evidence**. I read the sweep and result but did not rerun or independently certify those aggregate counts. They are not asymptotic correctness or performance results.

The local all-merge construction has a short independent inductive argument. Define low[u,j] as the minimum chain position among vertices in chain j reachable from u, including u itself, and infinity when none exists. Seed u's own slot. At reverse-topological processing time all immediate-successor rows are complete; every non-self path begins through one such successor. Elementwise minimum across every successor therefore computes the invariant exactly. A finite minimum at position p implies reachability of all later positions because the supplied chain was validated by reachability. Conversely each finite entry comes from u or an actual successor path. Thus low[u,chain(v)]<=position(v) answers inclusive reachability. Strict reachability additionally excludes u=v.

Dense allocation/initialization costs Theta(k|V|); every successor merge costs O(k), for O(k(|V|+|E|)) construction and O(k|V|) space, given the validated cover and graph/topological data. Cover construction and validation must be priced separately: validating arbitrary reachability-chain adjacency is not free when no reachability oracle already exists. Query cost is O(1) in the explicit-array/RAM model, not an end-to-end latency claim.

Two cautions for the future method notes: (1) the simple proof applies to all-merge, not automatically to either conditional optimization; the two tiny successes do not supply their general proof. (2) the paper's advertised reduced-edge-sensitive update bound should not erase the explicit k|V| initialization term in a claimed end-to-end bound. On an edgeless graph dense table initialization is still nonzero even though both edge terms vanish. This is a cost-accounting qualification, not a newly executed scaling result or a replacement theorem for the optimized implementation.

## Corrections and limits for the candidate skill

Root's printed-index-and-implementation-gap.md correctly distinguishes the two representations and the failure scope. constant-time-reachability-through-indexing.md correctly labels all-merge as a local reference construction with its own bound. Preserve those repairs. Do not silently fix Algorithm1, cite the repaired version as the paper's literal pseudocode, or transfer Theorem5's optimized cost claim to it. Keep graph revision, cover/position map, self-query convention, row invariant, merge rule and query predicate bound to one representation version. Stale index queries need rejection/rebuild or a separately specified update method.

No new primary search was required beyond the supplied pinned primary bodies. The exact source discrepancy is established by a rendered algorithm, explanatory body, pinned code and counterexample, not a search excerpt. No author contact is authorized or attempted. This does not establish scientific novelty, historical precedence, publication erratum status, or a flaw in reported experimental measurements.

## Book disposition: one Trace extension, no new figure

The live Book passages read for placement are Chapter4 legible-swarm.tex:934–945 (versioned dependency intent) and :2717–2724 (authority-rules exercise group), and Chapter2 anchor-protocol-whitepaper.tex:606–611 plus :1436–1452 (model/source/binary proof boundaries). The latter already explicitly teaches that model proof and concrete code evidence are different claims. Do not present that general lesson as absent. The Chapter4 material offers a natural home for a concrete graph-representation exercise alongside the frozen chain-versus-path plan.

Proposed use: append a Trace part to the **existing planned B06 order exercise**, linked from :934–945 and housed in the group beginning:2717. Supply a→b→c with two paths, the two array conventions, and the three-step table above. Ask the reader to identify the first skipped necessary propagation, reconstruct the all-merge row, and explain why merely changing <= to < is not a repair. An optional harder part supplies the four-node minimum cover. Reader question: which representation invariant licenses skipping a merge?

This adds a distinct mechanism lesson to the prior chain/path count distinction, but does not justify a new section or standalone figure. A three-row trace table and short pseudocode expose the exact bug more clearly than another network diagram. **No new TikZ port is recommended or produced.** The earlier book-B06-order-exercise remains frozen and unchanged. There is no unmet render obligation for this report; it contains no new render claim.

No performance experiment is needed to establish the counterexample. A future implementation can retain the two fixtures as regression cases and use an independent traversal oracle before optimizing. Teaching efficacy, large-input performance, filtered-edge behavior outside root's finite scope, dynamic maintenance and full author-project correctness remain unmeasured. The deliverable is an exact source/invariant correction and placement plan, not Book prose.
