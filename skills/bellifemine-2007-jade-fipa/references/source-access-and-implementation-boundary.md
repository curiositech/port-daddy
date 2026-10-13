# Source access and implementation boundary

## Source ledger

| Source | Identity and access | Safe use in this skill |
| --- | --- | --- |
| Bellifemine, Caire, Greenwood (2007) | Wiley DOI `10.1002/9780470058411`; metadata record accessed 2026-09-24 | Topic, authorship, publication identity only |
| JADE API | JADE 4.6 FIPA Agent Management package summary; accessed 2026-09-24 | Package-level implementation navigation and its stated FIPA specification mapping |
| FIPA | Protocol/specification bodies not accessed | No normative state-machine, security, delivery, or conformance claim |

## Why the distinction matters

A book citation cannot establish the behavior of a currently installed JADE release. Conversely, an API class is not a FIPA authority. Use the book for historical orientation, the selected release documentation for method signatures, and the deployed application’s tests and operational evidence for behavior under load or failure.

## Historical material

The imported raw response is retained in the repository preimage `00ab2c9ab2197ff97e85edc173370b7446fdb2ef:skills/bellifemine-2007-jade-fipa/_raw_response.md` (SHA-256 `b58b57abafbed63f1ebc3ec42787526acc965bd9dcac564143b4becfe6e070fc`). No `historical/` copy is present in this active bundle. The preimage is recovery provenance, not current operational guidance.

## Implementation references used in restoration

The method-level references additionally cite the official JADE Programmer’s Guide, LEAP User Guide and the 4.6.0 Behaviour, ParallelBehaviour, MessageTemplate, ContractNetResponder, DFService and ContentManager APIs. The campaign research ledger records those body accesses and their limits; the package-summary row above is not the entire method-source readset. Book metadata remains metadata only.
