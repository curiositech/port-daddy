# PR #637 — Lane work-chat proof + supersession finding

This PR was held only on "fresh native GPUI visual proof for this revision".
Investigating that produced a bigger finding first:

**PR #637 is superseded by merged PR #641** (`cf46ccfd0`, 2026-07-03). #641's
history contains a byte-identical twin of this branch's tip commit
("Add structured Lane operator turns", `760e40ac8`; `git diff` vs `b25baa17b`
on `lane_pane.rs`/`pane.rs` = 0 lines), and `origin/main` has since moved
*beyond* this branch — merging it today would delete ~861 lines of newer Lane
work (Scout screenshot wiring, ImageArtifact tones, planner rename). Proving
this revision would prove an obsolete UI.

So the artifacts here prove **the feature at its merged main revision**, live
in a native GPUI window, captured via PR #694's scripting control plane
(`--control-sock`, typed JSON `state` dumps — display capture is TCC-denied in
the agent environment):

| File | Proof |
| --- | --- |
| `ping.json` | Console booted, bound to daemon `:3104`, focused on the agent lane. |
| `state-lane-work-chat.json` | The live Lane rendering an agent work chat: `Agent Work Chat` header, `watching proof-agent-1`, `● live` chip, `operator` chat turns, file references as dedicated `artifact` rows, and tube echoes as `steer` turns — the closed steering loop this PR set out to build, working on main. |
| `manifest.json` | Full six-field provenance per artifact, honest labels. |

**Recommendation:** close this PR as superseded by #641. It stays draft — its
own body says "draft and not merge-ready", and the honest gate here is not a
missing screenshot anymore; it is that the branch content already shipped.
