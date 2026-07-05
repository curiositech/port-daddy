# MCP Servers for Rust Development — Research & Recommendations

**Scope:** Which MCP servers make Rust development easier for **port-daddy**, specifically the
`core/` cargo workspace: the `pd-console` GPU-native app (`gpui`, Metal/macOS, behind a
`--features gpui` flag), the `pd-timeline-proto` Metal R&D window (`winit + wgpu + Vello`),
plus `pd-bosun`, `pd-tui`, `harbor-card-rs`, `pd-broker`, and the `kernel/*` crates. The
TypeScript daemon is already covered by the existing Serena (TS) config.

**Date:** 2026-06-26 · **Branch:** `docs/rust-dev-mcps` · **Author:** research agent

---

## TL;DR — install these 3 now

1. **Add `rust` to the existing Serena config** (not a new server) — semantic code intelligence
   (go-to-def, find-refs, rename, symbol overview, diagnostics) for the Rust crates. Serena is
   already installed and used here; it only lists `typescript` today.
2. **`Vaiz/rust-mcp-server`** — the cargo action layer Serena lacks: `cargo build/check/test/
   clippy/fmt/doc`, `cargo add/search/info`, `rustc-explain`, `cargo-deny`, `cargo-machete`,
   `cargo-hack`. Actively maintained (commits within days of this report).
3. **A crate-docs MCP** (`@nuskey8/docs-rs-mcp`, npx, paste-ready) — so the model stops guessing
   crate APIs against `gpui`/`wgpu`/`winit`/`vello`, which are exactly the fast-moving,
   under-trained crates in this repo.

