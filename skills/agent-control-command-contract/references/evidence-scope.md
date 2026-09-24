# Evidence scope and source notes

## Primary source: NIST SP 800-162

Hu, Ferraiolo, Kuhn et al., *Guide to Attribute Based Access Control (ABAC) Definition and Considerations*, NIST Special Publication 800-162, January 2014, updated August 2, 2019. Primary PDF: <https://nvlpubs.nist.gov/nistpubs/specialpublications/NIST.SP.800-162.pdf>; DOI record: <https://doi.org/10.6028/NIST.SP.800-162>.

Reviewed for this bundle: §2.3 “Basic ABAC Concepts” (printed pp. 8–10 / PDF pages 17–19), §2.4.3 “Access Control Mechanism Distribution” (printed pp. 14–16 / PDF pages 23–25), and §3.3.1 “Attribute Caching” (printed p. 31 / PDF page 40). The PDF front matter identifies the 2014 publication and the 2019 update.

The relevant method is bounded: describe the subject, protected resource/object, requested operation and relevant environment attributes; evaluate applicable policy; keep policy decision (PDP) distinct from enforcement (PEP); identify where attributes are sourced and how freshness is considered. Section 3.3.1 says caching may improve performance and asks organizations to assess the trade-off between freshness and security. This source does not categorically prohibit caching.

The bundle's `authorization.bindings` and `checks` fields are a first-party schema proposal inspired by that attribute-centered method and by the Harbor binder's capability-envelope discussion. The exact fields for target run, command scope, policy revision, expiry, authority epoch, dispatch behavior, fencing, and effect observation are not NIST-mandated. A populated declaration is not a signed credential, live policy read, enforcement test, or proof of product conformance.

## First-party design sources

Read in the canonical worktree at commit `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`:

- `docs/architecture/agent-harbor-technical-binder/13-platform-plays-and-runtime-surface-review.md`, “Control surface simplification”: identifies a first-party vocabulary for message steering, pause, interrupt, kill, checkpoint, and fork.
- `docs/architecture/agent-harbor-technical-binder/15-recursive-critical-synthesis.md`, C3 and “Diagram 2b - control and lease failure flow”: supplies design questions around issuer/subject/audience/scope/expiry/revocation epoch/fencing, plus separated delivery, acknowledgement, enforcement, and suspect states.
- `docs/architecture/agent-harbor-technical-binder/work-packets/operator-control-panel-ux-flow.md`, “Session List,” “Controls,” and “Click-First Interaction Contract”: describes the read model, operator affordances, and where these controls appear in the planned product flow. It is not runtime capability evidence.
- `docs/adr/0125-ios-operator-surface.md`, §4–5: records an iOS design contract and its declared remote-body matrix. Those declarations do not substitute for a backend probe; the example in this bundle deliberately avoids repeating Cloudflare support claims.
- `apps/pd-ios/PortDaddy/ControlVerbs.swift` and `apps/pd-ios/PortDaddy/Resources/control-contract.fixture.json`: first-party vocabulary and fixture origin for the six verb names. They do not establish adapter behavior for this audit sample.

## Constructed material and unsupported claims removed

`examples/sample-input.json` uses `adapter-example` and `observer-only-example` with placeholder attribute-field names. It is constructed only to exercise the format. It is not an observed capability matrix, source of live profile truth, Cloudflare/remote backend claim, authorization result, or evidence that controls are safe to enable.

This draft replaces the inherited unqualified claims that a lease or last appended event is automatically authoritative; that acknowledgement means the effect happened; that expiry proves no effect; and that every product must provide a hard-coded four-verb core. It also removes unverified capability assertions about hook-only and Cloudflare bodies. They were design assertions in the earlier skill/example, not source-supported or locally observed facts.

## How to extend evidence

For current platform or adapter claims, use the relevant primary implementation documentation and record its version/date. For local runtime claims, attach a reproducible test trace that identifies the profile, adapter build, exact target, policy revision, authority epoch, command ID, and observer read-back. Distinguish an error-free static declaration audit from an actual runtime observation. No benchmark, provider behavior, compliance status, or deployed behavior was tested in this bundle repair.
