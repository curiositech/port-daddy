---
name: skillful-subagent-creator
license: Apache-2.0
description: Design bounded delegated workers by specifying outputs, inputs, tools, effects, stop rules, evidence, and handoffs. NOT a claim that prompts enforce permissions or that fixed skill counts, sections, or question quotas are optimal.
allowed-tools: Read,Write,Edit,Grep,Glob
argument-hint: '[role-name] [task-contract]'
metadata:
  category: Productivity & Meta
  tags: [subagent, task-contract, delegation, composition]
---

# Skillful Subagent Creator

Creates Claude subagents that are equipped with curated skills as their standard operating procedures. Each subagent is "a specialist with a toolkit" — a narrow role, a small skill set, and a clear workflow for applying those skills.

---

## When to Use

✅ **Use for**:
- Designing a specialist subagent for a specific domain
- Selecting only the methods and references needed for a defined task contract
- Writing a bounded role instruction with output, scope, stop conditions, and evidence
- Wiring subagents into DAG orchestration workflows
- Defining input/output contracts between DAG nodes

❌ **NOT for**:
- Creating the skills themselves (use `skill-architect`)
- Single-agent prompting without skills
- General Claude Code features or MCP setup

---

## Subagent Creation Process

```mermaid
flowchart TD
  A[Define the role] --> B[Select task-relevant procedures]
  B --> C[Write task-contract instructions]
  C --> D[Define input/output contracts]
  D --> E[Choose DAG position]
  E --> F{Standalone or chained?}
  F -->|Standalone| G[Test with sample task]
  F -->|Chained| H[Define handoff protocol]
  H --> G
  G --> I{Works correctly?}
  I -->|No| C
  I -->|Yes| J[Check enforced runtime controls before use]
```

---

## Step 1: Define the Role

A subagent role should be bounded enough for its output and authority to be independently reviewed.

```mermaid
flowchart TD
  A{How narrow?} -->|Too broad| B["Do all marketing" ❌]
  A -->|Right| C["Draft landing page copy" ✅]
  A -->|Too narrow| D["Fix typos in H1 tags" ❌]
```

**Test**: Can you describe what this subagent does in one sentence with a specific verb and noun? If not, narrow it.

**Examples of well-scoped roles**:

| Role | Domain | Sentence |
|------|--------|----------|
| Refactorer | TypeScript | "Designs and executes safe refactors in TypeScript monorepos" |
| PR Reviewer | Code review | "Reviews pull request diffs for correctness, style, and security" |
| Research Synthesizer | Research | "Synthesizes multi-source research into cited briefing documents" |
| Migration Planner | Databases | "Plans database schema migrations with rollback strategies" |

---

## Step 2: Select the minimum useful context

There is no research-backed universal number of skills per subagent. Start from the required output, compare candidate procedures with the task, and include only material needed to produce or validate that output. A short task may need no specialist skill; a larger task may need distinct procedures. Bound by context budget and instruction conflicts, then test omissions on representative tasks.

### Selection Criteria

```mermaid
flowchart TD
  A[Task contract and constraints] --> B[Inspect candidate method]
  B --> C{Does it change task output or validation?}
  C -->|Yes| D[Include needed procedure and source]
  C -->|No| E[Omit; record material capability gap]
  D --> F[Check budget and instruction conflicts]
  F --> G[Trial representative tasks; revise from observed misses]
```

### Context tiers (a local design pattern, not a measured universal threshold)

| Tier | Content | Use |
|------|---------|-----|
| **Task-critical** | Exact procedures, constraints, schema, and evidence rules | Include when needed to perform or verify the work |
| **On-demand** | Named references with an activation condition | Fetch when that decision is reached |
| **Omitted** | Unrelated material | Do not imply capability; record a material gap |

### Example Skill Selection

**Role**: PR Reviewer for TypeScript/React

| Tier | Skill | Why |
|------|-------|-----|
| Preloaded | `code-review-skill` | Core to every task |
| Preloaded | `react-server-components` | Catches RSC anti-patterns |
| Catalog | `typescript-strict-mode` | Sometimes relevant |
| Catalog | `testing-patterns` | Only for test file reviews |
| None | `database-migration` | Not in scope |

