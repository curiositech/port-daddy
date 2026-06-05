# Coast Guard — `pd-cutter` (prototype)

Agentic safety on the operator's machine. Wrap any agent command so it **cannot
read your secrets** and **cannot burn unbounded spend**, and get a **receipt** of
what it did. See **ADR-0050** for the full decision + threat model.

```
pd-cutter [--cap USD] [--max-requests N] -- <agent command...>
```

## What it does (three moves)

1. **Confine** — a macOS Seatbelt profile denies reads to `~/.ssh`, `~/.aws`,
   `~/.gnupg`, cloud creds, and every `**/.env.local`, while allowing normal work.
   (Linux: Landlock/seccomp — phase 0.)
2. **Meter** — `egress-meter.py` is a local proxy (`HTTPS_PROXY`) that counts
   per-host requests/bytes and **hard-refuses** past the cap (`503 Spend Cap
   Exceeded`). A runaway/looping agent cannot bankrupt you.
3. **Receipt** — a JSON record of cmd, exit, what was confined, and metered egress.

## Demos (run on a real Mac)

```
$ pd-cutter -- cat ~/.ssh/known_hosts        # → Operation not permitted  (BLOCKED)
$ pd-cutter -- cat .../.env.local            # → Operation not permitted  (BLOCKED)
$ pd-cutter -- head package.json             # → works (normal work unaffected)
$ pd-cutter --max-requests 2 -- <3 API calls># → receipt {"requests":3,"blocked":1,"cap":2}
```

## Honest limits (read this)

This is **privilege separation, not novel cryptography.** It defends the
**cooperative case** — runaway spend, leaked-key blast radius, confused deputy,
accidental exfiltration. It does **NOT** defend a **truly-malicious same-UID
agent**: with your shell it can `unset HTTPS_PROXY` and egress directly, or read a
stray key elsewhere. *A secret a process can use, it can copy.* Real enforcement
against that needs a separate UID / VM + pf forced egress (ADR-0050 phase 4),
which trades away "the agent edits your live tree." Dollar-accurate metering needs
MITM + provider-`usage` parsing (phase 2); this prototype caps by request/byte.
