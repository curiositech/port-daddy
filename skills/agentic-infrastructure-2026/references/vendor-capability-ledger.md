# Vendor and protocol capability ledger

Checked 2026-09-24 for this draft. These citations identify documented scope; they do not establish local integration, comparative quality, production readiness, or procurement fit. Reopen the source and pin SDK/runtime version on the decision date.

| Product or protocol | Official source checked | What this bundle uses it to support | What remains unproven |
|---|---|---|---|
| OpenAI Assistants API migration | [Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration) | The guide says the Assistants API was sunset 2026-08-26 and directs new integrations to Responses API and Conversations API. Do not recommend Assistants API for a new project. | Does not establish that Responses/Conversations is the right infrastructure for a particular workload, nor inspect any existing integration. |
| MCP | [2025-11-25 stable specification](https://modelcontextprotocol.io/specification/2025-11-25) | Use its versioned host/client/server protocol as an interoperability reference. | MCP alone does not specify the product's entire workflow, capability authority, provider overhead, sandbox, or deployment enforcement. Measure the actual schema and tool path. |
| Cloudflare Agents and Durable Objects | [Agent state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/), [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) | The docs describe persisted agent state and lifecycle states including hibernation/inactive/cold start. Persistence and process liveness are different properties. | Does not show that a system in this skill uses Cloudflare, that a given workflow recovers correctly, or that any control is deployed. Test the exact version and failure path. |
| LangGraph, CrewAI, Semantic Kernel, other candidates | Candidate's official versioned reference and release notes, selected at comparison time | Use capability statements to generate local requirements and tests. | No “best for,” maturity, quality, cost, or performance ranking without a matched evaluation. |

## Evidence recording format

For each relied-on claim, store:

```text
claim_id:
product_or_protocol:
source_url:
source_version_or_checked_date:
exact_documented_behavior:
local_test_or_evaluation_ref:
remaining_assumption:
owner_and_recheck_trigger:
```

If the URL is broken or the relevant section cannot be read, mark the claim `unverified` or remove it. A search result, copied vendor marketing claim, or previous audit report is a discovery pointer, not substitute evidence. Do not convert official documentation into a claim that an installed product or hosted service has the same version or behavior.
