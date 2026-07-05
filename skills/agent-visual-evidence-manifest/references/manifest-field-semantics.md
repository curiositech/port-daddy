# Manifest Field Semantics

Use this when you need to know what each provenance field actually proves, why all six are required, and why an honest `mock`/`fixture` label is fine but an absent one is not.

## Why a manifest at all

A screenshot is a picture of a UI at some moment. On its own it proves nothing about whether that UI was wired to a real, running daemon or a static fixture someone typed by hand. The redteam finding this gate exists to close names the failure directly:

> "LIVE" appears because a session row exists, not because heartbeat or transcript events are current. A transcript pane is populated by fixture JSON, not provider or hook output. ... A receipt says "tests passed" because an agent wrote that sentence, not because command output is attached and hash-linked.
>
> — `docs/architecture/agent-harbor-technical-binder/work-packets/redteam-agent-harbor-control-plane.md`, "False Proof And Compliance Theater," item 5

The fix that finding prescribes is exactly this manifest's field set: "Visual artifact manifests must identify the daemon port, run id, transcript head hash, agent node id, control command id when relevant, commit, and whether data is real, fixture, or mock." This skill audits that manifest, nothing else.

## The six fields

| Field | Proves | Why it alone isn't enough |
| --- | --- | --- |
| `daemonPort` | The capture happened against a specific running daemon instance, not a static export or a screenshot of a design mock. | A port number can still be a stale or dead daemon — pair with `runId` and `transcriptHeadHash` to bind it to a live session. |
| `runId` | Which agent session/run produced the state shown. | A run id can be reused across restarts; it needs `transcriptHeadHash` to pin a specific point in that run's event stream. |
| `transcriptHeadHash` | The transcript's HEAD hash at capture time — the artifact matches one specific, replayable point in the real event stream, not an arbitrary later or earlier state. | Doesn't prove the *events themselves* are provider-sourced rather than fixture JSON; that's a runtime-verification concern, not something a manifest field alone settles (see `sandboxed-adversarial-test-harness` for adversarial proof of stream authenticity). |
| `agentNodeId` | Which agent node/body was running, so the artifact can be cross-referenced against that node's own logs. | Doesn't prove the node was doing real work versus idling; combine with the transcript hash. |
| `commit` | The artifact reflects the code actually under review, not an earlier or later version of the surface. | This is why `commit-mismatch` is a critical finding, not advisory — a "before" screenshot passed off as "after" is a specific, common failure mode ("existing screenshots/GIFs on the branch are reused after the implementation changed"). |
| `sourceLabel` | An honest declaration of what produced the data: `real` (live daemon), `fixture` (canned but declared data), or `mock` (stubbed UI state, declared). | This is the field that makes the other five trustworthy. A perfectly filled-in manifest with a `mock` label is fine — it says "this doesn't prove the runtime claim, don't read it as if it does." The same manifest with `sourceLabel` silently absent is dishonest by omission, which is why it gets its own `undeclared-source-label` finding on top of the generic missing-field one. |

## `real` / `fixture` / `mock` are not a ranking

Do not treat `fixture` or `mock` as a lesser-quality answer to force up to `real`. They are different, equally legitimate claims:

- `real`: captured against a live daemon-backed run at the stated port/run/transcript coordinates.
- `fixture`: captured against canned but explicitly-declared test data (e.g. an empty-state screenshot that doesn't need a live agent).
- `mock`: a stubbed UI state (e.g. a Figma-to-code static render) used to illustrate a design intent, not a runtime claim.

The gate never requires every artifact be `real`. It requires every artifact *say* which one it is, so a reviewer (or the required-fix test harness) can tell a runtime claim from an illustration. Auditing whether a `real`-labeled artifact is actually a disguised mock is out of scope for a structural manifest audit — that needs the live daemon-connection proof this skill's `pairs-with sandboxed-adversarial-test-harness` calls out (a canary that opens the real daemon and diffs against what the artifact claims), not a JSON schema check.
