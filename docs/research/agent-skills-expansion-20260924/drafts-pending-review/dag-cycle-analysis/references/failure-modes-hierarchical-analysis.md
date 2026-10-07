# Failure boundaries

Do not: treat undirected cycles as DAG errors; treat a feedback witness as valid
DAG structure; assume a diamond independently tolerates failures; infer mixer
synchronization; serialize an antichain; or delete transitive/safety edges as an
automatic repair. These require domain contracts, authority, and observed
runtime evidence beyond topology.
