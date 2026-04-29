# PD Tube Examples

`pd tube` is a small conversation pipe over Port Daddy channels. It is useful
when an agent or script needs a durable, threaded handoff without parsing a
human chat transcript.

## Run The Proof Demo

From the repo root:

```bash
examples/pd-tube/demo.sh
```

The script uses the live daemon and posts to `port-daddy:demo:tube`. It sends a
top-level message, replies to that message, then reads the channel back as JSON
lines.

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

The commands intentionally hit the daemon instead of echoing canned output.
