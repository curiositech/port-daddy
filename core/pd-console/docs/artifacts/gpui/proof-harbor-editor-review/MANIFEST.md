# Harbor editor review-state proof

Native GPUI evidence for the bounded Harbor editor review pass on PR #1960.
The captures use the real `pd-console` binary and the named codebase daemon at
`http://127.0.0.1:3182`; the canonical daemon on `9876` was not targeted.

## Runtime truth

- Final daemon: `harbor-linework`, PID `45055`, Port Daddy `3.24.2`, revision
  `cadea4946`, plane `ephemeral:harbor-linework`.
- Native app: PID `21683`, `core/target/debug/pd-console`, window `3223` on the
  off-operator-screen display selector `2`.
- `/agent-nodes` returned `data: []` with a non-stale roster projection. No
  actors, claims, conflicts, approvals, or collaboration were seeded in the UI.
- The motion recording was driven through the app's real control socket by
  changing panes. It does not inject frontend-authored daemon state.
- The reduced-motion image uses the same layout and state evidence as the
  normal image; the plan's static caret-line orientation cue remains visible.

Machine-readable runtime details are in [`runtime-state.json`](./runtime-state.json).

## Stills

- Editor, normal motion: ![Editor normal motion](./editor-normal.png)
- Harbor, empty daemon projection: ![Harbor normal motion](./harbor-normal.png)
- Editor, reduced motion: ![Editor reduced motion](./editor-reduced-motion.png)

## Motion

- [Native motion GIF](./editor-motion.gif)
- [Native motion MP4](./editor-motion.mp4)
- [Native ScreenCaptureKit MOV](./editor-motion.mov)

The MP4 is `1208x800`, `7.065s`, H.264, and contains 188 frames. Frame
deduplication found nine visually distinct frames, proving that the real app
consumed the transition rather than yielding a static recording.

## Validation represented by this packet

- `cargo test --manifest-path core/pd-console/Cargo.toml --bin pd-console-repl`
  — 376 passed, 0 failed.
- `cargo test --manifest-path core/pd-console/Cargo.toml --test story_motion_contract`
  — 3 passed, 0 failed.
- `CARGO_INCREMENTAL=0 cargo build --manifest-path core/pd-console/Cargo.toml --bin pd-console --features gpui`
  — passed with existing warnings.
- The GPUI binary-as-test target SIGBUSes in `libgpui_macros`/`syn`; the same
  SIGBUS reproduces at unchanged PR revision `f400336e1`. The application build,
  focused non-GPUI suites, and native runtime proof are green; the inherited
  test-target compiler crash is not represented as passing.
