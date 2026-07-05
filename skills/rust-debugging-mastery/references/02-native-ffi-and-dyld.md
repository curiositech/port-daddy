# Native FFI & macOS dyld debugging

> The highest-value section: a missing or mis-pathed `.dylib` does not throw — on a hard load
> failure **dyld aborts the entire host process**. There is no exception to catch after the
> fact. You diagnose with `otool`/`DYLD_PRINT_*`/`nm`, you fix with `install_name_tool`+`codesign`
> or with a guarded probe, and you make the host *degrade* instead of die.

All flags, env vars, and error strings below are quoted from Apple man pages / real GitHub
issues. Sources at the bottom.

---

## 1. The failure, verbatim

A native Node addon (`.node` is a `cdylib` Mach-O) or a Rust `cdylib` that depends on, say,
`libonnxruntime.dylib`, when that dylib is not on the search path:

```
dyld: Library not loaded: @rpath/libonnxruntime.1.20.1.dylib
  Referenced from: /…/node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node
  Reason: image not found
```

Other real spellings of the same class:

- `dlopen(libonnxruntime, 1): image not found` (microsoft/onnxruntime #9707)
- `Library not loaded: @rpath/libonnxruntime.1.20.1.dylib … (unloadable mach-o file type 10` (#23922)
- `code object is not signed at all` → on Apple Silicon the kernel **SIGKILLs** the load (#16168)

Because the addon is `dlopen`'d into the host (`node`/`electron`/your daemon), a hard failure
takes the **whole process** down (SIGABRT/SIGKILL) — the JS/Rust caller never gets to handle it.

---

## 2. Diagnose: see what dyld is doing

```bash
# Every Mach-O image dyld loads, and from where (verifies your search-path is working):
DYLD_PRINT_LIBRARIES=1 ./your_host_binary

# Every @rpath expansion dyld tries and whether the candidate file exists:
DYLD_PRINT_RPATHS=1 ./your_host_binary

# Every dyld API call (dlopen/dlsym):
DYLD_PRINT_APIS=1 ./your_host_binary

# Combine and filter:
DYLD_PRINT_LIBRARIES=1 DYLD_PRINT_RPATHS=1 ./your_host_binary 2>&1 | grep -i onnx
```

> **SIP gotcha — the #1 "works in terminal, not in the app".** With System Integrity Protection
> on, dyld **strips every `DYLD_*` (and `LD_*`) variable** when launching a *protected* / signed
> / hardened-runtime / system binary, and the stripping **propagates across `exec`**. If
> `DYLD_PRINT_*` prints nothing despite being set, the target is SIP-protected — the env vars
> were stripped. Stop fighting SIP; fix the install names (§4). The same reason makes
> `export DYLD_LIBRARY_PATH=...` workarounds silently useless inside a packaged Electron app.

---

## 3. Inspect the Mach-O: install names, `@rpath`, symbols

The three dyld "magic" prefixes baked into a Mach-O, substituted at load time:

- **`@executable_path`** → directory of the **main executable** (the host). Good for app bundles,
  bad for a `.node`/`.dylib` loadable by any host.
- **`@loader_path`** → directory of the **binary doing the loading** (the addon itself). This is
  what a self-contained addon wants: it finds its sibling dylib regardless of host.
- **`@rpath`** → indirection; dyld substitutes each `LC_RPATH` entry of the loading binary in
  order until the dylib is found. The actual dirs come from `LC_RPATH` load commands.

```bash
# What does this binary depend on, and what install name will dyld resolve for each?
otool -L onnxruntime_binding.node
otool -L libonnxruntime.dylib

# What are the @rpath search dirs (LC_RPATH load commands)?
otool -l onnxruntime_binding.node | grep -A2 LC_RPATH

# What is the dylib's own install id (LC_ID_DYLIB)?
otool -D libonnxruntime.dylib

# Modern alternative (Xcode 13.3+ / LLVM 13):
objdump --macho --rpaths onnxruntime_binding.node
```

A line like `@rpath/libonnxruntime.1.20.1.dylib` in `otool -L` is *exactly* the string dyld
looks up — it will search the `LC_RPATH` entries for it. If none resolve to an existing file →
"image not found".

### Symbol mismatches (the *other* failure: "Symbol not found")

Distinct from "image not found": the dylib loads, but a symbol the addon needs isn't there
(ABI/version skew — addon built against a different header/dylib version).

```bash
# nm flags: -g global/external, -u undefined (imported), -U not-undefined (defined), -j names-only
nm -u onnxruntime_binding.node | sort > needs.txt      # symbols the addon imports
nm -gU libonnxruntime.dylib    | sort > provides.txt   # symbols the dylib exports (global+defined)
comm -23 needs.txt provides.txt                         # needed but not provided = the culprits

# nm prints MANGLED C++ names — demangle:
nm -gU libonnxruntime.dylib | c++filt        # __ZN3Ort... -> Ort::Session::Session(...)
nm -u onnxruntime_binding.node | c++filt
```

If a needed symbol *is* exported but still "not found", confirm both resolve to the **same**
dylib via `otool -L` — you probably have two copies on the path.

---

## 4. Fix, ranked robust → fragile

### (a) Bundle next to the addon, rewrite to `@loader_path`, re-sign — the durable fix

Immune to SIP-stripped `DYLD_*`. `install_name_tool` flags (verbatim man-page semantics):
`-id` "changes the shared library identification name"; `-change old new` "changes the dependent
shared library install name"; `-add_rpath`/`-delete_rpath`/`-rpath old new` manage `LC_RPATH`.

```bash
cp libonnxruntime.dylib node_modules/onnxruntime-node/bin/.../arm64/

# 1. point the dylib's own id at @loader_path so consumers reference a sibling:
install_name_tool -id @loader_path/libonnxruntime.dylib libonnxruntime.dylib
# 2. rewrite the addon's dependency to its sibling copy:
install_name_tool -change @rpath/libonnxruntime.1.20.1.dylib \
  @loader_path/libonnxruntime.dylib onnxruntime_binding.node
# (alternative to -change: add a loader-relative rpath)
# install_name_tool -add_rpath @loader_path onnxruntime_binding.node
```

> **Codesign-invalidation gotcha (mandatory on Apple Silicon).** `install_name_tool` mutates the
> Mach-O *after* signing and warns: *"changes being made to the file will invalidate the code
> signature."* On arm64 **all** code must be validly signed or the kernel SIGKILLs it on load
> ("code signature invalid"). Re-sign after **every** edit:
> ```bash
> codesign --force --sign - libonnxruntime.dylib       # ad-hoc "-" identity is fine for dev
> codesign --force --sign - onnxruntime_binding.node
> codesign -v libonnxruntime.dylib                     # silence == valid
> ```

### (b) `DYLD_FALLBACK_LIBRARY_PATH` / `DYLD_LIBRARY_PATH` — dev only

```bash
DYLD_FALLBACK_LIBRARY_PATH=/path/to/dylib/dir ./your_host_binary
```

Works **only** for non-SIP-protected hosts (a plain `node` you built/own). **Ignored** for signed
/ hardened Electron apps. Note the default fallback is version-dependent: for *old* binaries
`/usr/local/lib:/usr/lib`; for binaries linked **Fall 2023+ there is no fallback default at all**
(the legacy `$HOME/lib:/usr/local/lib:/lib:/usr/lib` is stale — do not rely on it).

### (c) Drop the dylib in `/usr/local/lib` (or `/opt/homebrew/lib`) — discouraged

On the fallback path for older binaries; pollutes the system and fails for "new binary, no
default". A crutch, not a fix.

### (d) Detect-and-disable — the production answer for *optional* native features

A hard dyld abort can't be caught, so **probe before you commit to loading**, and degrade the
feature, not the process.

```rust
// Rust: libloading turns dlopen failure into a recoverable Err (it carries dlerror() verbatim):
match unsafe { libloading::Library::new("libonnxruntime.dylib") } {
    Ok(lib)  => { /* enable the ML feature */ }
    Err(e)   => {
        tracing::warn!(error = %e, "onnxruntime unavailable; disabling ML feature");
        // run with the feature off — the daemon stays up
    }
}
```

```c
// C / dlopen: RTLD_NOLOAD probes resolution WITHOUT risking a process-killing load:
void *probe = dlopen("@loader_path/libonnxruntime.dylib", RTLD_NOW | RTLD_LOCAL | RTLD_NOLOAD);
if (!probe) fprintf(stderr, "onnx not resolvable: %s\n", dlerror());  // dlerror() is one-shot: read once
```

For Node, `try { require('…/addon.node') } catch (e) { /* fall back */ }` catches a *JS-level*
load throw — but a hard dyld abort still kills the process, so verify with `otool -L` / a
`RTLD_NOLOAD` probe **before** the `require`, or load the addon in a **child process** you can
supervise and restart.

---

## 5. Rust panics across the FFI boundary

- A Rust `panic!` unwinding out of an `extern "C"` function is forbidden. It was **undefined
  behavior before Rust 1.81 (Sept 2024)**; since 1.81 the compiler inserts a guard that turns
  such an unwind into a **defined process `abort`** — still fatal, just no longer UB. Say
  "abort (UB before 1.81)", not a flat "UB".
- **Bound it with a shim** at every `extern "C"` entry point:
  ```rust
  #[no_mangle]
  pub extern "C" fn my_addon_call(/* … */) -> i32 {
      let r = std::panic::catch_unwind(|| { /* real work that may panic */ });
      match r { Ok(_) => 0, Err(_) => -1 }   // never let the unwind cross the boundary
  }
  ```
- **`catch_unwind` caveat (verbatim docs):** *"This function only catches unwinding panics, not
  those that abort the process."* So if the crate is built `panic = "abort"`, `catch_unwind`
  catches **nothing**. Pick one model deliberately:
  - `panic = "unwind"` **plus** a `catch_unwind` shim per `extern "C"` entry → recoverable, graceful.
  - `panic = "abort"` → simpler/smaller, but any panic kills the host (no graceful degradation).
- **Intentional** unwinding across the boundary (rare): use the `extern "C-unwind"` ABI (stable
  since 1.81) so a Rust unwind can propagate to a C++ frame that expects it. Do **not** use it to
  paper over a missing `catch_unwind` when the C side is `-fno-exceptions`.

---

## Sources

- [dyld(1) — Apple/Xcode man page](https://keith.github.io/xcode-man-pages/dyld.1.html)
- [dlopen(3) — Apple/Xcode man page](https://keith.github.io/xcode-man-pages/dlopen.3.html)
- [install_name_tool(1)](https://keith.github.io/xcode-man-pages/install_name_tool.1.html) · [nm(1)](https://keith.github.io/xcode-man-pages/nm.1.html)
- [Hynek Schlawack — macOS environment-variable sanitization (SIP strips DYLD_*)](https://hynek.me/articles/macos-dyld-env/) · [OpenJDK JDK-8139288](https://bugs.openjdk.org/browse/JDK-8139288)
- [microsoft/onnxruntime #9707 — dlopen image not found on macOS](https://github.com/microsoft/onnxruntime/issues/9707)
- [microsoft/onnxruntime #23922 — Library not loaded: @rpath/libonnxruntime.1.20.1.dylib](https://github.com/microsoft/onnxruntime/issues/23922)
- [microsoft/onnxruntime #16168 — dylib not signed → SIGKILL on Apple Silicon](https://github.com/microsoft/onnxruntime/issues/16168)
- [k2-fsa/sherpa-onnx #2622 — Electron on macOS, SIP strips DYLD_LIBRARY_PATH](https://github.com/k2-fsa/sherpa-onnx/issues/2622)
- [Apple Developer Forums — install_name_tool vs codesign (re-sign with codesign -f)](https://developer.apple.com/forums/thread/747909) · [TN2206 Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)
- [Marcin Krzyżanowski — @rpath / @loader_path / @executable_path explained](https://blog.krzyzanowskim.com/2018/12/05/rpath-what/)
- [The Rust Reference — Panic / extern "C" unwinding](https://doc.rust-lang.org/reference/panic.html) · [std::panic::catch_unwind](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html) · [RFC 2945 c-unwind ABI](https://rust-lang.github.io/rfcs/2945-c-unwind-abi.html)
- [rust-lang/rust #52652 — abort instead of unwinding past FFI](https://github.com/rust-lang/rust/issues/52652)
