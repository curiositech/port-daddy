# Operator charge ledger index

Rolling reconstruction of the uncompacted rollout, one row per actual user-role message. Counts are source-message counts, not counts of content blocks.

| Part | Source messages | Rows | Publication evidence | Status / unknowns |
|---|---:|---:|---|---|
| [Part 01](part-01-messages-001-027.md) | 001–027 | 27 | PR #9990, head `97fef215e2b3f48211b1ec6986e5eb44abb3997f` | Published branch; markdownlint style findings remain. Message 001 corrected after review. |
| [Part 02](part-02-messages-028-055.md) | 028–055 | 28 | PR #9990, same head before part 03 | Included in PR branch; verify CI/current head after update. |
| [Part 03](part-03-messages-056-082.md) | 056–084 | 29 | PR #9990; related Harbor runtime proposal PR #9991 | Added through source cut 2026-09-01T09:35:54.884Z; review/CI state must be read back. |
| **Total** | **001–084** | **84** | PR #9990 rolling publication; PR #9991 proposal evidence | No claim that listed product work is shipped. Later messages append as deltas. |

## Publication and authority matrix

| Evidence | What it can prove | What remains unknown |
|---|---|---|
| PR #9989 | Separate concurrent publication artifact only | Exact scope/current head must be read from GitHub. |
| PR #9990 | This ledger’s publication channel | Merge/CI/review state after the latest push must be read back. |
| PR #9991 | Harbor Agent Runtime proposal publication evidence; supports the conditional approval recorded at message 084 | Does not prove implementation shipped or runtime parity. |
| PR #9992 | Separate concurrent publication artifact only | Exact scope/current head must be read from GitHub. |
| Source JSONL | Chronology, message ids, operator wording | Does not prove implementation, ownership, or current runtime state. |
| Delegation/skill attachments | Provenance and context | Do not independently authorize product changes. |

Known outstanding lanes referenced by the messages include Porthole/universal cooperative stage, Chartroom remote authority, salvage/recovery, durable actors and attribution, Cloudflare-agent research, worktree/daemon isolation, PR harvest, and product/website strategy. These are charges or hypotheses, not completion claims. Supersession and dependency decisions require canonical roadmap read-back; this ledger intentionally does not mint them.
