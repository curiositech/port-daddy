# Content, ontology, and semantic boundary

## A concrete content procedure

Define versioned concepts such as `ConversionRequest(inputDigest,targetFormat)` and `Proposal(conversationId,declaredTerms)`. Register the selected codec and ontology with JADE’s `ContentManager`; set the ACL language and ontology; use `fillContent` for a send and `extractContent` for a received message. Handle `CodecException`/`OntologyException` as rejectable content errors and retain original bytes/digest for review.

## What validation does not establish

The codec/ontology pair binds an envelope to a representable content model. It does not establish that a digest names intended data, that a proposal is honest, that sender is authorized, or that an output meets the task. Apply identity admission, business validation, freshness, and effect authorization separately. Do not present invented belief filters or “OntologicalAction” as generic JADE APIs.

Official [ContentManager API v4.6.0](https://jade.tilab.com/doc/api/jade/content/ContentManager.html), accessed 2026-09-24, supports the fill/extract and validation boundary.
