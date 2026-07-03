# Rust Kernel FFI

Build a Rust `cdylib` that a TypeScript/Bun runtime calls via `koffi` FFI, for
a security kernel or enforcement core.

Use this skill when exposing Rust to Node/Bun (`#[no_mangle] extern "C"`,
JSON-over-C-string functions plus a free fn), bridging a Rust
crypto/capability primitive to a daemon, loading a `.dylib`/`.so` with koffi
and degrading gracefully when it's absent, or writing panic-free fail-closed
Rust across an FFI boundary.

## Quick Start

1. Read `SKILL.md` for the decision points, the worked example (Rust export +
   free fn + koffi loader), and the failure-mode table.
2. Design the export plan: which functions cross the boundary, what guards
   they need, whether they hand out a string.
3. Validate the plan against `schemas/ffi-plan.schema.json`, then run
   `node scripts/ffi_safety_audit.mjs --input plan.json` to check it against
   the skill's quality gates deterministically.
4. Implement following the repo exemplars named in `SKILL.md`
   (`core/harbor-card-rs/src/lib.rs`, `lib/arbiter.ts`, `scripts/build-core.sh`).
5. Verify under the real runtime (the bun daemon), not only `cargo test`/jest.

A plan that scores `pass: true` should mean the FFI boundary cannot panic
across `extern "C"`, cannot leak a handed-out string, cannot pass an
ABI-unstable Rust type, and degrades gracefully when the dylib is missing. If
it doesn't, fix the plan (and the code it describes), not the auditor.
