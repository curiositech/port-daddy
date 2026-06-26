# Worked example: a native addon segfaults the daemon on startup

**Symptom.** A Rust/Node daemon that uses an onnxruntime embedding model dies immediately on
launch on a colleague's Apple Silicon Mac — no Rust panic, no JS stack trace, just the process
gone. It works fine on the machine that built it. The error in the crash log:

```
dyld[40912]: Library not loaded: @rpath/libonnxruntime.1.20.1.dylib
  Referenced from: <.../node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node>
  Reason: tried: '.../libonnxruntime.1.20.1.dylib' (no such file)
zsh: abort      ./daemon
```

This is **not** a bug in the daemon's logic — it is a *load-time* dyld failure that aborts the
host. Diagnosis below; the symptom shape (`Library not loaded` / `image not found`) routes
straight to `references/02-native-ffi-and-dyld.md`.

---

## Step 1 — confirm it's a search-path problem, not a missing file

The dylib does exist somewhere (it was bundled). The question is whether dyld's `@rpath` search
resolves it. Watch dyld work:

```console
$ DYLD_PRINT_RPATHS=1 DYLD_PRINT_LIBRARIES=1 ./daemon 2>&1 | grep -i onnx
RPATH failed expanding @rpath/libonnxruntime.1.20.1.dylib to: '/opt/app/lib/libonnxruntime.1.20.1.dylib' (file not found)
RPATH failed expanding @rpath/libonnxruntime.1.20.1.dylib to: '/usr/local/lib/libonnxruntime.1.20.1.dylib' (file not found)
```

So the addon's `LC_RPATH` entries point at `/opt/app/lib` and `/usr/local/lib`, but the bundled
dylib actually lives **next to the addon** under `node_modules/...`. The rpath is wrong for this
install layout.

> If `DYLD_PRINT_RPATHS=1` had printed **nothing**, the daemon binary would be SIP-protected /
> hardened and the `DYLD_*` vars stripped — in that case skip env-var debugging and go straight
> to the `@loader_path` fix (Step 4a).

## Step 2 — read the install names and rpaths directly

```console
$ otool -L node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node
onnxruntime_binding.node:
	@rpath/libonnxruntime.1.20.1.dylib (compatibility version 1.0.0, current version 1.20.1)
	/usr/lib/libc++.1.dylib (...)
	/usr/lib/libSystem.B.dylib (...)

$ otool -l .../onnxruntime_binding.node | grep -A2 LC_RPATH
          cmd LC_RPATH
      cmdsize 32
         path /opt/app/lib (offset 12)
--
          cmd LC_RPATH
      cmdsize 40
         path /usr/local/lib (offset 12)
```

Confirmed: the addon asks dyld for `@rpath/libonnxruntime.1.20.1.dylib`, and `@rpath` expands to
two dirs that don't contain it. The dylib is right there in the same folder as the `.node`, so the
clean fix is to make the addon look beside *itself*.

## Step 3 — rule out the *other* failure (symbol mismatch)

Before rewriting paths, make sure this isn't an ABI skew masquerading as a path problem (it isn't
here, but the check is cheap and the two are easy to confuse):

```console
$ nm -u .../onnxruntime_binding.node | c++filt | grep -i 'Ort::' | head -3
                 U Ort::Session::Session(OrtEnv const&, char const*, Ort::SessionOptions const&)
                 U Ort::Env::Env(OrtLoggingLevel, char const*)
$ nm -gU libonnxruntime.1.20.1.dylib | c++filt | grep -i 'Ort::Session::Session' | head -1
0000000000a1b2c0 T Ort::Session::Session(OrtEnv const&, char const*, Ort::SessionOptions const&)
```

The symbol the addon imports **is** exported by the dylib (and demangles to the same signature),
so this is purely "image not found", not "symbol not found". Good — a path fix will work.

## Step 4 — fix it (and pick the right fix for the situation)

### 4a. Durable fix: rewrite to `@loader_path`, then re-sign

```console
$ cd node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64
$ install_name_tool -id @loader_path/libonnxruntime.1.20.1.dylib libonnxruntime.1.20.1.dylib
$ install_name_tool -change @rpath/libonnxruntime.1.20.1.dylib \
    @loader_path/libonnxruntime.1.20.1.dylib onnxruntime_binding.node
install_name_tool: warning: changes being made to the file will invalidate the code signature in: .../onnxruntime_binding.node
```

That warning is the trap: on arm64 the kernel SIGKILLs unsigned/invalidated code on load, so the
"fix" would still crash — with a *different* error (`code signature invalid`) — until you re-sign:

```console
$ codesign --force --sign - libonnxruntime.1.20.1.dylib
$ codesign --force --sign - onnxruntime_binding.node
$ codesign -v onnxruntime_binding.node && echo "signature OK"
signature OK
$ ./daemon
[info] onnxruntime loaded; embedding model ready
```

### 4b. Quick dev unblock (NOT for the shipped app)

```console
$ DYLD_FALLBACK_LIBRARY_PATH="$PWD" ./daemon     # works only because this dev `node`/daemon isn't SIP-protected
```

Do not put this in the app's launch path: once the daemon is signed/hardened (or launched by a
signed parent), SIP strips `DYLD_*` and it silently stops working.

## Step 5 — the real lesson: don't let an optional library kill the daemon

The deeper bug is that a *missing embedding model* should degrade the **feature**, not crash the
**process**. The startup code was:

```rust
// BEFORE — one bad dylib aborts the whole daemon:
let ort = Library::new("libonnxruntime.1.20.1.dylib").expect("onnxruntime");
```

A hard dyld abort can't be caught after the fact, so guard it with a recoverable probe and degrade:

```rust
// AFTER — missing native lib disables embeddings, daemon stays up:
let embeddings = match unsafe { Library::new("@loader_path/libonnxruntime.1.20.1.dylib") } {
    Ok(lib) => Some(EmbeddingEngine::new(lib)),
    Err(e) => {
        tracing::warn!(error = %e, "onnxruntime unavailable; semantic search disabled, BM25 fallback active");
        None
    }
};
```

Now a teammate without the model gets BM25 search and a warning line, not a dead daemon.

---

## What this example exercised

- Symptom → tool routing: `Library not loaded` / `image not found` ⇒ dyld, not lldb, not Miri.
- `DYLD_PRINT_RPATHS` / `DYLD_PRINT_LIBRARIES` to watch resolution (and the SIP-stripping tell).
- `otool -L` (install names) and `otool -l ... LC_RPATH` (search dirs).
- `nm -u` / `nm -gU` + `c++filt` to rule out a symbol/ABI mismatch.
- `install_name_tool -id/-change` → `@loader_path` → the mandatory `codesign --force --sign -`.
- Detect-and-disable so an optional native dependency degrades a feature instead of aborting the
  process.

Full reference: `references/02-native-ffi-and-dyld.md`.
