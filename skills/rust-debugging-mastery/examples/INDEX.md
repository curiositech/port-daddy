# Examples

Real-shaped debug-session transcripts. Each shows the symptom, the wrong first move, the
diagnosis with exact commands and output, and the fix.

- `dyld-segfault-onnxruntime.md`: a native onnxruntime addon segfaults a daemon on startup because
  `libonnxruntime.dylib` is not on the dyld search path. Walks `DYLD_PRINT_RPATHS`, `otool -L`/`-l`,
  `nm`+`c++filt`, the `install_name_tool` → `@loader_path` → `codesign` fix, and detect-and-disable.
  Pairs with `references/02-native-ffi-and-dyld.md`.
- `async-stall-tokio-console.md`: a daemon "hangs" with one core pinned; a `.await`-free loop is
  starving the Tokio executor. Found via tokio-console's `never-yielded` warning; fixed with
  `interval().tick().await` + `spawn_blocking`. Pairs with `references/01-tracing-and-async.md`.
