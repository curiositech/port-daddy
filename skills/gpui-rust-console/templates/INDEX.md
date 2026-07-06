# Templates Index

Copy-paste scaffolds for adding a new pane to the gpui/ratatui console. Fill the `{{PLACEHOLDER}}` tokens. Render-agnostic by contract: panes emit `Block`s only, so the same source drives both the GPUI shell and the headless REPL.

| File | What it scaffolds | When to use |
|---|---|---|
| `new_pane.rs.tmpl` | A read-only `Surface` pane over a daemon GET route (`{{PANE_TITLE}}` / `{{DAEMON_ROUTE}}`) | Use when adding a new read pane to the console. |
| `pane_tests.rs.tmpl` | The pane's test block (the console's per-pane testing contract) | Paste at the bottom of the new pane module to satisfy the test gate. |
