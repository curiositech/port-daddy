---
license: Apache-2.0
name: ai-engineer
description: Build production-ready LLM applications, advanced RAG systems, and intelligent agents. Implements vector search, multimodal AI, agent orchestration, and enterprise AI integrations. Use PROACTIVELY for LLM features, chatbots, AI agents, or AI-powered applications.
allowed-tools: Read,Write,Edit,Glob,Grep,Bash,WebFetch,mcp__sequentialthinking__sequentialthinking
metadata:
  category: AI & Machine Learning
  tags:
    - llm
    - rag
    - agents
    - ai
    - production
    - embeddings
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: agentic-app-architecture
      reason: Decides the app's overall shape (transparency, memory, execution substrate) before this skill builds the RAG/agent internals inside it.
    - skill: agentic-infrastructure-2026
      reason: Picks the framework/observability/cost-governance stack this skill's RAG pipeline and agents run on top of.
    - skill: llm-router
      reason: Supplies the model-selection mechanics behind this skill's Model Routing Strategy decision point.
    - skill: episodic-memory-algorithms
      reason: Supplies the vector-store/retrieval algorithm internals behind this skill's RAG Component Selection decision point.
    - skill: prompt-engineer
      reason: Designs and audits the individual prompts this skill's LLM app is built from.
  io-contract:
    kind: deliverable
    consumes:
      - kind: ai-feature-requirement
        format: markdown
      - kind: ai-system-plan
        format: json
    produces:
      - kind: ai-system-design
        format: markdown
      - kind: ai-system-readiness-audit
        format: json
---
# AI Engineer

Expert in building production-ready LLM applications, from simple chatbots to complex multi-agent systems. Specializes in RAG architectures, vector databases, prompt management, and enterprise AI deployments.

## Decision Points

### RAG Component Selection
```
Query Type Assessment:
├── Simple FAQ/Knowledge Lookup
│   ├── Document Count < 1000 → Chroma + text-embedding-3-small
│   └── Document Count > 1000 → Pinecone + text-embedding-3-large
├── Technical/Code Documentation  
│   ├── Budget Constrained → bge-large + pgvector
│   └── Performance Critical → voyage-2 + Weaviate
└── Conversational/Multi-turn
    ├── Memory Required → Agent pattern + context management
    └── Stateless → Standard RAG pipeline

Reranking Decision:
├── Precision Critical (legal, medical) → Always use Cohere Rerank
├── Latency < 200ms → Skip reranking, tune retrieval
├── Budget Constrained → Cross-encoder (bge-reranker-large)
└── Default → Cohere Rerank with top-10 → top-3

Database Selection:
├── Existing Postgres → pgvector extension
├── Need Hybrid Search → Weaviate or Qdrant
├── Managed Service → Pinecone
└── Self-hosted/Local → Chroma or Qdrant
```

### Model Routing Strategy
```
Complexity Assessment:
├── Keywords Only (FAQ) → Claude Haiku
├── Single Document Reference → Claude Sonnet  
├── Multi-document Synthesis → Claude Opus
└── Code Generation → Claude Sonnet with tools

Token Budget Check:
├── < 1K tokens → Any model
├── 1K-4K tokens → Sonnet/GPT-4
├── 4K-32K tokens → Claude Opus
└── > 32K tokens → Chunk and summarize first
```

Model-selection mechanics (cost/latency tiering across providers) belong to `llm-router` — this
decision point is about matching task complexity to a tier, not the routing implementation itself.

### Agent vs RAG Decision
```
Task Classification:
├── Static Knowledge Query → Pure RAG
├── Need External APIs → Agent with tools
├── Multi-step Reasoning → Agent with planning
├── Real-time Data Required → Agent with live tools
└── Simple Q&A → RAG with fallback to agent
```

## Failure Modes

