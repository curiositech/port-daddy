# Coast Guard — agentic safety on the operator's machine

Wrap any agent so it **cannot read your secrets** and **cannot burn unbounded
spend**, and get a **receipt** of what it did. See **ADR-0050** for the full
decision + threat model.

## Two surfaces

1. **Shipped & wired into the spawner (`lib/coast-guard.ts`).** Every agent Port
   Daddy spawns through a subprocess backend (`codex`, `claude-cli`, `aider`,
   `custom`, `cli:*`) runs under the Coast Guard **BY DEFAULT** — OS sandbox +
   secret broker + hard egress cap. This is the real, tested module; see the
   live demo: `npx tsx tools/coast-guard/demo.ts`.
2. **`pd-cutter` (prototype CLI).** The standalone bash wrapper below — the
   original proof-of-concept that seeded the design. Kept for manual use.

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

Spawner-wired module (the shipped path):

```
$ npx tsx tools/coast-guard/demo.ts
  PASS .env.local read BLOCKED: ... Operation not permitted
  PASS ~/.ssh listing BLOCKED
  PASS normal project file ALLOWED (work unaffected)
  PASS env dump after scrub has no raw key
  PASS over-cap request HARD-REFUSED (402 Spend Cap Exceeded)
```

Prototype CLI:

```
$ pd-cutter -- cat ~/.ssh/known_hosts        # → Operation not permitted  (BLOCKED)
$ pd-cutter -- cat .../.env.local            # → Operation not permitted  (BLOCKED)
$ pd-cutter -- head package.json             # → works (normal work unaffected)
$ pd-cutter --max-requests 2 -- <3 API calls># → receipt {"requests":3,"blocked":1,"cap":2}
```

## How to opt a spawn out (power users)

The Coast Guard is the default. A single spawn can run unconfined with
`coastGuard:false` in the spawn spec, or the operator can disable it process-wide.
Per repo policy this opt-out is **never named in agent-facing refusal messages** —
it lives here, in the docs, for humans.

## Honest limits (read this)

This is **privilege separation, not novel cryptography.** It defends the
**cooperative case** — runaway spend, leaked-key blast radius, confused deputy,
accidental exfiltration. It does **NOT** defend a **truly-malicious same-UID
agent**: with your shell it can `unset HTTPS_PROXY` and egress directly, or read a
stray key elsewhere. *A secret a process can use, it can copy.* Real enforcement
against that needs a separate UID / VM + pf forced egress (ADR-0050 phase 4),
which trades away "the agent edits your live tree." Dollar-accurate metering needs
MITM + provider-`usage` parsing (phase 2); this prototype caps by request/byte.
