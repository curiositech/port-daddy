# Contract Net, discovery, and correlation

## What a manager still owns

Contract Net distributes the work of preparing offers; it does not remove the manager. The manager chooses eligible candidates, creates the CFP, freezes a local interpretation of the reply-by time, compares proposals, sends award notices, and records completion evidence. The protocol does not choose the “best” proposal. Define a comparator that says how incomplete proposals and ties are handled before collecting replies.

## A hand-checkable exchange

1. Build a CFP with `conversation-id`, protocol, content language, ontology, a request digest, and a local reply-by rule. Give the CFP a unique `reply-with` token.
2. Candidate A replies `PROPOSE`, setting `in-reply-to` to that token. Candidate B replies `REFUSE`. Match both with a `MessageTemplate` for protocol, conversation ID, performative, and correlation token; then separately check sender role and content.
3. At the local deadline, apply the declared comparator to the recorded proposals. Send `ACCEPT-PROPOSAL` only to A. There is no `REJECT-PROPOSAL` for B because B did not propose.
4. A reports `INFORM` or `FAILURE`. Treat a missing report as a local timeout observation, retain late messages for audit according to policy, and independently inspect any reported output before consuming it.

`MessageTemplate` is queued-message filtering, not authentication, delivery ordering, deduplication, or a complete conversation state machine. A null responder template can consume unrelated messages; `ContractNetResponder` documentation recommends matching the protocol slot. In the current API, implement responder logic through `handleCfp` rather than the deprecated `prepareResponse`, and use the responder callbacks for accept, reject, and out-of-sequence handling.

## Discovery choices

Use `DFService` to register a `DFAgentDescription` with a service type/name and to search a matching description. Its convenience `register`, `deregister`, `modify`, and `search` methods block the caller until completion or exception. For a responsive agent, issue the documented asynchronous DF request/subscription exchange with `AchieveREInitiator` or `SubscriptionInitiator`, then process `decodeResult` or `decodeNotification` in a behaviour. A search result is a service description, not health, capacity, authority, or an enduring reservation; revalidate before a consequential effect.

## Constructed catalog example

A catalog requester searches for `edition-lookup`, sends an identical CFP to discovered descriptions, and preserves every correlated `PROPOSE`/`REFUSE`. Its local comparator prefers a supported edition and a declared evidence form; a price field is optional only if the application has authorized it. It records the selected proposal, policy version, and original reply bytes. This makes a decision reviewable without claiming an optimal market or a scaling result.

## Sources and limits

JADE v4.6.0 [MessageTemplate API](https://jade.tilab.com/doc/api/jade/lang/acl/MessageTemplate.html), [ContractNetResponder API](https://jade.tilab.com/doc/api/jade/proto/ContractNetResponder.html), and [DFService API](https://jade.tilab.com/doc/api/jade/domain/DFService.html), accessed 2026-09-24, support the API/method descriptions. They do not establish application delivery, identity, or business correctness.
