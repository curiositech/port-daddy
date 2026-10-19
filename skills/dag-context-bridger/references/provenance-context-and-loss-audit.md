# Packet modes, budget, and loss audit

Choose a delivery mode from recipient need: **full-forward** when all source
material is authorized and budgeted; **selective plus summary** when named
obligations need a subset; **output-only** when the contract needs only a
verified artifact and pointers; **progressive loading** when questions can be
resolved by later authorized fetch; or **hierarchical summaries** when each
summary retains child source pointers. None authorizes omission of an approval,
negative result, or constraint.

Build a manifest with recipient/scope, model and tokenizer identity, input
reserve, token estimate, artifact/version/digest, provenance, freshness,
retention, disclosure class, required obligations, included fragments and
omissions. Cache only with keys including artifact digest, recipient scope,
model/tokenizer, policy/retention revision, and summary method. On lifecycle
expiry, policy change, stale source, or contradictory version, invalidate the
packet and hold dependent work.

**Budget case:** recipient context limit is 4,000 tokens; reserve 800 for its
response and 600 for instructions, tools and existing history. The packet
budget is 2,600 under that tokenizer. Count serialized framing as well as text. A 5,000-token full-forward source
cannot fit, so provide exact approval/failed-test/constraint fragments plus a
manifested omission list and progressive authorized pointers. **Downstream case:**
recipient reads back “artifact v3 sha256:a1, read-only, migration unresolved.”
If it reads v2 or omits the read-only constraint, refresh/hold. A source pointer
alone is not a loss audit.

[W3C PROV-O](https://www.w3.org/TR/prov-o/) supports entity/activity/agent and
derivation vocabulary; it does not prove truth, authorization, or disclosure.


## Constructed packet and recipient readback

The following is a worksheet, not a signature or validated evidence artifact.
Replace abbreviated IDs with exact locators and digests in real use.

| Manifest field | Example |
| --- | --- |
| packet / task / recipient | p9 / deployment-review / reviewer-2 |
| authority | read-only, repository R, approval-policy revision 4 |
| artifact | application v3, digest recorded in source manifest |
| tokenizer and context | recorded model/tokenizer revision; 4,000 total |
| reserves and packet allowance | 800 response + 600 other input; 2,600 packet |
| required obligations | approval scope, tested digest, negative-test result, unresolved migration |
| freshness | source revisions fixed at packet creation; recheck before use |

| Fragment | Included content | Illustrative counted tokens | Disposition |
| --- | --- | ---: | --- |
| F1 | Exact approval scope and expiry | 220 | required verbatim |
| F2 | Test artifact identity and failed negative case | 500 | required exact fields |
| F3 | Migration caveat and contradictory observation | 330 | required with source pointers |
| F4 | Task-specific summary of remaining requirements | 900 | derived; child pointers retained |
| Manifest/framing | Provenance, omissions, budget and recipient instructions | 250 | required |
| F5 | Duplicate narrative and tangential history | excluded | omission references current source IDs |

The illustrative packet total is 2,200, leaving 400 tokens of packet margin.
Actual serialization must be counted using the recipient tokenizer before
sending; this table's counts are not measurements. An exact required fragment
that exceeds the allowance forces a different mode or a hold, not silent loss.

Ask the recipient to read back task, artifact version, effect limit, unresolved
migration and the failed test. “v2 is approved for deployment” is a failed
readback of this packet; correct it before dependent work. Readback checks
transmission understanding, not truth of the underlying approval or test.

For the original research-pipeline case, extraction needs claims, citations
and contrary findings rather than every sentence of each paper. Give each
summary claim source-span pointers, keep conflicting results, and record
excluded papers. For three child tasks, construct three independently scoped
packets: design requirements, testing criteria and user-facing overview. Do
not assume the design agent can fit 5,000 tokens into a 4,000-token context.
Each recipient still receives its relevant authority and caveats.

## Recovery instead of repeated lossy summaries

1. **Loss detected:** compare the downstream question with required fragment
IDs. Restore the missing exact constraint or counterexample from its original
source. Do not repeatedly summarize a summary to repair missing evidence.
2. **Circular dependency:** traverse the input-artifact lineage with a visited
set or topological check. Report a witness cycle and hold the affected packet;
authority to edit the DAG belongs to its owner. A legitimate cross-reference
between documents is not automatically an execution dependency cycle.
3. **Forgotten fragments:** track cache ownership, retention/expiry and last
use. Evict according to policy when consumers finish; never keep protected
fragments solely to improve cache-hit rate. Recheck authorization on cache hits.
4. **Budget thrashing:** count once per artifact/tokenizer version, cache that
count, and include framing/reserves. If repeated compression still exceeds the
budget, switch to progressive loading or request a revised packet contract.
Record summarization cost and information lost, not just cache-hit ratio.
5. **Relevance drift:** compare recipient question and artifact versions to
the packet's recorded contract. Rebuild from current eligible sources when they
change. Clarification requests are evidence of a possible coverage gap, not a
reason to indiscriminately add the entire upstream transcript.

This operational procedure uses PROV-O vocabulary; W3C does not specify its
token budgets, cache policy or recipient acknowledgement rules.
