type: added

- **Drydock hypertree execution now has one deterministic protocol authority.** A pure controller-side reducer admits typed events, enforces contract, assignment, role, review, rework, time, provider/account-native capacity, and envelope limits, and emits digest-bound projections without filesystem, network, process, database, or launch I/O. Signed witness ingress and provider custody remain later proof gates.
- **Observer clients fail closed instead of reconstructing history.** The projection stream rejects cursor gaps, conflicting duplicates, plan or reducer drift, and digest tampering, then requires a controller refetch.
- **The H1 contract is independently replayable.** A sealed golden corpus and focused adversarial tests cover initial, rework, and terminal projections, transactional rejection, identity separation, and stale/offline truth.
