# C-P3 — Keep evidence from becoming successor authority

## Steel-man

P7 is right that signed memory and historical intent can poison a successor if mere inclusion in a context packet is treated as current permission or framing authority.

## Correction ledger

- **Disposition:** `ACCEPT`
- **Exact claim delta:** Only a current, audience-bound, revocation-checked `GuidanceEnvelope` may affect successor framing, tools, or permissions. Facts and historical intent remain cited data and may be consumed only through typed authorized predicates; they cannot authorize execution or silently alter the successor's governing frame.
- **Preserved invariants:** Identity continuity does not imply authority continuity; body generation remains explicit; revoked or audience-mismatched guidance fails closed; historical facts retain provenance without becoming commands.
- **Retained dissent:** Typed predicates reduce authority confusion but do not prove semantic safety, completeness, or resistance to manipulative but validly signed context.
- **Evidence locators:** `reviews/P7-reviews-P3.md`; `synthesis/manager-extraction-r1.md`; `positions/P3-identity-resurrection-and-effects.md`.
- **Truth labels:** Existing identity and evidence structures are `SOURCE_PRESENT`; `GuidanceEnvelope` consumption semantics are `PROPOSED`; adversarial resurrection tests are `BLOCKED_BY_HALT`.
- **Consensus-kernel impact:** No kernel change. This enforces the existing truth-versus-directive boundary.
