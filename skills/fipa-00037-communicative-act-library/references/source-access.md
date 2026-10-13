# Source access and historical identity

## Primary source ledger

| Source | Access | What this bundle uses | Boundary |
| --- | --- | --- | --- |
| FIPA, *Communicative Act Library Specification*, XC00037H, experimental, 2001-08-10, [archived PDF](https://jmvidal.cse.sc.edu/library/XC00037H.pdf) | Full 44-page body read 2026-09-24. | Named acts, normative act descriptions, formal models, Annex Semantic Language, FP/RE, and the H's printed variants. | Historical H source only; it is not proof of a current implementation, transport, identity mechanism, delivery, timing, or external effect. |
| Canonical later J endpoint | Unavailable in this pass. | None. | Do not call H identical to J or silently update H notation. |

H contains printed differences that must remain visible: §3.19's request FP uses `\neg B_i I_j Done(a)`, while annex §5.4.2 prints `B_i\neg PG_j Done(a)` and uses `PG` for persistent goal. Query-derived annex forms carry the latter notation. This bundle reports forms by source location and claims no equivalence.

## Historical raw and identity record

Historical generator material remains in the read-only baseline history, not as active evidence for this draft. Its exact immutable address is:

- commit: `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`
- canonical Git path: `skills/fipa-00037-communicative-act-library/_raw_response.md`
- SHA-256 of that committed blob: `e610294ec5544c2ea1702bae5fb28b200de1474f35ba6f0f534b0d4d9e2cf070`
- retrieval expression: `git show 00ab2c9ab2197ff97e85edc173370b7446fdb2ef:skills/fipa-00037-communicative-act-library/_raw_response.md`

This is intentionally an immutable Git expression rather than a broken relative Markdown link from the H handoff. The raw material is historical provenance only. Its generated prose does not establish source access, correctness, runtime behavior, novelty, or Book placement.

## Integration-file disposition

| Original file | Disposition | Reason |
| --- | --- | --- |
| `SKILL.md` | Rebuilt in H | Retains usable act-selection, diagnostics, evidence boundary, and asset routing while removing fixed timeout/routing/implementation claims. |
| `references/INDEX.md` | Rebuilt in H | Retains all original references and adds the restored conditional/proposal method. |
| `_book_identity.json` | Replaced with bounded historical metadata | Original generated claims are not used as source evidence; exact historical source is retained above. |
| `_raw_response.md` | Not copied into H | Exact historical commit/path/hash retained; inactive raw prose is not presented as active evidence. |

The replaced historical `_book_identity.json` has a separate preimage: same commit, `skills/fipa-00037-communicative-act-library/_book_identity.json`, SHA-256 `cd532df8c28c27709343b6a2de9bfc1d58f96a59cf841a8662b3de759e6cffad`. Its identity claim is not substituted by the raw-response hash.
