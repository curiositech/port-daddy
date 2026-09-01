# References

Load only the file that matches the decision in front of you.

- `coordination-theory.md`: Procedural model for notes, claims, locks, tuples,
  inboxes, actors, and channels.
- `fleetbar-and-console.md`: where agents should look in FleetBar and Fleet
  Control Center, with screenshot paths used by the public website.
- `visual-evidence.md`: how to capture screenshots/GIFs for PR visual proof
  WITHOUT interrupting the operator — headless Playwright, windowed
  screencapture of already-open windows, capture harnesses, evidence packaging.
- `recovery-and-salvage.md`: how to resume interrupted work without rewriting
  history or dropping intent.
- `distribution-and-installation.md`: how this skill ships with Port Daddy
  binaries and mirrors into tool-specific installs.
- `cli-reference.md`: CLI command families, alias coverage, generated detail
  page expectations, and claim-aware git staging doctrine.
- `git-discipline.md`: the critical git rule set (ADR 0001) — stage only
  what you claimed, keep the coordination guard green, and the post-mortem
  that triggered it.
- `api-reference.md`: full HTTP API reference for the daemon (every endpoint
  with curl examples and response shapes).
- `sdk-reference.md`: JavaScript/TypeScript SDK methods, typed responses,
  and usage patterns.
- `multi-agent-patterns.md`: coordination recipes (handoff, file partition,
  symbol claims, salvage takeover, fleet roles).
- `portdaddyrc-spec.md`: `.portdaddyrc` configuration schema and resolution
  order.
- `actor-roster.md`: the canonical durable actors (cartographer, navigator,
  lookout, dock-master, etc.) and what each owns. Read before sending an
  actor message so you pick the right inbox.
- `error-codes-and-recovery.md`: how to read `pd` error codes and the
  recovery move that matches each. Read when a command fails and the human
  message is ambiguous.
- `session-lifecycle-state-machine.md`: the formal state machine for sessions
  (active → paused → done → salvaged). Read when a session is in an
  unexpected state or when integrating session events into another tool.
- `git-discipline.md`: the critical git rule set behind the SKILL.md
  "Git Discipline" section — never destructive-git a live shared checkout,
  worktree-per-agent, claim-aware staging. Read before any git mutation in a
  multi-agent repo.