---

## Step 3: Write the task-contract prompt

A four-part prompt can be a convenient template, not a platform standard. Required content is task-specific: objective/output, authorized inputs and operations, stop/escalation, and evidence/handoff. Merge or split sections when that makes the contract clearer.

### Section 1: Identity

```markdown
You are the **[Role Name]** subagent for this system.
You handle [narrow domain of tasks].
When a task is outside this scope, explicitly say so and
ask the orchestrator for a different agent.
```

Keep it to a few sentences. Name the specific domain. State the boundary explicitly.

### Example: Methods and references

```markdown
You have access to the following skills, which define your methods:
- `skill-a`: [1-line purpose]
- `skill-b`: [1-line purpose]
- `skill-c`: [1-line purpose]

These are your standard operating procedures, not optional hints.
When tackling a task:
1. Decide which skill(s) apply
2. Follow their step-by-step workflow
3. Use their output formats and checklists
4. Reference skill steps by number as you work
```

### Section 3: Task-Handling Loop

```markdown
For each task you receive:
1. Restate the task in your own words
2. Select one or more skills that fit. If none fit well, say so.
3. If a decision-critical input is missing, ask the smallest useful question set or return an explicit blocked state
4. Produce a short internal plan
5. Execute the skill workflow step by step
6. Run any validation/QA steps from the skill
7. Return:
   (a) Final artifacts
   (b) Which skills you used (and which steps)
   (c) Assumptions and remaining risks
```

### Section 4: Constraints

```markdown
Quality bar: [e.g., "Never knowingly leave tests failing"]
Safety: [e.g., "No destructive operations without confirmation"]
Tie-breaking: [e.g., "If speed vs robustness conflict, pick robustness"]
Output format: [e.g., "Always return valid JSON matching the output contract"]
```

---

## Step 4: Define Input/Output Contracts

Every subagent must have explicit contracts so orchestrators and downstream agents can work with it.

### Input Contract

```json
{
  "task": "string — description of what to do",
  "files": ["string — paths to relevant files"],
  "context": "string — prior agent output or user requirements",
  "constraints": {
    "time_budget": "string — e.g., '5 minutes'",
    "quality_bar": "string — e.g., 'production-ready'"
  }
}
```

### Output Contract

```json
{
  "status": "pass | warn | fail",
  "artifacts": ["string — files created or modified"],
  "summary": "string — 1-3 sentence description of what was done",
  "skills_used": ["string — skill names and step numbers"],
  "risks": ["string — remaining risks or assumptions"],
  "metadata": {
    "duration_ms": "number",
    "tokens_used": "number"
  }
}
```

---

## Step 5: Wire into DAG Workflows

### Orchestration Patterns

```mermaid
flowchart TD
  subgraph "Single Specialist"
    O1[Orchestrator] --> S1[Specialist]
    S1 --> O1
  end

  subgraph "Chain"
    O2[Orchestrator] --> C1[Designer]
    C1 --> C2[Implementer]
    C2 --> C3[Tester]
    C3 --> O2
  end

  subgraph "Fan-out / Fan-in"
    O3[Orchestrator] --> P1[Auth Agent]
    O3 --> P2[Billing Agent]
    O3 --> P3[UI Agent]
    P1 --> M[Merger]
    P2 --> M
    P3 --> M
    M --> O3
  end
```

### Pattern Selection

| Pattern | When to Use | Skill Requirement |
|---------|-------------|-------------------|
| **Single specialist** | One bounded output and review condition | Only methods needed for that task |
| **Chain** | Sequential transformation pipeline | Each agent has different skills; output of A feeds input of B |
| **Fan-out / Fan-in** | Independent parallel work | Agents work concurrently; merger resolves conflicts |
| **Loop** | Iterative refinement | Same agent re-runs with feedback until quality bar met |
| **Human-in-the-Loop** | Approval required | Agent produces draft; human reviews; agent revises |

### DAG Node Definition

Each node in a DAG is a subagent with:

```yaml
node:
  id: review-pr
  agent: pr-reviewer
  skills: [code-review-skill, react-server-components]
  input_from: [parse-diff]
  output_to: [merge-decision]
  retry: 2
  timeout: 300s
  on_failure: escalate-to-human
```

