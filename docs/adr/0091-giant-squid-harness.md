# 0091. The Giant Squid Harness — Hijack the vendor loop

## Status

Superseded by [ADR-0051](0051-port-daddy-harness.md) — 2026-07-20.

## Context

This ADR was the original design for "hijack the vendor CLI loop via
hooks" — mapping port-daddy's maritime primitives onto the `UserPromptSubmit`
/ `PreToolUse` / `PostToolUse` hook surface exposed by vendor CLIs (Claude
Code, Codex, Gemini) so that coordination logic fires *inside* the vendor's
own agent loop instead of wrapping it. `lib/squid/*.ts` and `bin/pd-hook-*`
were built against this ADR, which is why their file headers cited
`ADR-0091` for a time.

[ADR-0051](0051-port-daddy-harness.md) is the same architecture carried
further: it binds eight concrete harness capabilities to the same three hook
events, specifies the previously-unbuilt daemon Reconcile Loop that projects
durable coordination state (tube messages, swarm conflicts, CI verdicts,
parley invites, rent status) into the Ink Cloud hot cache, carries a
per-capability Claude/Codex/Gemini vendor-portability matrix, and has a
phased rollout with roadmap slugs. It also documents the real, still-open
security gap this ADR did not surface: the `PreToolUse` matcher only covers
`Edit|Write|MultiEdit|NotebookEdit`, so `Bash` (and therefore `rm -rf`,
`git push --force`, `cat .env.local`) passes the harness unseen.

This file is kept on disk per this repo's ADR-numbering convention — ADR
numbers are permanent history and are never deleted or reused — but no new
work should cite `ADR-0091`. Cite [ADR-0051](0051-port-daddy-harness.md)
instead; the code comments that used to cite `ADR-0091` have been updated
accordingly.

The maritime terminology this ADR coined — the **Ink Cloud** (the POSIX
`~/.port-daddy/matrix.env` hot cache), the **tentacles** (the `pd-hook-*`
scripts), and the **Jamie Madrox pattern** (highly parallelized, ephemeral
agents appending to the matrix concurrently) — carries forward unchanged
into ADR-0051 and the shipped code.

## References

- [ADR-0051](0051-port-daddy-harness.md) — the canonical, Accepted harness
  ADR that supersedes this one.
