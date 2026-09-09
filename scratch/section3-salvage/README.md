# Section-3 items, isolated for review

Per instruction, kept out of the live `lib/`/`apps/`/`core/` trees pending
review rather than inserted directly:

- `backend-bin-resolver.ts` — resolves absolute CLI binary paths at daemon
  install time (launchd/systemd PATH is minimal); small, self-contained.
- `cli-codex-transcript.ts` (+ test) — a JSONL transcript parser for Codex CLI
  v0.139.0 (wrapped-item and flat schema). The equivalent Claude/Gemini/
  Cloudflare parsers are confirmed already on `main`; this one specifically
  was not checked against `main` in the original sweep — check
  `lib/spawner/` on `main` before assuming it's missing.
- `product-marketing-context.md`, `content-strategy-2026-06.md` — product
  positioning and voice-guideline documents.
- `media-capture-runbook.md` — found and documented a real bug (three
  marketing-site screenshots were byte-identical despite claiming different
  UI panes).
- `conjure.rs` — a Rust module for rendering predicted DAGs in the pd-console
  UI (serde-portable `PredictedDag`/`PredictedWave`/`PredictedNode` types).
  Likely an early seed of what's now the `gpui-rust-console` skill/prototype
  on `main` — check for overlap before reusing.

`cli-codex-transcript.test.js` is the source branch's own test for
`cli-codex-transcript.ts`, kept alongside it for reference — it is **not** under
`tests/` and is not picked up by this repo's jest config, so it does not run in CI.
