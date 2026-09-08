# Giant Squid Hooks — reference hub

Per-tentacle contracts and the vendor capability matrix. Each file stands
alone; the shared doctrine (fail-open, POSIX sh, bounded output, dial
resolution, the Codex stdout rule) lives in the bundle's `SKILL.md`.

| File | Covers |
|---|---|
| [prompt.md](prompt.md) | `bin/pd-hook-prompt` — turn-start context injection + SITREP compulsion |
| [pre-tool.md](pre-tool.md) | `bin/pd-hook-pre-tool` — the L2 edit-moment lock gate |
| [post-tool.md](post-tool.md) | `bin/pd-hook-post-tool` — legacy pheromone trace (retired from lifecycles) |
| [stop.md](stop.md) | `bin/pd-hook-stop` — the L4 end-of-turn SITREP closeout gate |
| [vendor-matrix.md](vendor-matrix.md) | Verified per-vendor Stop/AfterAgent event facts (2026-08-23) |

Reading order for a first pass: vendor-matrix → prompt → stop (the compulsion
and verification halves of the same contract), then pre-tool, then post-tool
(history and why per-tool observation died).
