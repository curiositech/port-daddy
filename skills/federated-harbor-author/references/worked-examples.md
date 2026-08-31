## Worked examples

### A paragraph that lands

> Two harbors sign a federation pact. A capability token issued in
> harbor A can be presented in harbor B if and only if B's federation
> root attests to A's federation root at the token's epoch. The
> epoch is critical — without it, a token issued before B revoked A
> would still verify against the post-revocation root, and revocation
> would lie. We bind the epoch into the token preimage so the
> verifier checks against a *historical* root, not the current one.
> The cost is that verifiers carry a sparse log of past roots;
> §[PLACEHOLDER-FEDLOG-§] gives the storage bound.

Diagnosis: (a) names the new primitive (federation pact) and inline-
defines it operationally; (b) lands the cardinal hard case
(revocation timing) in the same paragraph that introduces the happy
path; (c) names the cost honestly; (d) forward-references the
storage bound instead of inflating this paragraph with the
arithmetic.

### A paragraph that does not land

> The Federated Harbor leverages cryptographic primitives to enable
> trustless coordination across administrative boundaries. Through
> the use of verifiable federation, we ensure that participants can
> rely on the integrity of cross-harbor claims while preserving
> autonomy. Our novel approach combines well-known techniques to
> provide a robust foundation for distributed agent commerce.

Diagnosis: (a) every critical noun ("cryptographic primitives,"
"trustless coordination," "verifiable federation," "cross-harbor
claims," "robust foundation") is a black box; (b) "leverages,"
"ensures," "robust," "novel" are corporate-evenness markers; (c)
contains zero falsifiable claims; (d) the reader has learned
nothing concrete and cannot tell what would knock the system over.
This is the failure mode the four cardinal sins are designed to
catch.
