# Worked planning fixtures

These fixtures make the planning methods in the skill checkable. They are local planning examples, not claims about an external orchestration runtime. Labels such as `in-17`, `c1`, and `b2` are symbolic artifact identifiers, not literal SHA-256 values; an implementation must bind them to actual content digests and provenance.

## Fixture 1: simple analysis task

**Request.** Turn a supplied, approved feedback export into a recommendation memo. The input artifact is `feedback.csv@in-17`; its provenance says it was exported from the approved survey period.

| Node | Typed inputs | Output contract | Failure branch |
| --- | --- | --- | --- |
| `collect` | `feedback.csv@in-17` | `feedback-items@c1`, including source digest and collection rule | If the source digest or period provenance is absent, stop: there is no admissible `feedback-items` output. |
| `analyse` | hard data edge from `collect` | `themes@a1`, with counts, grouping rule, and `c1` as provenance | If a row cannot be parsed, record it as excluded with a reason; do not silently treat the partial result as complete. |
| `recommend` | hard data edge from `analyse` | `memo@m1`, whose claims cite `themes@a1` | If `themes@a1` is missing or was produced under a different grouping rule, block the memo rather than inventing a replacement. |

**Hand check.** The graph has two hard data edges, `collect -> analyse` and `analyse -> recommend`; a topological order is `[collect, analyse, recommend]`. Deleting `collect` makes the required producer for `analyse` absent, so the failure branch is correct. Adding a concurrent spelling-review node does not change that proof because it has no hard edge into analysis.

## Fixture 2: complex research task

**Request.** Prepare a research briefing from two independent evidence tracks and publish only after a named approver accepts the draft.

| Node | Typed inputs | Output contract | Failure branch |
| --- | --- | --- | --- |
| `market-research` | scoped market-source list | `market-notes@mr1`, citations and collection scope | An uncited claim stays outside the briefing. |
| `competitor-research` | scoped competitor-source list | `competitor-notes@cr1`, citations and collection scope | A source outside scope is rejected or the scope is amended in a new revision. |
| `synthesise` | hard data from both note artifacts | `briefing-draft@b1`, preserving both provenance chains and a comparison criterion | If either artifact is missing or their scopes conflict, block synthesis and report the mismatch. |
| `review` | `briefing-draft@b1` | `review-record@r1`, accepted changes or rejection reasons | A vague “looks good” is not an acceptance record because the criterion and reviewer are missing. |
| `publish` | hard evidence from `review`; authority edge from the named approver | `published-briefing@p1` | A draft may exist, but absent approval or authority denies publication. |

`market-research` and `competitor-research` can run together because neither needs the other’s output. They must write separate artifacts; a shared mutable scratch file is a resource/contention constraint, not proof of a data edge.

**Hand check.** The first ready frontier contains the two research nodes. A valid order is `[market-research, competitor-research, synthesise, review, publish]`. Removing the approver’s authority leaves all intellectual work possible but denies the terminal effect.

## Fixture 3: quality-driven revision

**V1 request.** Produce `briefing-draft@b1` from `market-notes@mr1` and `competitor-notes@cr1`, then review it against the criterion “each comparison has a cited source.” The review finds that two comparisons have no criterion trace.

**V2 revision.** Keep the two note artifacts, add `criteria@q1`, replace the synthesis output with `briefing-draft@b2`, and require all downstream nodes to name `b2` and `q1` in their contracts. The V1 review record is evidence of the reason for change; it is not evidence that V2 passed.

| V2 node | Required predecessors | Output | Failure branch |
| --- | --- | --- | --- |
| `define-criteria` | none | `criteria@q1` | Missing criteria blocks V2 synthesis. |
| `synthesise-v2` | `market-notes@mr1`, `competitor-notes@cr1`, `criteria@q1` | `briefing-draft@b2` | A consumer requesting `b1` is stale and must be rewired or rejected. |
| `review-v2` | `briefing-draft@b2`, `criteria@q1` | `review-record@r2` | Reuse is denied if the stored V1 record does not match V2 inputs. |

**Hand check.** V2 creates a new graph revision. `market-notes@mr1` and `competitor-notes@cr1` are reusable only because their contracts and scopes remain unchanged. `review-record@r1` is invalidated because its subject was `b1`; treating it as V2 success would skip the new required producer.
