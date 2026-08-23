# PD Tube Examples

`pd tube` is the single command that turns any local UI, hook, or
webhook into an event your running agent can answer in one shell call.

## The Browser Button

`button-to-agent.html` is a small page that publishes a click as a
JSON event to `/msg/ui:clicks` and polls the same channel for the
agent's reply. No SDK, no MCP, no websocket — just `fetch()`.

Open Mission Control through the daemon at
`http://127.0.0.1:9876/samples/files/examples/pd-tube/mission-control.html`.
Opening `mission-control.html` directly from disk redirects there automatically.
That same-origin hop is intentional: the daemon does not trust the opaque `null`
origin used by arbitrary `file://` pages.

The agent side runs once:

```bash
pd tube ui:clicks
```

That blocks until the click arrives, prints a prose "crank-handle"
block telling the agent how to reply, and exits. The agent does the
work, then runs:

```bash
pd tube ui:clicks --reply "Deployed to staging. CI is green."
```

That single command posts a reply correlated to the most recent event
from someone other than this listener (tracked as
`lastForeignEventId` in the per-channel cursor) AND continues
listening. The browser polls, sees the reply with `inReplyTo` set,
and renders it next to the button.

For very long bodies pipe stdin: `echo "…" | pd tube ui:clicks --reply -`.

For explicit threading the legacy shape still works:

```bash
printf 'roger' | pd tube ui:clicks --reply=42 --send --sender codex
```

## Run The Proof Demo

From the repo root:

```bash
examples/pd-tube/demo.sh
```

The script uses the live daemon and posts to `port-daddy:demo:tube`.
It sends a top-level message, replies to that message, then reads the
channel back as JSON lines.

## Recordings

The same script is used by the recording artifacts:

- `demos/pd-tube/pd-tube-real-output.cast`
- `demos/pd-tube/pd-tube-real-output.gif`
- `demos/pd-tube/pd-tube-real-output.tape`
- `demos/pd-tube/pd-tube-vhs.gif`

Regenerate them with:

```bash
asciinema rec --overwrite -c "examples/pd-tube/demo.sh" demos/pd-tube/pd-tube-real-output.cast
agg demos/pd-tube/pd-tube-real-output.cast demos/pd-tube/pd-tube-real-output.gif
vhs demos/pd-tube/pd-tube-real-output.tape
```

The commands intentionally hit the daemon instead of echoing canned
output. Note: the recordings predate the prose-default change and
still show the legacy tab-separated output. The behavior is the
same; re-record with `--raw` if you want machine-friendly lines, or
without flags for the new default prose block.