The ready-to-paste config for all three is in **[Install these 3 now](#install-these-3-now-paste-ready)**.

### Does Serena already cover Rust? — Yes (semantics), No (cargo actions)

**Serena fully supports Rust semantics.** It wraps language servers via `multilspy`/Solid-LSP and
supports 40+ languages including Rust; as of recent versions it uses the **`rust-analyzer` from your
own `rustup` toolchain** rather than a bundled binary. So a dedicated `rust-analyzer`/LSP-bridge MCP
(zeenix/rust-analyzer-mcp, bug-ops/mcpls, Tritlo/lsp-mcp, isaacphi/mcp-language-server) is **redundant
here** — it would duplicate what Serena already gives you, with less maturity. ([Serena repo](https://github.com/oraios/serena),
[multilspy/rust-analyzer writeup](https://www.chrismalpass.net/posts/serena-mcp-server/))

**Two caveats specific to this repo:**

- Serena/`rust-analyzer` does **not** run cargo for you (build/test/clippy/fmt are out of scope of
  LSP) — that gap is why `Vaiz/rust-mcp-server` is recommended alongside it.
- `rust-analyzer` is **not currently installed** in this environment (`rustup which rust-analyzer`
  fails). Prerequisite: `rustup component add rust-analyzer`. And because `pd-console`'s `gpui` code
  is behind a feature flag, rust-analyzer (and therefore Serena) will **not index it** until you set
  `rust-analyzer.cargo.features` to include `gpui` (see [config notes](#repo-specific-config-notes)).

---

## Ranked table

Maturity verified via GitHub API on 2026-06-26 (stars / last push / archived / license).

| Rank | MCP | What it does | Install (paste-ready transport) | Maturity | Verdict |
|------|-----|--------------|-------------------------------|----------|---------|
| 1 | **Serena + `rust`** ([oraios/serena](https://github.com/oraios/serena)) | Semantic code intelligence over the Rust crates: symbol overview, go-to-def, find-refs, rename, find-implementations, diagnostics. LSP-backed (rust-analyzer). | Already installed — **config edit only** (add `rust` to `languages`) + `rustup component add rust-analyzer` | 25.8k★, pushed 2026-06-26, MIT, very active | **install-now** (edit) |
| 2 | **`Vaiz/rust-mcp-server`** ([repo](https://github.com/Vaiz/rust-mcp-server)) | Full cargo action layer: build/check/test/doc/fmt/clippy/clean, add/remove/update/search/info/metadata, `rustc-explain`, rustup show/update, cargo-deny / machete / hack / insta. | `cargo install rust-mcp-server`; stdio | 32★, pushed 2026-06-24, no license file, **active** | **install-now** |
| 3 | **`@nuskey8/docs-rs-mcp`** ([repo](https://github.com/nuskey8/docs-rs-mcp)) | Live crates.io/docs.rs lookup: search crates, README, per-item docs, in-crate symbol search. npx, zero toolchain. | `npx @nuskey8/docs-rs-mcp@latest`; stdio | 33★, npm v1.0.1, pushed 2025-07-31, MIT | **install-now** (docs slot) |
| 4 | **`vexxvakan/mcp-docsrs`** ([repo](https://github.com/vexxvakan/mcp-docsrs)) | Same docs.rs/crates.io niche as #3 but more active; binary/Docker only (no npx). crate_lookup / crate_docs / crate_find / symbol_lookup / symbol_docs. | Docker `ghcr.io/vexxvakan/mcp-docsrs:latest` or prebuilt binary; stdio | 12★, pushed 2026-06-08, Apache-2.0, active | **try** (docs alt to #3) |
| 5 | **`Govcraft/rust-docs-mcp-server`** ([repo](https://github.com/Govcraft/rust-docs-mcp-server)) | Per-crate **semantic** docs server: embeds one crate's full docs (vector search) for deep Q&A on a single dependency. | `cargo install`, **one server instance per crate**, needs OpenAI API key for embeddings | 282★ (most-starred), pushed 2025-11-24 (stale ~7mo), MIT | **watchlist** |
| 6 | **`bug-ops/mcpls`** ([repo](https://github.com/bug-ops/mcpls)) | Universal LSP→MCP bridge (any language server, incl. rust-analyzer) exposed as MCP tools. | `cargo install`; stdio | 44★, pushed 2026-06-24, Apache-2.0, active but 31 open issues | **skip** (Serena covers it) |
| 7 | **`zeenix/rust-analyzer-mcp`** ([repo](https://github.com/zeenix/rust-analyzer-mcp)) | Dedicated rust-analyzer MCP: hover, defs, refs, symbols. | `cargo install rust-analyzer-mcp`; stdio | 71★, pushed 2025-09-01 (stale), MIT, 16 open issues | **skip** (redundant w/ Serena) |
| 8 | **`Tritlo/lsp-mcp`** ([repo](https://github.com/Tritlo/lsp-mcp)) | Generic LSP→MCP bridge (TS). | npx; stdio | 125★, pushed 2025-07-21 (stale), MIT | **skip** (redundant w/ Serena) |
| 9 | **`isaacphi/mcp-language-server`** ([repo](https://github.com/isaacphi/mcp-language-server)) | Popular generic LSP→MCP (Go): defs, refs, rename, diagnostics. | `go install`; stdio | 1.6k★, pushed 2026-03-01, BSD-3 | **skip** (redundant w/ Serena; useful only if you drop Serena) |
| 10 | **`jbr/cargo-mcp`** ([repo](https://github.com/jbr/cargo-mcp)) | Cargo build/test/clippy/fmt subset. | `cargo install cargo-mcp`; stdio | 15★, pushed 2026-05-18, Apache-2.0 | **skip** (subset of #2) |
| 11 | **`seemethere/cargo-mcp`** ([repo](https://github.com/seemethere/cargo-mcp)) | Cargo build/test/clippy/check/fmt (Python). | uvx/pip; stdio | 2★, pushed 2025-06-17 | **skip** (subset of #2, barely maintained) |
| 12 | **`pato/crates-mcp`** ([repo](https://github.com/pato/crates-mcp)) | crates.io/docs.rs info, versions, deps. | `cargo install`; stdio | 14★, pushed 2025-06-28, **no license** | **skip** (overlaps #3/#4, stale, unlicensed) |
| 13 | **`46ki75/mcp-rust-docs`** ([repo](https://github.com/46ki75/mcp-rust-docs)) | crates.io/docs.rs docs retrieval (Rust). | `cargo install`; stdio | 0★, pushed 2026-06-22, Apache-2.0 | **skip** (active but unproven; #3 covers it) |

> **No dedicated `gpui` / `wgpu` / `Metal` / Naga / FFI-inspection MCP exists** as of this research.
> The closest leverage for that work is: (a) the crate-docs MCP (#3/#4) pointed at `gpui`, `wgpu`,
> `naga`, `vello`, `winit`; (b) Serena's semantic navigation across your own shader/render code; and
> (c) `rustc-explain` in #2 for the borrow-checker errors that dominate GPU-resource lifetime code.
> Building a Metal/Naga-aware MCP would be net-new work, not an install. ([wgpu](https://wgpu.rs/),
> [Naga MSL backend context](https://rust-gpu.github.io/blog/2025/07/25/rust-on-every-gpu/))

---

## Install these 3 now (paste-ready)

### 1. Serena — add Rust (edit the existing config, install rust-analyzer)

`rust-analyzer` must be on the toolchain first:

```bash
rustup component add rust-analyzer
```

Then add `rust` to `.serena/project.yml` `languages` (TypeScript stays for the daemon):

```yaml
languages:
  - typescript
  - rust
```

No new `mcpServers` entry is needed — Serena is already wired. Restart the MCP client so Serena
re-onboards and starts the rust-analyzer language server. (First index of the workspace will be slow;
the `gpui` bin is skipped unless you enable the feature — see [config notes](#repo-specific-config-notes).)

### 2 & 3. Add to `.mcp.json` (`mcpServers`)

```bash
cargo install rust-mcp-server
mkdir -p log
```

```jsonc
{
  "mcpServers": {
    "rust-dev": {
      "command": "rust-mcp-server",
      "args": ["--log-file", "log/rust-mcp-server.log"]
    },
    "rust-docs": {
      "command": "npx",
      "args": ["-y", "@nuskey8/docs-rs-mcp@latest"]
    }
  }
}
```

Notes:
- `rust-mcp-server` resolves from `~/.cargo/bin` after `cargo install`; use an absolute path if your
  MCP client doesn't inherit your shell `PATH`. (The upstream README shows a Windows `.exe` path —
  on macOS it's `~/.cargo/bin/rust-mcp-server`.) ([source](https://github.com/Vaiz/rust-mcp-server))
- `@nuskey8/docs-rs-mcp` is verified live on npm (`v1.0.1`) and runs over stdio via npx. ([source](https://github.com/nuskey8/docs-rs-mcp))
- This repo's existing `.mcp.json` currently only declares `21st-dev-magic`; merge the entries above
  into the same `mcpServers` object rather than overwriting it.

---

## Repo-specific config notes

- **Cargo workspace.** `core/Cargo.toml` is a workspace; both `rust-mcp-server` and rust-analyzer
  operate at the workspace root. Run/launch the MCP client from `core/` (or pass the manifest path)
  so cargo commands target the workspace, not the repo root.
- **`gpui` feature gating (critical).** `pd-console`'s GPU window only compiles under
  `--features gpui` (the default Linux/CI `cargo check` skips it). Two consequences:
  - For **Serena/rust-analyzer** to see the `gpui` code, set in your rust-analyzer settings:
    `"rust-analyzer.cargo.features": ["gpui"]` (or `"all"`). Otherwise go-to-def/find-refs are blind
    to the GPU shell.
  - For **`rust-mcp-server`**, pass features through its `cargo-build`/`cargo-clippy` tool args when
    you want it to actually compile the Metal path; the default check won't catch `gpui`-only errors.
- **Heavy `gpui` builds.** `gpui` is a large Metal-centric build; expect the first `cargo build
  --features gpui` (and rust-analyzer's first proc-macro/build-script pass) to be slow. Keep the
  default fast `cargo check` for the headless REPL / `kernel/*` crates and only invoke the gpui
  feature when working the console.
- **`pd-timeline-proto` (wgpu/Vello).** No MCP understands WGSL/MSL shader translation; the
  crate-docs MCP pointed at `wgpu`, `naga`, `vello`, `winit` is the best available assist there.

---

## Watchlist (revisit, don't install yet)

- **`Govcraft/rust-docs-mcp-server`** (282★) — the most powerful docs option: vector-embeds a *single*
  crate's full docs for deep semantic Q&A. Compelling for a gnarly dependency like `gpui`, but (a) it
  runs **one process per crate**, (b) needs an **OpenAI key** for embeddings, and (c) has been
  **stale since 2025-11-24**. Worth a spike specifically for `gpui`/`wgpu` if #3 proves too shallow.
  ([repo](https://github.com/Govcraft/rust-docs-mcp-server))
- **`vexxvakan/mcp-docsrs`** (Apr–Jun 2026 activity, Apache-2.0) — more actively maintained than #3,
  same docs niche, but binary/Docker only. Swap in if `@nuskey8/docs-rs-mcp` stagnates.
  ([repo](https://github.com/vexxvakan/mcp-docsrs))
- **`bug-ops/mcpls`** — actively developed universal LSP bridge; only relevant if you ever drop Serena
  and want a lighter LSP→MCP shim. ([repo](https://github.com/bug-ops/mcpls))

## Skip (with reasons)

- **`zeenix/rust-analyzer-mcp`, `Tritlo/lsp-mcp`, `isaacphi/mcp-language-server`** — all duplicate
  Serena's LSP semantics; Serena is more mature and already installed. Adding one means two language
  servers fighting over the same rust-analyzer. ([zeenix](https://github.com/zeenix/rust-analyzer-mcp),
  [Tritlo](https://github.com/Tritlo/lsp-mcp), [isaacphi](https://github.com/isaacphi/mcp-language-server))
- **`jbr/cargo-mcp`, `seemethere/cargo-mcp`** — strict subsets of `Vaiz/rust-mcp-server` (no
  rustc-explain, no deny/machete/hack, no dependency tooling). ([jbr](https://github.com/jbr/cargo-mcp),
  [seemethere](https://github.com/seemethere/cargo-mcp))
- **`pato/crates-mcp`** (no license, stale), **`46ki75/mcp-rust-docs`** (0★, unproven) — both overlap
  the chosen docs MCP without advantages. ([pato](https://github.com/pato/crates-mcp),
  [46ki75](https://github.com/46ki75/mcp-rust-docs))

---

## Honest maturity caveats

- **`Vaiz/rust-mcp-server` ships no `LICENSE` file** (verified via GitHub API: `license=none`).
  It's MIT-described in places but legally ambiguous as-is — fine for local dev tooling, flag it if
  it ever ships in a product. Otherwise it's the healthiest cargo MCP (commits within days).
- **`@nuskey8/docs-rs-mcp` last pushed 2025-07-31** (~11 months). It queries *live* docs.rs, so server
  staleness matters far less than for a vendored-data server, but it is not actively developed.
- **The whole category is young.** Every server here is a small project (most under 100★, several
  one-author). Treat them as convenience tooling, pin versions, and don't build critical workflow on
  any single one. Serena is the only heavyweight, and it's the one doing the load-bearing work.
- **No MCP targets `gpui`/Metal/`wgpu`/Naga directly** — confirmed by registry + GitHub search. That
  remains a manual / Serena-navigation + crate-docs problem.

---

## Sources

- Serena — https://github.com/oraios/serena
- Serena Rust / multilspy / rustup rust-analyzer — https://www.chrismalpass.net/posts/serena-mcp-server/
- Vaiz/rust-mcp-server — https://github.com/Vaiz/rust-mcp-server · https://crates.io/crates/rust-mcp-server
- nuskey8/docs-rs-mcp — https://github.com/nuskey8/docs-rs-mcp · npm `@nuskey8/docs-rs-mcp`
- vexxvakan/mcp-docsrs — https://github.com/vexxvakan/mcp-docsrs
- Govcraft/rust-docs-mcp-server — https://github.com/Govcraft/rust-docs-mcp-server
- bug-ops/mcpls — https://github.com/bug-ops/mcpls
- zeenix/rust-analyzer-mcp — https://github.com/zeenix/rust-analyzer-mcp
- Tritlo/lsp-mcp — https://github.com/Tritlo/lsp-mcp
- isaacphi/mcp-language-server — https://github.com/isaacphi/mcp-language-server
- jbr/cargo-mcp — https://github.com/jbr/cargo-mcp · seemethere/cargo-mcp — https://github.com/seemethere/cargo-mcp
- pato/crates-mcp — https://github.com/pato/crates-mcp · 46ki75/mcp-rust-docs — https://github.com/46ki75/mcp-rust-docs
- cargo-expand (macro expansion reference) — https://github.com/dtolnay/cargo-expand
- wgpu — https://wgpu.rs/ · Naga/MSL context — https://rust-gpu.github.io/blog/2025/07/25/rust-on-every-gpu/
- MCP servers registry — https://github.com/modelcontextprotocol/servers · https://mcpservers.org/ · https://www.pulsemcp.com/
