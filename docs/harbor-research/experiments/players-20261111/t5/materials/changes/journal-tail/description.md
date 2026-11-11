# journal: add tail(count) for the last entries

The status page wants the newest few journal entries without copying the whole journal. `Journal.tail(count)` returns copies of the last `count` entries, oldest first, and all of them when the journal is shorter. A negative count is refused.
