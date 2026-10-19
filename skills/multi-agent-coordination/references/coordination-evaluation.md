# Coordination layers and fair comparisons

Measure each coordination layer separately before claiming a team benefit.
Isolated checkouts prevent shared-tree collisions; claims communicate intent;
merge queues validate an integration candidate; policy gateways can deny a tool
invocation; evidence channels make results inspectable. None implies the next.

GitHub documents that a merge queue validates a queued pull request against the
latest target branch and can rebuild candidate groups as the target changes:
[Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).
Use that documented behavior as a baseline, and mark untested external effects
or human interventions as unknown rather than attributing them to coordination.
