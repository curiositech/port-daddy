# Google Agents CLI Research

Date: 2026-04-24

## Scope

This note covers Google's official `agents-cli` project, not the Gemini CLI alone. The relevant product is the Agents CLI in Agent Platform: a command line plus coding-agent skill bundle for building, evaluating, deploying, publishing, and observing ADK agents on Google's Gemini Enterprise Agent Platform.

Primary sources:

- [Google Developer Blog: Agents CLI in Agent Platform](https://developers.googleblog.com/agents-cli-in-agent-platform-create-to-production-in-one-cli/)
- [Agents CLI getting started](https://google.github.io/agents-cli/guide/getting-started/)
- [Agents CLI reference](https://google.github.io/agents-cli/cli/)
- [Agents CLI templates](https://google.github.io/agents-cli/guide/templates/)
- [Agents CLI observability](https://google.github.io/agents-cli/guide/observability/)
- [google/agents-cli on GitHub](https://github.com/google/agents-cli)

## What Google Built

Google's strongest product move is not one primitive. It is the clear lifecycle:

1. Install the CLI and coding-agent skills.
2. Scaffold an agent project from a known template.
3. Run and iterate locally.
4. Lint and evaluate.
5. Deploy.
6. Publish to Gemini Enterprise.
7. Observe traces, logs, analytics, and production behavior.

The docs and CLI both reinforce that sequence. The CLI reference is broad, but the memorable path is compact: `setup`, `create` / `scaffold`, `install`, `playground`, `run`, `lint`, `eval`, `deploy`, `publish`, `observe` through tracing/logging/analytics surfaces.

The second strong move is that skills are part of the product, not optional docs. `agents-cli setup` installs context-aware skills for coding agents, and the public docs name separate skills for workflow, ADK code, scaffold, eval, deploy, publish, and observability. This turns "how to build a Google agent correctly" into an executable assistant-facing knowledge layer.

The third strong move is lifecycle upgrade support. `scaffold enhance` adds deployment, CI/CD, or RAG scaffolding to an existing project, and `scaffold upgrade` performs a template upgrade with preservation/conflict behavior. That is the right shape for long-lived agent projects: create is not enough; projects need safe evolution.

## Command Primitive Map

| Google primitive | What it means | Port Daddy implication |
| --- | --- | --- |
| `setup` | Install CLI plus skills into coding agents | Port Daddy needs one command and one docs page that installs CLI, MCP, skills, hooks, FleetBar, and project defaults without scattering setup paths. |
| `create` / `scaffold create` | Create an agent project from templates | Port Daddy should have a first-class agent/fleet project scaffold, not only `pd init` plus hand-edited YAML. |
| `scaffold enhance` | Add infra/deploy/RAG/CI to an existing project | Add a safe `pd scaffold enhance`-style flow for adding FleetBar, MCP, Cloudflare, memory, actor runtime, or docs surfaces to an existing repo. |
| `scaffold upgrade` | Upgrade generated project templates with conflict preservation | Port Daddy should eventually support generated hook/skill/fleet/template upgrades with dry-run and conflict reporting. |
| `install` | Install project dependencies | Port Daddy's install/setup story should expose dependency readiness as an operator-visible phase, not just failed backend readiness later. |
| `playground` | Local web playground with live reload | Fleet Control Center already fills part of this role; it should become the obvious local agent/fleet playground. |
| `run` | Send one prompt locally or remotely, with protocol/session options | Port Daddy should preserve the distinction between local daemon, remote harbor, A2A, and session continuity in command names and history. |
| `lint` | Quality checks as a lifecycle command | Port Daddy needs `pd validate` / `pd doctor` surfaces that are lifecycle gates, not hidden scripts. |
| `eval run` / `eval compare` | Run evalsets and compare candidate results | Signalman should own a canonical eval harness for agents, sorties, memory collapse, routing, and prompts. |
| `deploy` | Deploy to Agent Runtime, Cloud Run, or GKE | Harbormaster should turn promote/deploy into one coherent lifecycle phase across stable daemon, FleetBar, Cloudflare, remote harbor, and package distribution. |
| `publish gemini-enterprise` | Register a deployed agent in a higher-level enterprise catalog | Lighthouse/remote harbor need an equivalent registry/publish story for agent cards, capabilities, keys, and attestations. |
| `infra` / `data-ingestion` | Provision and operate retrieval infrastructure | Port Daddy should treat retrieval, graph, tuple, memory, and remote harbor stores as first-class operational surfaces. |
| `cmd-info`, `login --status`, `update` | Show project config/auth/tooling state and refresh skills | `pd status`, `pd whoami`, `pd doctor`, `pd skill update`, and control-plane readiness should converge instead of telling partial truths. |

## Information Architecture Lessons

The Google site is lifecycle-first, not primitive-first. The left rail starts with overview/tutorial/use cases/auth, then development, evaluation, deployment and operations, observability, and finally reference. That ordering teaches the user how to move from idea to production before it asks them to memorize every command.

Templates are concrete and few. The public template set is small enough to understand quickly: a general ADK agent, an ADK plus A2A interoperability agent, and an agentic RAG project. Port Daddy's maritime actors can follow this pattern: fewer starter templates with crisp use cases beats a large undifferentiated role catalog.

Evaluation is its own section. It is not buried under testing. This matters for Port Daddy because agent behavior, routing, semantic collapse, and memory retrieval need evaluation fixtures, comparison outputs, and regression history just like code.

Observability is an operations section, not a footnote. The Google docs make tracing, latency, errors, prompt/response metadata, token usage, analytics, and LLM-as-judge scoring part of the production story. Port Daddy's tuple, graph, session, cost, trace, and spawn records should be presented the same way: an operator-facing observe phase.

Reference is separated from guide material. Port Daddy docs currently blur product narrative, recovery ledgers, CLI reference, website docs, and operator rules. The site IA should keep those distinct:

- Guide: use Port Daddy end to end.
- Concepts: actors, leases, tuples, graph, memory, claims, sorties, harbors.
- Tutorials: concrete repo/fleet/operator tasks.
- Operations: daemon truth, promotion, recovery, observability, costs, security.
- Reference: CLI, API, MCP, config, schemas, skills.
- Research/recovery: clearly marked internal ledgers, not user-facing product docs.

## Agent Ideas Worth Borrowing

1. Skill bundles are product infrastructure. Port Daddy should ship first-party skills for lifecycle workflow, actor runtime, symbolic coordination, eval/Signalman, deploy/Harbormaster, observability/Breaker, and Cloudflare/remote harbor.
2. Scaffold, enhance, and upgrade are different verbs. Creating a fleet is different from safely adding a capability to an existing repo, and both differ from upgrading generated Port Daddy artifacts.
3. Evaluation needs a stable result format and compare command. This should cover prompts, fleet routing, semantic aliasing, memory retrieval, and failure-propagation behavior.
4. Agent templates should encode protocol choices. Google exposes A2A as a template. Port Daddy should expose local-only fleet, remote-harbor-ready fleet, actor-runtime fleet, and graph/memory-heavy fleet as explicit choices.
5. Observability should follow the request path. A useful Port Daddy trace should show operator request -> actor mailbox -> fleet trigger -> spawn/eval/budget decision -> model/tool call -> file/tuple/graph mutation -> result/handoff.
6. Deployment metadata should be durable. Google's publish flow can read deployment metadata. Port Daddy's promotion/harbor/lighthouse path should similarly persist release, daemon, key, capability, and registry evidence.
7. "Any coding agent" support is a marketable primitive. Google explicitly targets Gemini CLI, Claude Code, Codex, Antigravity, and other skill-aware agents. Port Daddy should keep treating cross-agent cooperation as first-class, not as a Claude/Codex-only workflow.

## What Not To Copy Blindly

Google optimizes for Google Cloud and Gemini Enterprise. Port Daddy optimizes for local-first control, multiple backends, cost gates, human operators, repo coordination, and eventually remote harbors. The useful part is the lifecycle and IA discipline, not the assumption that one cloud platform owns identity, runtime, storage, tracing, registry, and billing.

Google's observability stack maps to Cloud Trace, Cloud Logging, GCS, and BigQuery. Port Daddy should keep local SQLite/tuple/graph/session truth authoritative and add cloud export paths only when they preserve operator trust and cost visibility.

Google's template set is intentionally narrow. Port Daddy should resist making a template for every maritime name. The actors are runtime roles; starter templates should be use-case driven.

## Roadmap Additions For Port Daddy

1. Add a lifecycle-first docs and CLI proposal: `setup`, `scaffold`, `enhance`, `upgrade`, `run`, `eval`, `deploy/promote`, `publish`, `observe`.
2. Create a Port Daddy agent-engineering skill bundle mirroring the Google pattern: workflow, actor runtime, symbolic coordination, eval, deploy, publish/harbor, observability.
3. Design `pd scaffold enhance` and `pd scaffold upgrade` before generated hooks, skills, fleet YAML, website docs, or FleetBar assets drift further.
4. Give Signalman a real eval result schema plus `pd eval run` / `pd eval compare` equivalents.
5. Give Harbormaster a deploy/publish path that connects stable promotion, Cloudflare, package distribution, remote harbor, and Lighthouse registry evidence.
6. Give Breaker/Lookout an `observe` surface that joins traces, costs, tuple events, graph/memory mutations, claim attempts, file edits, failures, retries, and promotions.
7. Rework public/operator docs IA around lifecycle first, then concepts, operations, and reference.
8. Add starter templates by use case: local repo fleet, Cloudflare-backed fleet, remote-harbor-ready fleet, graph/memory fleet, and eval-heavy agent lab.

## Open Questions

1. How much of Port Daddy's current `pd init`, `pd install`, `pd mcp install`, `pd fleet init`, FleetBar install, and skill install path should collapse into one `pd setup`?
2. Should the generated project artifact be `pd-fleet.yml`, a new `pd-agent.yml`, or a directory structure with both fleet and actor specs?
3. What is the minimum eval schema that can support agent behavior, semantic collapse, memory retrieval, and prompt-routing comparisons without becoming another sprawling framework?
4. Which generated artifacts need 3-way upgrade semantics first: hooks, skills, FleetBar assets, fleet YAML, OpenAPI/MCP, or public docs?
5. Where does "publish" point first: local Lighthouse registry, remote harbor, A2A agent card, package release, or Cloudflare deployment?
