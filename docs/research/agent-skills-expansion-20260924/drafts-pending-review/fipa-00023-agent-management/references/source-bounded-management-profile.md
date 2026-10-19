# Management profile and discovery procedure

Use separate records for AID identity, current address candidates, and directory service descriptions. A local call resolves a selected AID under its platform profile only after contract and authority checks. Register with request IDs; a timeout leaves the registration outcome unknown until authoritative reconciliation. Discovery is an observation, not evidence that a provider remains reachable.

FIPA SC00023K is the intended normative target but its canonical endpoint was inaccessible during repair: <https://www.fipa.org/specs/fipa00023/SC00023K.html>. JADE documents one implementation mapping: <https://jade.tilab.com/doc/api/jade/domain/FIPAAgentManagement/package-summary.html>. Registry federation, reachability validation, retry counts, and timeout lifecycle transitions are deployment policy.
