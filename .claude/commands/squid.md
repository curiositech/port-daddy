---
description: Toggle or inspect the Port Daddy Giant Squid harness for this project
allowed-tools: Bash(pd squid:*), Bash(pd hooks:*)
---

Run `pd squid $ARGUMENTS` via Bash (default to `pd squid status` when no
arguments are given) and relay the result concisely.

If the subcommand was `on` or `off`, tell the user hook and statusline
changes apply to the NEXT Claude Code session — this one keeps its current
wiring until restarted.
