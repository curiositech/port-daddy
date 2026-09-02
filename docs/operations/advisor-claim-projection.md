# Advisor claim projection

`pd advise`, MCP `coordination_preflight`, and `GET`/`POST /advisor` read the same deterministic advice. They do not acquire claims, repair session metadata, migrate a database, grant permission, or prove that a change is ready to merge.

## Address and boundary

The lookup uses the session's repository partition plus the current Git worktree ID, then verifies the recorded root and anchor ID against the current physical worktree root. A matching filename alone is never enough: another repository, a sibling worktree, or a short-ID collision with a different root cannot supply ownership or contention.

Within that verified scope, `src/example.ts`, `./src/example.ts`, and an absolute path below the same physical root resolve to one root-relative claim address. Absolute paths remain separate for symbol-index lookups. Symbol paths and line ranges are retained; a region claim is not presented as a whole-file claim. Outside-root paths, `..` components, and symlink escapes are rejected, including not-yet-created files beneath a symlink.

Stored forest worlds are checked when present. Older `session_files` rows without a corresponding forest record can be read only under verified session scope. The advisor does not instantiate a write-capable forest or backfill it during a read.

## Context diagnostics

| Advice ID | Meaning | Next action |
| --- | --- | --- |
| `context.claim-scope-inconsistent` | Recorded session/root/repository/forest witnesses disagree. | Inspect the exact session and original claims; use an authorized recovery path. Do not rewrite IDs or borrow another actor's credential. |
| `context.claim-scope-unavailable` | The current Git worktree boundary cannot be established. | Inspect the selected project/worktree and its availability. No global-session fallback is used. |
| `context.files-outside-root` | A requested path escapes, traverses, or cannot be resolved within the root. | Correct the intended source path or select its actual project. |
| `claims.stale-legacy-projection` | A legacy row still looks active but its forest record was released, as can happen with repeated region claims or normalized-spelling releases. | Inspect recorded history. The old row supplies no live claim coverage; a current replacement still counts. This warning is not a global stop. |

Inconsistent scope includes the recorded claim count and a bounded sample of original claim paths, selectors, and worlds. Claims remain in their recorded world. The advisor suppresses claim coverage and refinement advice until scope is consistent, instead of recommending duplicate claims to hide the mismatch. These diagnostics do not identify the historical producer of a stale anchor or imply that a repair has occurred.

Both HTTP methods accept `files` and `changedFiles`; GET uses comma-separated strings and POST uses arrays. Existing authentication and mutation authority are unchanged. Cross-repository authorization throughout other daemon surfaces is a separate program, not an assurance made by this projection repair.
