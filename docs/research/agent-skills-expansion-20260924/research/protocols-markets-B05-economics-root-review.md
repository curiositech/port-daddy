# Root review of B05 economics research

Read together with protocols-markets-B05-economics-deepening.md before authoring. The research is not yet accepted as a complete verified result set.

## Arithmetic corrections

The context example's second request has 10,000 cached input + 2,000 fresh input + 1,000 output. At its explicitly stated rates, cost is 0.00005 + 0.00010 + 0.00025 = **$0.00040**, not $0.00044. It has **12,000 input** and 13,000 total input-plus-generated-output tokens, not 13,000 input. The first request costs $0.00125, so the stated combined $0.00165 is correct only with the corrected $0.00040 second call. The no-cache comparison ($0.00085 second; $0.00210 combined) and $0.00045 cache savings are arithmetically consistent. Context capacity also depends on actual provider/model accounting; these are simplified constructed token sums, not measured occupancy telemetry.

The report's per-bundle inventory says 27 + 12 + 11 but then claims 45 files. Root recomputed recursive file counts and exact SHA-256 entries in the adjacent JSON; use that manifest for actual byte identity. This verifies inventory, not that every source file was semantically read. The research's unexplained aggregate digest is not accepted as independent read evidence.

All provider prices/quota facts remain date-sensitive claims from Luna's opened sources and need final source scope before active guidance. Existing Book leads are mostly already covered in BOOK-PLACEMENT-REVIEW.md. The labor stress auditor's reported false pass needs reproduction before repair, as does any guardrail/schema disagreement. Do not convert a static finding into a runtime claim.
