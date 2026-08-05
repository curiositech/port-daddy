# FleetBar Giant Squid action proof

These captures come from `SquidHarnessSnapshotTests` and show the real
`SquidHarnessStrip` for one selected project:

- `01-needs-repair.png` — the legacy FleetBar state is `DEGRADED`, provider
  coverage is incomplete, and the action is **Repair**.
- `02-live.png` — the read-back state is `LIVE`, all detected providers are
  wired, and the action becomes **Disarm**.
- `repair-to-live.gif` — the close-up action-to-outcome transition between
  those two rendered states.

Arm and Repair both run `pd squid on --cwd <selected-project>`; Disarm runs
`pd squid off --cwd <selected-project>`. After every action the store reads
`pd squid status --json --cwd <selected-project>` again, so the strip displays
the resulting harness state rather than assuming the command succeeded.