### **Semantic Mismatch Cascade**
**Symptoms**: Good retrieval precision but poor answer relevance, users say "close but not quite right"
**Detection Rule**: If semantic similarity > 0.8 but user satisfaction < 60%
**Root Cause**: Query and document embeddings optimized for different semantic spaces
**Fix**: Switch to domain-specific embedding model or implement query expansion with synonyms

### **Context Window Overflow**
**Symptoms**: Responses become generic, model ignores specific retrieved context, inconsistent answers
**Detection Rule**: If context utilization ratio < 30% and response generality score > 0.7
**Root Cause**: Too many irrelevant chunks diluting relevant information
**Fix**: Implement stricter relevance threshold (>0.8) and dynamic context selection

### **Tool Hallucination Loop**
**Symptoms**: Agent makes up API calls, references non-existent functions, infinite retry cycles
**Detection Rule**: If tool call success rate < 50% or iteration count > max_iterations * 0.8
**Root Cause**: Model trained on different tool schemas than implementation
**Fix**: Add tool validation layer and explicit error handling in agent system prompt

### **Embedding Drift Degradation**
**Symptoms**: Gradual decline in retrieval quality over time, seasonal performance drops
**Detection Rule**: If monthly average retrieval@5 drops > 10% from baseline
**Root Cause**: Domain language evolves but embedding model remains static
**Fix**: Implement embedding model retraining pipeline or switch to adaptive embeddings

### **Response Latency Creep**
**Symptoms**: P95 latency increases gradually, user complaints about slow responses
**Detection Rule**: If P95 response time > 2x baseline for 7 consecutive days
**Root Cause**: Vector index degradation, context size inflation, or model endpoint saturation
**Fix**: Implement index optimization schedule, context pruning, and multi-model load balancing

## Worked Examples

### Example: Customer Support Chatbot Implementation

**Initial Requirements**: "Build a chatbot that can answer questions about our 500-page product documentation"

**Step 1: Architecture Decision**
- Document count: 500 pages → Use Pinecone for scalability
- Query type: Mixed FAQ + troubleshooting → Hybrid search needed
- Latency requirement: < 3 seconds → Include reranking but optimize

**Step 2: Implementation Walkthrough**
```typescript
// Novice approach - would use basic similarity search
const chunks = await vectorDb.query(queryEmbedding, { topK: 5 });

// Expert approach - considers relevance thresholds
const rawChunks = await vectorDb.query(queryEmbedding, { 
  topK: 20, 
  threshold: 0.7  // Ensure minimum relevance
});

// Expert adds reranking step novice would skip
const reranked = await reranker.rank(query, rawChunks);
const finalChunks = reranked.slice(0, 3);

// Expert includes fallback handling
if (finalChunks.length === 0) {
  return await fallbackToGeneralSupport(query);
}
```

**Step 3: Performance Optimization Discovery**
- Initial P95 latency: 4.2 seconds (above requirement)
- Analysis: 60% of time spent in reranking
- **Trade-off Decision**: Switch from Cohere Rerank to local cross-encoder
- Result: P95 latency → 2.1 seconds, slight quality drop (92% → 89% satisfaction)
- **Expert Insight**: For support use case, speed > perfect accuracy

**Step 4: Failure Scenario Handling**
- Discovered 15% of queries were about features not in documentation
- Novice: Would return "I don't know"
- Expert: Added escalation detection and handoff to human agent

**Final Architecture**: Pinecone + local reranker + agent escalation = 89% automation rate at 2.1s P95

## Anti-Patterns

### Shipping RAG on Vibes

**Novice**: Ships retrieval after a handful of manual "looks good to me" spot-checks; no held-out
evaluation set, no CI gate, no measured recall/precision.
**Expert**: Stands up a repeatable eval harness (unit + retrieval + end-to-end + adversarial) before
shipping, and re-runs it on every prompt/retrieval/model change.
**Detection**: `ai_system_audit.mjs` returns `no-eval-harness` (critical) when `evalHarness.exists` is
false, and `eval-harness-thin` (medium) when it exists but lacks end-to-end/adversarial coverage.

