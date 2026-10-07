# Ontology agent/provider boundary

## OA and DF roles

An OA is a communicative wrapper for one or more ontology servers. XC00086C permits discovery, maintenance, expression translation, relationship/term queries, and shared-ontology selection, but does not require every OA or platform to implement every task. It leaves backend protocols and internals outside scope. The DF can advertise OA, ontology, and translation capabilities; it does not verify that an advertised provider works.

## Request procedure

Search the DF for a service description matching the named ontology or translation direction. Select a provider under your authority and transport rules. For domain queries/updates, ACL `:ontology` includes service and domain ontology; for translation it is the service ontology while `translation-description` names `:from`/`:to`. Preserve `inform`, `not-understood`, `failure`, or `refuse`. `nil` is specifically C's no-translation-between-pair example, not generic absence. Do not describe a selected OA as a trust boundary, central registry, federation, or universal translator without separate evidence.

Positive: a DF result leads to a query response. Negative: a DF registration with no working response is an advertisement failure, not evidence that the ontology is invalid.
An ontology service can expose discovery, relationship, term, or translation operations when a selected provider implements them. Specify provider identity, authorization, transport, version, availability, and response validation outside the ontology relation itself. An ontology agent is not inherently trusted, durable, federated, or a security boundary.
