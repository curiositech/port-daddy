# Authority, retrieval, and continuity

## Source-to-claim ledger

| Source | Narrow support used here | What it does **not** prove |
|---|---|---|
| NIST SP 800-162, [Guide to Attribute Based Access Control](https://csrc.nist.gov/pubs/sp/800/162/upd2/final) | Authorization can evaluate attributes of the subject, object, requested operation, and environment against policy. This supports carrying typed audience, repository, operation, scope, and expiry attributes into a context decision. | It does not say retrieved prose is trustworthy, decide whether content is an instruction, or validate a model-generated continuation. |
| NIST SP 800-207, [Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final) | Network location and asset ownership do not create implicit trust; authentication and authorization are distinct checks before access to a resource. This supports refusing to trust local files, inherited sessions, or same-machine state merely because they are nearby. | It does not define prompt isolation, memory retention, semantic retrieval, or agent identity continuity. |
| Model Context Protocol, [Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) | Tokens should be audience-bound, resource servers should validate the intended resource, and token passthrough is forbidden. This supports keeping credentials out of portable context and reacquiring scoped authority in a new body. | It does not prove that two backends expose equivalent tools, that an MCP server is safe, or that a translated continuation preserves obligations. |

The `spaceId`, directive-eligibility lattice, obligation coverage rule, and
receipted forgetting policy below are Drydock contracts. The standards above
constrain their security posture; they do not validate the compiler or its
outputs.

## Instructional use

Content is `DIRECTIVE_ELIGIBLE` only when it is a current operator directive whose exact audience, repository, task, scope, expiry, integrity, and revocation state match the proposed continuation. All other content is `DATA_ONLY` or `FORBIDDEN`.

## Retrieval identity

Every semantic query and candidate carries an immutable logical `spaceId` derived from model and configuration digests, preprocessing, pooling, dimensions, normalization, metric, precision, and quantization. Provider and transport names are provenance, not compatibility.

## Obligation coverage

The compiler starts from the active obligation set, not merely the most salient transcript spans. Every obligation receives a status and source references. `OMITTED` and `UNKNOWN` survive into lifecycle review.

## Continuation boundary

The compiler may emit a capsule and proposal nonce. It may not consume the nonce, fence a predecessor, reconcile effects, reserve capacity, admit a body, or grant credentials. The lifecycle writer performs those joins under a separate authority.

## Interiority and forgetting

Not all episodic detail deserves durable carryover. Deliberate forgetting can protect privacy and reduce contamination, but it must be policy-bound and receipted. The record states what was omitted and why without exposing the omitted content.