### Grounding as a Prompt Suggestion, Not a Checked Property

**Novice**: Asks the model nicely to "cite your sources" and trusts that it will, with no retrieval
measurement and no validation that citations actually match retrieved content.
**Expert**: Measures retrieval@k recall/precision against a held-out set (never eyeballs "does this
answer look right"), requires citations for every factual claim, and validates output against
retrieved sources programmatically instead of trusting the prompt.
**Detection**: `ai_system_audit.mjs` returns `retrieval-never-measured` (critical) when
`retrieval.used` is true but recall/precision were never measured (the Semantic Mismatch Cascade
failure mode above), `no-grounding-requirement` (critical) when the system makes factual claims but
`grounding.citationsRequired` is false, and `grounding-not-enforced` (medium) when citations are
required but `sourceAttributionEnforced` is false.

### No Fallback, No Defense, No Ceiling

**Novice**: Ships an agent that always answers confidently (no low-confidence fallback), accepts raw
user text and retrieved documents into the same context with no isolation (no injection defense), and
has no per-request cost cap — a single adversarial or pathological request can run away.
**Expert**: Adds a confidence threshold with an explicit fallback action, isolates untrusted content
(user input, retrieved docs, tool output) from the system prompt, and enforces a per-request cost
ceiling as part of the design — not as an afterthought infra control.
**Detection**: `ai_system_audit.mjs` returns `no-low-confidence-fallback` (critical) when
`lowConfidenceFallback.exists` is false, `no-injection-defense` (critical) when the system accepts
untrusted input and `promptInjectionDefense.exists` is false, `no-cost-ceiling` (high) when
`costCeiling.enforced` is false, and `tool-hallucination-risk` (critical) — the Tool Hallucination
Loop failure mode above — when tools are used with no `toolUse.validationLayer`.

## Quality Gates

- [ ] Retrieval@5 accuracy > 85% on evaluation dataset
- [ ] Average response latency < 3 seconds for P95
- [ ] Context utilization ratio > 60% (model uses retrieved information)
- [ ] Hallucination rate < 5% (responses not supported by retrieved context)
- [ ] User satisfaction score > 80% over 30-day rolling window
- [ ] Token cost per query < predefined budget threshold
- [ ] System uptime > 99.9% excluding planned maintenance
- [ ] PII detection rate > 95% (no personal info in responses)
- [ ] Embedding model performance stable (no >10% monthly degradation)
- [ ] Error handling covers all failure modes with graceful degradation

## Machine-Checkable Audit

The build-quality subset of the Quality Gates above — the parts a JSON plan can state before a line
of code ships — is machine-checkable. `scripts/ai_system_audit.mjs` exports `auditAiSystem(plan)`,
which scores a JSON AI-system plan and flags the failure modes most likely to ship a broken AI
feature: no eval harness, unmeasured retrieval, unrequired/unenforced grounding, missing hallucination
guardrails, no low-confidence fallback, missing streaming UX on an interactive system, no prompt
injection defense on untrusted input, no enforced per-request cost ceiling, and unvalidated tool calls.

This is deliberately scoped to the AI system's own build quality — it does NOT re-check
`agentic-infrastructure-2026`'s `infra_readiness.mjs` gates (framework selection, MCP context
overhead, observability wiring, organizational/adoption readiness). A plan can pass this audit and
still fail that one (e.g. a well-built RAG pipeline with no chosen framework or kill switch), and vice
versa.

- `schemas/ai-system-plan.schema.json` — draft-07 shape of the plan the auditor consumes.
- `examples/sample-input.json` — a complete plan that scores `pass: true`.
- `examples/expected-output.md` — a "ships on vibes" plan audited, then the same plan fixed and passing.

```bash
node scripts/ai_system_audit.mjs --input examples/sample-input.json
# => { "pass": true, "score": 100, "findings": [], "recommendations": [...] }
```

## Not-For Boundaries

