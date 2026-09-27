# Conceptualization, ontology, and syntax

## Distinctions to preserve

XC00086C Annex A is informative guidance. It distinguishes a conceptualization (domain, relevant states of affairs, conceptual relations) from an ontology: axioms and vocabulary designed to approximate intended models under a commitment. A knowledge base makes assertions using an ontology. Equal field names, a parser success, or a related ontology label cannot prove that two parties intend the same domain fact.

Identical ontologies may still be used with different conceptualizations, and equivalent ontologies served by different systems can produce different deductions. These are FIPA caveats, not a request to publish private world-model declarations.

## Procedure and hand check

For a task-essential term, make a fixture with the source assertion, target consequence, and falsifying case. Compare terms, axioms, and domain conditions. If the consequence remains unverified, report a conceptualization mismatch even if syntax and ontology names match.

Positive: record that `coriander` means a named plant part in both fixtures. Negative: keep distinct fixtures when one party uses leaves and another seeds; a common token is not a bridge.
Matching field names or a successful parse establishes syntax, not a shared conceptualization. An ontology is a stated vocabulary/commitment used to communicate about a domain; application meaning and consequence still need task fixtures and authority. Preserve ontology version and term provenance with a translation result.
