# References

Load only the file that matches the decision in front of you.

- `coordination-theory.md`: Procedural model for notes, claims, locks, tuples,
  inboxes, actors, and channels.
- `fleetbar-and-console.md`: where agents should look in FleetBar and Fleet
  Control Center, with screenshot paths used by the public website.
- `recovery-and-salvage.md`: how to resume interrupted work without rewriting
  history or dropping intent.
- `distribution-and-installation.md`: how this skill ships with Port Daddy
  binaries and mirrors into tool-specific installs.
- `cli-reference.md`: CLI command families, alias coverage, generated detail
  page expectations, and claim-aware git staging doctrine.
- `api-reference.md`: full HTTP API reference for the daemon (every endpoint
  with curl examples and response shapes).
- `sdk-reference.md`: JavaScript/TypeScript SDK methods, typed responses,
  and usage patterns.
- `multi-agent-patterns.md`: coordination recipes (handoff, file partition,
  symbol claims, salvage takeover, fleet roles).
- `portdaddyrc-spec.md`: `.portdaddyrc` configuration schema and resolution
  order.
- `error-codes-and-recovery.md`: map from observable Port Daddy errors
  (ECONNREFUSED, EPERM, NODE_MODULE_VERSION mismatch, guard refusals, salvage
  weirdness) to the recovery action that actually works.
- `actor-roster.md`: the maritime actor roster — Coxswain, Navigator,
  Cartographer, Lookout, Quartermaster — what each owns and when to message
  which one.
- `session-lifecycle-state-machine.md`: session states (CREATED, ACTIVE,
  IDLE, ABANDONED, SALVAGED, COMPLETED, DISMISSED), transitions, and how
  Coordination Guard treats each.
