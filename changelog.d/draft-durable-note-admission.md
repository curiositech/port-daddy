type: fixed

- Durable sessions retain notes and complete plans beyond 500 entries. Atomic per-session burst admission and UTF-8 write bounds replace the durable lifetime cutoff; temporary refusals provide a retry time without deleting history. Ephemeral sessions retain their existing lifetime cap.
- Typed note reads are bounded in SQLite, write authorization reads session metadata only, and completion reports the full retained note count. A real terminal transition admits one bounded handoff even at an exhausted burst; repeated completion cannot append unlimited handoffs.
- Takeover now propagates note and claim refusals atomically, preserving both sessions, history and claims on failure and projecting events only after commit. Protected-project notes accept the existing envelope-only form after exact owner authorization, without admitting plaintext smuggling.
- Peer snapshots retain complete exact-session histories instead of invalid oversized page requests. Global note totals and Memory's Recall/Archival counts share bounded snapshot reads; invalid timeline limits or unavailable sources produce explicit errors rather than incomplete success.
