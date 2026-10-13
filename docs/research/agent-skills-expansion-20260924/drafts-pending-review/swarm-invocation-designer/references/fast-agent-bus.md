# Replaceable observations and durable commands

This reference defines information classes for an invocation contract. Select and operate
a concrete transport under its separate profile; no measured latency is claimed here.

| Information | Loss/duplication policy | Evidence obligation |
|---|---|---|
| Presence and progress | May be replaceable; duplicates may be discarded | Report observation age and coverage; absence is not death |
| Dispatch or renewal intent | Durable before transmission | Bind operation, attempt, generation, authority and reservation |
| Cancel request | Durable command, not proof of termination | Preserve acknowledgement, fence and target reconciliation separately |
| Outcome and settlement | Preserve immutable evidence references | Read back exact operation and accounting disposition |
| Artifact body | Store under an attributable content reference | Verify the referenced bytes and disclosure scope |

A hot-path envelope can carry `source`, observation `id`, operation key, attempt,
generation, sequence, observation time and an artifact handle. Sequence counters require
a declared scope; clocks require stated synchronization assumptions. A newer event cannot
silently overwrite a terminal record for another attempt. Authentication and disclosure
checks precede use of an artifact reference.

A practical review worksheet records expected load, payload distribution, tolerated loss,
back-pressure, ordering scope, retention, recovery, and the operation whose latency is
being measured. Choose targets from the task's deadline and compare measured percentiles
with sample size and test conditions. There is no universal local-IPC or steering latency
threshold. No measurement is bundled with this design.

Review duplicates, reordering, stale heartbeats, consumer restart, missing receipts,
reservation rejection, cancellation races, and reconnect after outage. A dropped presence
update can be acceptable; dropping a state-changing command requires reconciliation.
The transport does not supply authority merely by carrying a valid message.
