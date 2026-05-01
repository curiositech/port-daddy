# PD Tube Tutorial

PD Tube turns a Port Daddy channel into a durable conversation pipe. The point
is not to replace notes or pub/sub. The point is to give agents a single
command that both delivers a reply and blocks for the next event — the shape
that unlocks the agent loop.

## Listen — The Default Is Block-Once-And-Return

```bash
$ pd tube ui:clicks
tube waiting on ui:clicks as pd-tube/myapp/ui_clicks (up to 600s; Ctrl+C to exit)

──── event id=42 · channel ui:clicks ────
From: web-demo · 2026-04-30T22:01:11.000Z
Body:
  {"button":"deploy-staging","user":"erich"}

Act on the event above, then post your response by running:

    pd tube ui:clicks --reply "your response here"

That command posts a reply correlated to id=42 AND continues
listening. Use --raw / --json for machine output. Ctrl+C to exit.
──────────────────────────────────────
```

The call blocks until a new event arrives, prints one prose
"crank-handle" block telling the agent how to reply, and exits. If no
event arrives within `--wait-for=<seconds>` (default `600`), the call
exits cleanly so an agent loop does not trip a sandbox timeout.

## Reply — One Command, Both Jobs

```bash
$ pd tube ui:clicks --reply "Deployed to staging. CI is green."
SUCCESS: tube: posted id=43 to ui:clicks
tube waiting on ui:clicks as pd-tube/myapp/ui_clicks (up to 600s; Ctrl+C to exit)
…blocks for the next event…
```

Inline `--reply "body"` auto-correlates to the most recent event from
someone other than this listener (tracked as `lastForeignEventId` in
the per-channel cursor), posts the reply, and continues listening.
That is the agent-loop unlock: each invocation returns, the bash tool
yields, the model picks the next reply, the next call posts and
blocks again.

For long bodies, pipe stdin: `echo "long body" | pd tube ch --reply -`.

For the legacy explicit-parent shape, pass a numeric id and add
`--send` for post-and-exit behavior:

```bash
$ printf 'roger that' \
  | pd tube ui:clicks --reply=42 --send --sender codex
SUCCESS: tube: posted id=43 to ui:clicks
```

## Send — Top-Level Message, Post-And-Exit

```bash
$ pd tube ui:clicks --send "shipping it"
SUCCESS: tube: posted id=44 to ui:clicks
```

Inline body or stdin; either way `--send` posts a top-level message
(no `inReplyTo`) and exits.

## Output Modes

- Default: prose crank-handle block.
- `--raw`: tab-separated `id\tsender[ ↩parent]\tbody`.
- `--json`: one JSON line per message.
- `--tail`: classic infinite loop for humans watching a terminal.
- `--once`: single poll-pass, emit current backlog, exit (no waiting).

## Resume And Cursor Hygiene

PD Tube stores a small per-channel cursor under the Port Daddy home
directory (`~/.port-daddy/tube-history-<safe>.json`). It tracks both
`lastSeenId` (so the next call does not re-emit messages already seen)
and `lastForeignEventId` / `lastForeignSender` (so `--reply "body"`
knows who to thread).

```bash
pd tube ui:clicks --since=42 --once
pd tube ui:clicks --no-history --limit=10 --once
```

`--since` overrides the cursor with an explicit floor. `--no-history`
leaves the cursor untouched (use for test fixtures).

## Chat Bridge

`pd tube chat` listens to the same threaded channel, launches one
backend run for each new top-level message, and posts the result back
as an in-thread reply. This is the quick bridge for "PD Tube plus
Codex/Claude/Gemini" experiments while keeping the transcript inside
Port Daddy channel history.

```bash
pd tube chat port-daddy:demo:tube \
  --backend codex \
  --tier low \
  --budget 5 \
  --once
```

Use `--model` when you need an exact model, or `--tier low|mid|high`
when the backend's built-in ladder is enough. The bridge skips its
own replies by default so it does not loop on itself.

## Proof Artifacts

The checked-in demo artifacts are generated from real commands
against the live Port Daddy daemon:

- `examples/pd-tube/demo.sh`
- `demos/pd-tube/pd-tube-real-output.cast`
- `demos/pd-tube/pd-tube-real-output.gif`
- `demos/pd-tube/pd-tube-real-output.tape`
- `demos/pd-tube/pd-tube-vhs.gif`

![PD Tube real output recording](../../demos/pd-tube/pd-tube-real-output.gif)

Regenerate them from the repo root with:

```bash
asciinema rec --overwrite -c "examples/pd-tube/demo.sh" demos/pd-tube/pd-tube-real-output.cast
agg demos/pd-tube/pd-tube-real-output.cast demos/pd-tube/pd-tube-real-output.gif
vhs demos/pd-tube/pd-tube-real-output.tape
```

Note: the recordings predate the prose-default change and still show
the legacy tab-separated output. The behavior is the same; the
formatting on disk does not match the new default until the cast is
regenerated.
