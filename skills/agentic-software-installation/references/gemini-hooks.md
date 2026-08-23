# Gemini CLI (`gemini`) — Bounded Interactive Hook Wiring

Sources:
- https://geminicli.com/docs/hooks/reference/
- https://geminicli.com/docs/hooks/best-practices/

Port Daddy writes its entries to the opted-in project's
`.gemini/settings.json`. Gemini hook processes read JSON from stdin and must
write only the final protocol JSON to stdout; diagnostics belong on stderr.
Synchronous hooks delay the agent loop, so the active set is intentionally
small.

## Active PD events

- `BeforeAgent` -> `pd-hook-prompt`
- `BeforeTool` -> `pd-hook-pre-tool`

The mutation matcher is `replace|write_file|edit`, and the command deadline is
1,000 milliseconds. The pre-tool gate blocks with stderr plus exit 2 after
recognizing Gemini's snake_case event payload.

Port Daddy does not install an `AfterTool` observer. Its cumulative evidence
lives in claims, notes, transcripts, and the daemon stream. The stable
`pd-hook-post-tool` wrapper remains only as an inert compatibility tombstone for
an already-running process with cached configuration.

## Installation and verification

Use `pd hooks install`. It preserves unrelated hooks, removes historical PD
AfterTool entries, and writes absolute gated wrappers. Do not manually copy raw
tentacles or hand-merge JSON.

In a real interactive session, attempt to edit a path claimed by another actor.
The gate should block once. Validate stdout as protocol JSON, confirm one debug
start record for the event, and confirm no PD command remains under `AfterTool`.
