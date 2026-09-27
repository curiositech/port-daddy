# Evidence scope and limitations

## Checked primary documentation

Date checked: 2026-09-24. These sources support only the stated documentation claims; none proves local installation, integration, hosted deployment, policy enforcement, workload fit, comparative performance, or ROI.

| Source | Accessed material | Permitted use in this bundle |
|---|---|---|
| OpenAI [Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration) | Full official guide opened. It states the Assistants API was sunset 2026-08-26 and recommends Responses and Conversations for migration/new integration. | Explain why the previous example's new Assistants API recommendation is obsolete. No claim that the replacement is fit for a particular workload. |
| Model Context Protocol [2025-11-25 specification](https://modelcontextprotocol.io/specification/2025-11-25) | Specification overview and security section opened. It describes an open protocol using host/client/server, features including resources/prompts/tools, and says the protocol cannot itself enforce the stated security principles. | Describe MCP as a protocol and require application-level consent, authorization, and access controls. Do not use it as shorthand for a framework or secure tool deployment. |
| Cloudflare [Agents state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/) and [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) | Relevant state and lifecycle sections opened; official page dates are shown on those pages. The docs describe persisted state and distinct in-memory, hibernated, and inactive lifecycle states. | Illustrate that durable state and continuously running process are distinct design properties. No claim this skill uses Cloudflare or that a local system recovers correctly. |
| LangGraph, CrewAI, Semantic Kernel, and other framework documentation | Not relied on for comparative or ranking claims here. | The selection procedure requires authors to re-open and pin a candidate's official versioned docs before making a current capability statement. |

## Audit provenance

The authoring used the source-specific research ledger `architecture-B02-identity-infrastructure-deepening.md` (handoff research directory; SHA-256 `704422a75e592eda5cb3cef166b1cf8dcdb3675fe2fcef22e822de536a223577`) and the root's prior negative audit. The research ledger is handoff provenance, not evidence of a tested implementation. Original first-party files are recoverable from baseline commit `00ab2c9ab2197ff97e85edc173370b7446fdb2ef` by canonical source path and SHA-256 in [`provenance/original-source-manifest.tsv`](../provenance/original-source-manifest.tsv).

## Verification boundary

The readiness API validates a static JSON declaration. Even when it passes, reviewers still must inspect the cited evidence, test failure paths, and verify the relevant running controls. No provider calls, runtime tests, production tests, or external-effect tests were run by this offline authoring task. All example scenarios and numbers are explicitly constructed; they are not empirical findings.