**Do NOT use this skill for:**

**Agent Infrastructure/Framework Selection** → Use `agentic-infrastructure-2026` instead
- Choosing LangGraph/CrewAI/Semantic Kernel/MCP
- Observability, evaluation-pipeline tooling, cost governance (kill switches, budget alerts, quotas)
- Adoption strategy, ROI measurement, pilot scoping

**Model-Routing Mechanics** → Use `llm-router` instead
- Building the routing layer that picks Haiku vs Sonnet vs Opus per request at runtime
- Cost/latency-tiered dispatch across providers

**Agentic App Shape Decisions** → Use `agentic-app-architecture` instead
- Interaction transparency, execution-substrate/side-effect isolation, overall memory/state shape
  (this skill builds what runs *inside* that shape, not the shape itself)

**Memory Algorithm Internals** → Use `episodic-memory-algorithms` instead
- Vector-index internals (HNSW/IVF/PQ), forgetting curves, memory consolidation mechanics

**Prompt Engineering Tasks** → Use `prompt-engineer` instead
- Optimizing prompt templates and instructions
- A/B testing prompt variations
- Chain-of-thought prompt design

**ML Model Training/Fine-tuning** → Out of scope for this skill; use dedicated model-training/fine-tuning tooling
- Training custom embedding models
- Fine-tuning LLMs on domain data
- Model architecture research

**Data Pipeline Engineering** → Use `data-pipeline-engineer` instead
- ETL processes for training data
- Data validation and cleaning workflows
- Batch processing systems

**Infrastructure/DevOps** → Out of scope for this skill; use your stack's infra/DevOps skill (e.g. `cloudflare-worker-dev`, `devops-automator`)
- Kubernetes deployment strategies
- Database optimization and sharding
- Load balancer configuration

**Analytics and Monitoring Setup** → Use `chatbot-analytics` instead
- Conversation flow analysis
- User behavior tracking
- Performance dashboard creation

**Delegate When:**
- Task requires deep ML training/fine-tuning expertise → dedicated model-training tooling
- Focus is on conversation design → `prompt-engineer`  
- Need infrastructure scaling → your stack's infra/DevOps skill
- Want usage analytics → `chatbot-analytics`
- Need agent infrastructure/framework/observability decisions → `agentic-infrastructure-2026`
- Need model-routing dispatch mechanics → `llm-router`
- Need the app's overall shape decided first → `agentic-app-architecture`
- Building non-AI features → Relevant specialist skill

## References

| File | Load When |
| --- | --- |
| `templates/output-template.md` | Drafting an AI system design and its Roadmap-Item trailer. |
| `schemas/ai-system-plan.schema.json` | Validating an AI-system-plan JSON payload's shape before auditing it. |
| `scripts/ai_system_audit.mjs` | Need deterministic scoring of a plan's build-quality readiness. |
| `examples/sample-input.json` | Need a complete plan that scores `pass: true`. |
| `examples/expected-output.md` | Need to see a "ships on vibes" system audited, then the same system fixed and passing. |
| `agents/openai.yaml` | Need a subagent descriptor for delegated AI-system design/build. |

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — AI Engineer — Changelog — - Imported from the global jury_rig skill catalog (`ai-engineer`, SKILL.md-only) into the repo.
- [`README.md`](README.md) — AI Engineer — Build production-ready LLM applications, RAG systems, and intelligent agents: retrieval component selection, model routing strategy, agent-v

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: AI Engineer — Scenario: a team ships a customer-support RAG chatbot after two weeks of manual "looks good to me" spot-checking.
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`schemas/`**
- [`schemas/ai-system-plan.schema.json`](schemas/ai-system-plan.schema.json) — ai system plan.schema (data/schema)

**`scripts/`**
- [`scripts/ai_system_audit.mjs`](scripts/ai_system_audit.mjs)

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — AI System Design Template — Fill in every section before implementation begins.

<!-- END BUNDLE INDEX -->
