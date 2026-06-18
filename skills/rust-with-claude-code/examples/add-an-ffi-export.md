# Example: add a fail-closed C-ABI export the TS daemon calls via koffi

Goal: expose a new kernel function (say a harbor-card freshness check) over the C ABI so
`lib/` can call the canonical Rust impl instead of re-deriving it in TS. Mirrors the real
`core/kernel/pd-anchor/src/ffi.rs` (ADR-0054).

## 1. Make the crate a cdylib (if it isn't already)

`core/kernel/pd-anchor/Cargo.toml` already has it; for a new kernel crate:

```toml
[lib]
crate-type = ["rlib", "cdylib"]   # rlib: in-Rust + tests; cdylib: the .dylib/.so koffi loads
```

## 2. Scaffold the export from the template

```bash
cp skills/rust-with-claude-code/templates/ffi_export.rs.tmpl core/kernel/pd-anchor/src/card_ffi.rs
# substitute:
#   {{prefix}}   -> pd          (so the symbol is pd_card_fresh_json)
#   {{op}}       -> card_fresh
#   {{Request}}  -> FfiCardFreshRequest
#   {{Response}} -> FfiCardFreshResponse
```

Wire the real check into the "do the real work here" block, returning
`respond(true/false, reason)`. Add `mod card_ffi;` to the crate's lib root.

## 3. The four rules are non-negotiable (the template enforces them)

- whole body in `catch_unwind` — a panic across C is UB
- guard null / `len==0` / `len > MAX_REQUEST_BYTES` / utf8 / parse before touching data
- fail **closed**: every path returns `{"ok":false,...}`; null only on alloc failure
- the caller frees: pair every `*_json` with the shared `pd_string_free`
- mark `# Safety` on each `unsafe extern "C"` (clippy `missing_safety_doc` enforces)

## 4. Test it in-process — no dylib build needed

The template ships a `call_via_ffi` helper and two tests: a valid input authorizes, and the
malformed-input sweep (`["", "not json", "{}", ...]` + null pointer) must **fail closed,
never panic**. Run:

```bash
python3 skills/rust-with-claude-code/scripts/cargo_diagnostics.py run --crate core/kernel
cd core/kernel && cargo test -p pd-anchor card_ffi
```

This exercises the exact exported entry point (guards, catch_unwind, free contract) under
plain `cargo test`, no koffi, no `.dylib`.

## 5. The koffi side (`lib/`)

Follow `lib/macaroon-ffi.ts`:

```ts
const fn = lib.func('void* pd_card_fresh_json(const char* req, size_t len)');
const free = lib.func('void pd_string_free(void* ptr)');     // shared free
const ptr = fn(req, Buffer.byteLength(req));                  // byteLength, not .length
try { return JSON.parse(koffi.decode(ptr, 'char', -1)); }    // -1 = read to NUL
finally { free(ptr); }                                        // ALWAYS free
```

Declare the return `void*` (opaque) so you keep the pointer to free it; never `char*`
(koffi would decode-and-forget it). Provide a byte-parity TS fallback for installs without
the dylib, and lock it with a shared parity vector (`tests/fixtures/...-parity-vectors.json`)
so the `rust-kernel` CI job (always-run) proves the two paths agree.

## What a novice gets wrong

- Forgetting `catch_unwind` → a `serde` panic on weird input unwinds across C = UB, often a
  silent corruption, not a clean crash.
- Returning null for "verification failed" → callers can't distinguish "denied" from "kernel
  exploded." Fail closed with a JSON `{"ok":false}` and reserve null for alloc failure.
- `Buffer.byteLength` vs `.length` → multi-byte UTF-8 makes `len` wrong; the Rust side reads
  past the end or truncates.
- Declaring the koffi return as `char*` → no pointer left to `pd_string_free`, so you leak
  every call.
