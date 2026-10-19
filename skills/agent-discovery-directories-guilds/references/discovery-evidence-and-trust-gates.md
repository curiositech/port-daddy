# Discovery evidence and trust gates

## Sources and access

This reference was reconciled on 2026-09-24 against [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763) sections 4–6, the [A2A v1.0.0 specification](https://a2a-protocol.org/v1.0.0/specification/), and the [JADE Directory Facilitator API](https://jade.tilab.com/doc/api/jade/domain/df.html). FIPA SC00023K was inaccessible, so no FIPA topology or federation mandate is asserted. The community discovery guide is not treated as normative.

## DNS-SD is lookup, not eligibility

DNS-SD uses PTR records to enumerate service instances, SRV records to locate target/port, and TXT records for service metadata. A returned record is a candidate endpoint. It does not authenticate an agent, authorize a caller, or prove a capability claim.

## Worked gate sequence

1. Resolve an instance through the selected directory mechanism.
2. Fetch its versioned card/metadata from an expected origin.
3. Check configured trust binding, expiry/version, and caller authorization.
4. Filter declared capability against the requested contract.
5. Run a bounded harmless probe or task and retain task-specific evidence.

Without the trust binding, retain the result as an untrusted listing. Card advertisement and observed task evidence are different fields; neither substitutes for authorization.

## Topology decision record

A central directory, federation, multicast discovery, or DHT are deployment choices. Record query latency, membership churn, trust boundaries, replication/conflict policy, failure recovery, and access filtering before selecting one. Do not infer that an API's logical DF abstraction mandates a singleton process, federation, or a particular scale threshold.

## Limits

This reference does not verify DNS records, an A2A deployment, JADE behavior, signatures, authorization policies, or capability truth in a live system.

## Reputation mechanism: what the trust anchor contributes

In [EigenTrust](https://nlp.stanford.edu/pubs/eigentrust.pdf) §§4.1–4.5, local scores are normalized into rows of a trust matrix. A row with no positive score uses the chosen pre-trusted distribution. The iteration mixes propagated trust with that distribution. Thus anchor selection is a substantive assumption: including a malicious peer among the anchors can compromise ranking. Test compromised anchors and colluding ratings in the intended corpus; a high score is neither caller authority nor task-specific capability. Root inspected these sections on 2026-09-24, not a replication of the paper's simulations.

Consul's [registration documentation](https://developer.hashicorp.com/consul/commands/services/register), read 2026-09-24, describes optional registered health checks and configured critical-service deregistration. Registration itself is not automatic expiry or proof of an agent's advertised competence.
