# Source ledger

## Inherited recovery record

The direct C source is <https://www.fipa.org/specs/fipa00086/XC00086C.html>; the D catalog record is <https://www.fipa.org/specs/fipa00086/index.html>. The handoff's 2026-09-24 recovery record says the catalog identified XC00086D as Experimental, version D, dated 2001-08-15. Its body was unavailable: HTML redirected to 502 and the PDF did not parse. The recovery author read the **relevant C sections listed in `SOURCES.md`**: scope, service model, relationship definitions, DF registration/search, OKBC operations/exceptions, shared-ontology interaction, and informative Annex A/B. This restoration did not independently fetch either body; its own bounded curl attempt returned HTTP 403 with no body saved.

The same recovery record reports that Suguri et al., [Implementation of FIPA Ontology Service](https://ceur-ws.org/Vol-52/oas01-suguri.pdf), CEUR-WS Vol. 52, was read as corroborating implementer evidence. It says FIPA 98 Spec 12 and the then-latest experimental service specification differ cosmetically with no functional change; it also reports that its own `translate` implementation was not implemented. Neither statement makes a modern provider capability normative.

## Citation discipline

Use XC00086C for recovered semantics and name it predecessor-body evidence. Cite D only for catalog identity/date unless its body is recovered. Never state C equals D verbatim or that C provisions are directly verified D text. The inherited access record is `research/fipa-ontology-primary-followup/SOURCES.md` in the handoff root, not an active-bundle dependency.
The earlier attempt did not access XC00086D's body and had only catalog metadata. A later recovery read relevant XC00086C sections. Active methods retain source-bound procedures and label provider/transport/full-conformance as unproved.

Canonical original raw-response preimage: `skills/fipa-00086-ontology-service/_raw_response.md` in read-only W. It is not copied into this bundle; `omitted-canonical-files.json` and deletion diff from the updated review helper bind the omission and raw hash.
