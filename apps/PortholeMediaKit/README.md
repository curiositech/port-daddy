# PortholeMediaKit

Shared iOS 17 / macOS 14 offline media fixture primitives. Both native packages depend on this local Swift package; neither starts recording or networking by importing it.

`SyntheticSegmentWriter.write(_:in:)` produces a unique directory containing an H.264 movie from generated BGRA patterns. Input is a validated `SyntheticSegmentPlan`, not arbitrary screen pixels. Each movie is independently encoded, with zero-based presentation timestamps at an integer 600-tick timebase, no frame reordering, and at most two seconds between requested keyframes. Plans cap each operation at five seconds, 60 fps, and 1920×1080. Only one pixel buffer is filled at a time; no raw-frame history is accumulated. Each writer rejects overlapping operations with `busy`. Callers must bound writer instances and reserve disk capacity separately.

`PlaybackTimeline` resolves half-open source intervals to segment-local ticks or an explicit gap. It rejects overlaps, implicit holes, and reversed intervals. Playback clients must render gaps as unavailable, not continue showing the previous frame as current evidence.

Cancellation, encoding failure, deadline expiry, or observed output-size overflow attempts best-effort removal of only the operation's newly created directory. Filesystem cleanup failures are not surfaced separately and may leave synthetic fixture output behind. Successful output belongs to the caller. The byte check is an observed output limit, not a filesystem quota: encoder buffering can temporarily exceed it. The 30-second deadline is cooperative; AVFoundation cancellation/finalization may block. No sealed archive, crash recovery, persistent index, privacy admission, HEVC hardware guarantee, live capture, network delivery, audio, or remote-control authority is implemented here.

Run offline round-trip and rejection tests:

```sh
swift test --package-path apps/PortholeMediaKit
```

Tests decode independently created files, check sampled pixels, timestamps/duration/first keyframe/keyframe spacing/no audio, seek into a GOP, and cover invalid plans, gaps, byte-limit cleanup and cancellation. A deterministic first-frame test seam exercises in-flight cancellation and concurrent-write rejection. Hosted native CI explicitly runs these dependency tests; consumer `swift test` does not run dependency test targets. iOS device performance and text readability remain release gates.
