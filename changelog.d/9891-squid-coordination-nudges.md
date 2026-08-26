type: added

- **Squid now points agents at unread coordination and interrupted work.** The turn-start tentacle surfaces only a bounded unread inbox/parley count with `pd attention`, while the SessionStart Pilot adds a project-scoped salvage count with `pd salvage`; both preserve message bodies in durable truth, use short deadlines, and fail open when the daemon is unavailable. Stop-marker cleanup now removes stale markers in bounded batches instead of forking once per marker.
