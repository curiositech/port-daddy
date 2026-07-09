# PR #896 pd-console editor visual proof

Fresh proof captured from branch `codex/pd-console-editor-perf-rescue`.
Capture code HEAD before adding these artifacts: `51cf2910687ae888671c071edc697a5d82e79b31`
Rebased onto `origin/main` at `78a73d744`.

## Target

- Display selector: `104115ce-748a-4d96-afa9-170076c0e4b4`
- Display index at capture time: `1`
- Display role: BetterDisplay virtual screen `pd-proof`
- Primary display was not used.
- Capture method: launched this branch's `core/target/release/pd-console`
  with `--display 104115ce-748a-4d96-afa9-170076c0e4b4`, resolved the launched
  process's Quartz window id by PID, captured stills with
  `screencapture -x -o -l<windowid>`, and recorded motion with
  `core/pd-console/scripts/proof/recorder.swift --window-id <windowid>`.

## Files

- `pd-console-editor-codebuffer.png` - still screenshot of the Harbor editor `CodeBuffer` surface.
- `pd-console-editor-codebuffer.mp4` - web-friendly motion artifact from the same pd-console window id.
- `pd-console-editor-codebuffer.gif` - GIF preview of the same motion artifact.
- `pd-console-editor-codebuffer.mov` - raw ScreenCaptureKit recorder output.

## SHA-256

- `pd-console-editor-codebuffer.png`:
  `ee8138442c6c8395b62310697cbfe544cfcba998330d368ccdca4e5151e20f0e`
- `pd-console-editor-codebuffer.mov`:
  `2a58ca989c8f828b06b394c2fc4d0b950f5eb02f6712300c1b57220fb6adcbb1`
- `pd-console-editor-codebuffer.mp4`:
  `bf801bed2fb1da3b5b6a2398b216dbafa28737a45ecf7ecca4052bbc9b0f3f82`
- `pd-console-editor-codebuffer.gif`:
  `f7251e62b616446f5c3f4ebe1e957f3024bcee3022b1ab51412cc117e052eb5e`

## What It Shows

- `--pane "edit core/pd-console/src/syntax.rs"` on this branch.
- Virtualized `CodeBuffer` editor rendering.
- Syntax-highlight runs.
- Always-visible author gutter.
- Demo merged-agent author rows via `PD_CONSOLE_DEMO_AUTHORS=1`.