---

## Step 6: Test

### Test Protocol

1. **Happy path**: Give the subagent a task that matches its skills perfectly
2. **Edge case**: Give a task at the boundary of its scope
3. **Out of scope**: Give a task outside its domain — it should refuse and say so
4. **Skill coverage**: Verify it uses the attached skills, not ad-hoc reasoning
5. **Output contract**: Verify output matches the JSON schema exactly

### Red Flags

- Agent invents processes instead of following skills → Skill usage rules not strong enough
- Agent tries to handle out-of-scope tasks → Identity section not clear enough
- Output doesn't match contract → Add explicit output format to constraints
- Agent loads all references eagerly → Add lazy-loading instruction to prompt

---

## Complete Example: PR Reviewer Subagent

### Config

```yaml
name: pr-reviewer
role: "Reviews TypeScript/React pull requests for correctness, style, and security"
skills:
  preloaded:
    - code-review-skill
    - react-server-components
  catalog:
    - typescript-strict-mode
    - testing-patterns
tools: [Read, Grep, Glob]
input_from: [diff-parser]
output_to: [merge-decision]
```

### Prompt

```
You are the **PR Reviewer** subagent. You review TypeScript and React
pull request diffs for correctness, readability, performance, and security.
You do NOT implement features, fix bugs, or write new code. If asked to do
so, say "This is outside my scope — route to the Implementer agent."

Your skills define your standard process:
- `code-review-skill`: Structured review methodology (correctness → style → perf → security)
- `react-server-components`: Catches RSC anti-patterns ('use client' overuse, async component errors)

For each PR you receive:
1. Restate what the PR changes and why
2. Select applicable skills (always code-review-skill; add react-server-components if React files changed)
3. Follow the skill's review steps in order
4. Produce findings in the output contract format
5. Summarize: approve, request changes, or block

Quality bar: Never approve a PR with failing tests or security vulnerabilities.
Tie-breaking: If unsure whether something is a bug or style preference, flag it as "suggestion" not "required."
Output: Always return JSON matching the output contract schema.
```

---

## Anti-Patterns

### Skill-Less Subagent
**Wrong**: Creating a subagent with just a role description and no skills.
**Why**: It will improvise a new process every time instead of following a consistent methodology.
**Fix**: Attach task-relevant procedures as standard operating procedures.

### Skill Overload
**Wrong**: Attaching 15 skills to one subagent.
**Why**: Blows context window; agent spends tokens selecting skills instead of executing.
**Fix**: Max 5 preloaded, rest in catalog. Let the orchestrator pre-filter.

### Missing Output Contract
**Wrong**: Subagent returns free-form text that downstream agents can't parse.
**Why**: DAG breaks because the next node can't consume the output.
**Fix**: Define explicit JSON output contract. Validate in tests.

### Scope Creep
**Wrong**: Subagent tries to handle everything instead of refusing out-of-scope tasks.
**Why**: Identity section doesn't state boundaries clearly enough.
**Fix**: Add "You do NOT handle X, Y, Z. If asked, say so and suggest the right agent."


## Runtime controls and prompt boundary

Prompt text expresses expected behavior; it does not enforce host permissions. At the runtime boundary, configure actual tool allow/deny, filesystem, network, and effect controls supported by the selected host, then test them independently. Anthropic's Claude Code CLI documents `--allowedTools` and `--disallowedTools`; its CLI reference also warns that permission-bypass modes skip prompts. Exact behavior is version-specific: https://docs.anthropic.com/en/docs/claude-code/cli-usage . This reference's task contract is a local design method, not a guarantee that Claude Code or another host provides a sandbox.

## Worked delegation: security review then patch

Constructed example. A reviewer receives a diff and threat model with read-only authority and returns findings keyed to exact changed lines, or a scoped no-findings result. An implementer receives only accepted finding IDs and authorized files; it cannot close review findings. A verifier reads the resulting patch and runs targeted tests. Join their outputs by finding ID and exact revision. If reproduction fails, mark the finding unconfirmed instead of silently calling it fixed. The orchestrator retains responsibility for user intent, dispatch, external effects, and final acceptance.
