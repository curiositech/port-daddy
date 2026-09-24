# Explicit interface, implicit implementation

## Interface boundary

XC00086C standardizes ACL-level communication about explicitly represented ontologies while leaving storage representation and OA/server internals to developers. A platform need not contain an OA; if one exists it must participate in specified conversations and may state inability. This is not a rule that every open system must expose discovery or that every explicit ontology is remotely queryable.

## Selection procedure

List external consumers and terms they must identify. Use a logical ontology name at the interoperability boundary, document how it maps to the private representation, and decide which OA capability is actually needed: discovery, relationship query, maintenance, translation, or shared-ontology selection. Test the advertised capability separately from the internal model.

Positive: an OA advertises `supported-ontologies` and answers a query. Negative: a private implementation can correctly decline; do not infer performance or version-management guarantees from the explicit name.
Use an explicit ontology/version at an interoperability boundary when consumers need to identify terms and mappings. Private implementation representation may remain implicit. Neither choice alone establishes compatibility, performance, or translation correctness; measure and test the selected boundary.
