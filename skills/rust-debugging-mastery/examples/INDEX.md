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
- `sample-input.json`: a well-formed debug-session plan (async hang correctly routed to tokio-console
  with the unstable flags set) that `scripts/debug_plan_audit.mjs` scores `pass:true`.
- `sample-input-lldb-for-async-hang.json`: the flagship anti-pattern — attaching `rust-lldb` to an
  async hang — which the auditor flags `pass:false` with a `critical` finding.
