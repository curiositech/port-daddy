# Testing FFI boundaries & cross-language parity

Consult when a Rust crate is called over a C ABI (from Node/Bun via koffi/napi,
Python via cffi/PyO3, etc.), or when the same logic exists in two languages and
must stay identical.

## 1. Test the safety contract, not just the happy path

An `extern "C"` function's contract is "never crash the host." The interesting
tests are the *guards* — the inputs that must return a sentinel instead of
panicking or dereferencing garbage:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::{c_char, CStr};

    fn call(json: &str) -> Option<String> {
        let b = json.as_bytes();
        let ptr = unsafe { pd_assess_json(b.as_ptr() as *const c_char, b.len()) };
        if ptr.is_null() { return None; }
        let out = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
        unsafe { pd_string_free(ptr) };   // exercise the free fn too
        Some(out)
    }

    #[test] fn happy_path_round_trips()      { assert!(call(r#"{"now":1}"#).is_some()); }
    #[test] fn malformed_json_returns_null() { assert!(call("{not json").is_none()); }
    #[test] fn empty_input_returns_null() {
        let p = unsafe { pd_assess_json(std::ptr::null(), 0) };
        assert!(p.is_null());
    }
    #[test] fn freeing_null_is_safe()        { unsafe { pd_string_free(std::ptr::null_mut()) }; }
}
```

Each of the five FFI guards (null ptr, len==0, len>bound, non-utf8, parse error)
deserves a test that proves it returns the sentinel. A panic inside an
`extern "C"` body is UB; if you rely on `catch_unwind`, write a test whose input
would panic the inner logic and assert you still get the sentinel (not an abort).

## 2. The single worst FFI testing trap: the harness that silently falls back

When the foreign side has a "use Rust if the dylib loads, else fall back to a
pure-language impl" design, a parity test can **pass while testing nothing**: if
the dylib isn't loaded in the test environment, both sides run the *same*
fallback code and trivially agree.

This bites specifically because **the dylib loader often does not work in the
unit-test harness** even when it works in the real runtime. (Concrete case:
koffi `require()` under Jest's transformed ESM context fails to load the `.dylib`
that loads fine under the real Bun/tsx runtime — so a Jest "parity" test runs
TS-vs-TS and is green regardless of the Rust impl.)

Rules:

1. **Assert the kernel is actually loaded before asserting parity**, and make
   "not loaded" a *loud* outcome, never a silent pass:

   ```ts
   if (!kernelAvailable()) {
     console.warn(`[parity] dylib not loaded (${loadError()}); ran fallback only.`);
     // optionally assert wrapper==fallback as a sanity check, but DO NOT claim parity
     return;
   }
   for (const v of VECTORS) expect(viaKernel(v)).toEqual(viaFallback(v));
   ```

2. **Verify real parity under the real runtime, not only the unit harness.** If
   Jest can't load the dylib, prove parity with a `tsx`/`bun` script (or a Rust
   integration test that loads the cdylib) and treat the Jest test as a
   convenience that degrades honestly. "Works in the unit harness, breaks under
   the real loader" (or vice-versa) is a real and common FFI failure mode —
   ABI/width mismatches (`usize`↔`size_t`), and runtime-specific load paths.

## 3. Shared test vectors for two implementations

When the same algorithm lives in Rust and another language (a crypto primitive, a
scheduler, a health assessor), the only thing that prevents silent drift is a
single set of vectors both run:

```
vectors/
  cases.json        # [{ name, input, expected }] — language-agnostic
```

- Each side reads `cases.json`, runs its impl, asserts `output == expected`.
- Generate `expected` from ONE reference impl (or hand-author it), commit it, and
  make changing it a deliberate, reviewed act.
- For pure functions, prefer comparing the two impls *directly* on a shared input
  set (Rust-vs-other) rather than against a frozen `expected`, so a change in
  behavior must be made in both or the parity test fails. Frozen vectors catch
  "did the meaning change"; direct comparison catches "did the two drift."

Better than vectors when you can: **don't have two implementations.** Extract one
pure core (an `rlib` / `cdylib`) and have the other language call it via FFI, with
the second impl existing only as a graceful fallback. Then there is one source of
truth and the "parity" test mainly guards the fallback. (See the main SKILL's
"one source of truth" note.)

## 4. napi-rs / PyO3 specifics

- **napi-rs**: test the Rust logic as a plain `rlib` (`cargo test`) — keep the
  `#[napi]` wrappers thin so almost nothing needs the Node runtime. For the thin
  binding layer, a small JS test under `node --test`/vitest exercises the real
  `.node` addon. Build the addon for the *same* Node ABI the test runtime uses or
  you get `NODE_MODULE_VERSION` mismatch (a native-binding ABI error, not a logic
  bug — same class as any prebuilt native module loaded under the wrong Node).
- **PyO3**: same split — unit-test the pure Rust, then a `pytest` that imports the
  built module via `maturin develop`. Use `#[cfg(test)]` Rust tests for logic;
  reserve Python tests for the binding surface.

## 5. ABI-mismatch is a distinct failure class — name it

If a test fails to even *load* the artifact (`cannot find symbol`,
`NODE_MODULE_VERSION N != M`, `image not found`, dlopen errors), that is an
ABI/build/signing problem, not a test-logic problem. Diagnose with the right
tool before touching test code: `nm -gU lib.dylib | grep <sym>` (symbol present?),
`file`/`lipo -info` (architecture?), `codesign -dv` (signed for arm64?), and
confirm the loader's candidate paths point at the freshly built artifact.
