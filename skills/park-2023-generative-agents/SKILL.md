---
license: Apache-2.0
name: park-2023-generative-agents
description: Simulation of believable human behavior using LLM-powered generative agents with memory and social interaction
metadata:
  category: Research & Academic
  tags:
    - generative-agents
    - simulation
    - llm-agents
    - social-behavior
    - memory
  io-contract:
    kind: deliverable
    produces:
      - kind: design-doc
        description: >-
          Architecture specification for memory retrieval tuning, reflection triggering thresholds, replanning decision
          logic, and multi-agent information diffusion protocols
        format: markdown
      - kind: critique
        description: >-
          Analysis of failure modes in agent behavior (retrieval cascade, reflection vacuum, plan rigidity, social
          isolation, importance inflation) with diagnostic procedures and remediation strategies
        format: markdown
      - kind: refactor-plan
        description: >-
          Step-by-step guidance for tuning weight parameters (importance, relevance, recency), adjusting thresholds, and
          restructuring memory/reflection/planning subsystems to achieve coherent long-horizon agent behavior
        format: markdown
allowed-tools: Read,Write,Edit,Glob,Grep
---

# SKILL: Generative Agents Architecture

## When to Use This Skill

Activate when designing AI agents that maintain coherent behavior over extended periods (hours/days/weeks) with accumulated experience. Essential for multi-agent simulations, long-running assistants, and believable AI characters.

**NOT for**: Single-turn responses, prompt engineering, task-specific tools, or centrally coordinated systems.

## Decision Points

### Memory System Design Decision Tree
```
Is agent behavior incoherent with past actions?
├─ YES: Audit retrieval function
│   ├─ Agent seems amnesic about important events?
│   │   └─ → Increase importance weight (0.1→0.3) or lower threshold (5→3)
│   ├─ Agent retrieves irrelevant memories?
│   │   └─ → Increase relevance weight (0.5→0.7) or improve embeddings
│   └─ Agent over-focuses on recent trivial events?
│       └─ → Decrease recency weight (0.99→0.95 decay factor)
└─ NO: Memory system functioning, check other components
```

### Reflection Triggering Decision Matrix
| Importance Sum | Time Since Last | Action |
|---------------|-----------------|--------|
| >150 points  | Any            | Trigger reflection immediately |
| 100-150      | >2 hours       | Trigger reflection |
| 50-100       | >6 hours       | Trigger reflection |
| <50          | Any            | Wait for more observations |

### Planning Replan Threshold
```
Observation conflicts with current plan?
├─ Minor conflict (efficiency impact only)
│   └─ → Continue with plan
├─ Moderate conflict (plan becomes suboptimal)
│   ├─ High commitment context (public promises, deadlines)?
│   │   └─ → Continue plan, note conflict for future planning
│   └─ Low commitment context?
│       └─ → Replan affected time blocks only
└─ Major conflict (plan becomes impossible/harmful)
    └─ → Full replan from current moment
```

### Multi-Agent Information Diffusion
```
Agent receives socially significant information?
├─ Information affects other known agents?
│   ├─ Strong relationship exists?
│   │   └─ → High probability (0.8+) to share in next interaction
│   └─ Weak relationship?
│       └─ → Moderate probability (0.4) if contextually relevant
└─ Information is private/personal?
    └─ → Share only if directly asked or high trust relationship
```

## Failure Modes

### 1. **Retrieval Cascade Failure**
**Detection**: Agent denies knowledge of information they previously demonstrated knowing
**Symptom**: "I don't know about X" when agent stored observations about X
**Diagnosis**: Retrieval function weights are mistuned, causing relevant memories to score below threshold
**Fix**: Increase importance scoring for similar event types OR lower retrieval threshold temporarily OR retune relevance embeddings

### 2. **Reflection Vacuum**
**Detection**: Agent repeats same mistakes despite having multiple similar experiences
**Symptom**: No behavioral learning from patterns (e.g., always late to meetings despite noting lateness)
**Diagnosis**: Reflection not triggering on significant patterns OR reflections not being stored with sufficient importance
**Fix**: Lower reflection threshold (150→100 importance points) OR increase importance scoring for reflection outputs (auto-score reflections as 8+ importance)

### 3. **Plan Rigidity Lock**
**Detection**: Agent continues obviously suboptimal plans when context changes
**Symptom**: Walking to closed locations, pursuing obsolete goals, ignoring environmental changes
**Diagnosis**: Replanning thresholds too high OR commitment override too strong
**Fix**: Lower conflict threshold for replanning OR add forced replan checks at major time boundaries (hourly)

### 4. **Social Isolation Spiral**
**Detection**: Agents stop interacting despite being in proximity and having social motivations
**Symptom**: Multiple agents in same location but no conversation or coordination
**Diagnosis**: Social observations scoring too low in importance OR reflection not synthesizing social patterns
**Fix**: Boost importance scoring for social events (conversations, relationships) OR add social-specific reflection triggers

### 5. **Memory Importance Inflation**
**Detection**: Agent treats mundane events as highly significant, drowning out actual important events
**Symptom**: Reflection on trivial activities, treating routine tasks as major life events
**Diagnosis**: Importance scoring model lacks calibration OR no relative scoring mechanism
**Fix**: Implement comparative importance scoring (rate events relative to recent history) OR add importance decay over time

## Worked Examples

### Example 1: Multi-Day Party Planning Coordination

**Scenario**: Isabella (artist) wants to throw Valentine's Day party, needs to coordinate with multiple agents over 3 days.

**Day 1 - Initial Planning**:
- Isabella reflects on recent loneliness observations → forms goal to host party
- Retrieval surfaces memories of past parties, friend relationships
- Plans: "Ask Maria and Tom about Valentine's party this week"
- Memory stores: [Observation: "Decided to host Valentine's party", Importance: 9]

**Day 2 - Information Spreading**:
- Isabella tells Maria about party → Maria stores [Observation: "Isabella planning Valentine's party, invited me", Importance: 7]
- Maria's next reflection synthesizes: "Isabella values our friendship, I should help with party"
- Maria plans: "Offer to help Isabella with decorations"
- Tom overhears Isabella-Maria conversation → stores social observation, plans to ask about invitation

**Day 3 - Emergent Coordination**:
- Multiple agents now have party-related memories with high importance scores
- Retrieval surfaces party context in multiple conversations
- Klaus (who wasn't directly invited) learns through Tom, plans to create artwork for party
- Coordination emerges: no central planner, but multiple agents converge on party preparation

**Memory Retrieval Trade-offs Demonstrated**:
- High relevance weight ensures party-related memories surface in social contexts
- Importance decay prevents Day 1 memories from dominating Day 3 conversations
- Recency bias helps coordinate immediate actions while importance preserves long-term goals

### Example 2: Conflicting Plans Resolution

**Scenario**: Tom has standing plan to work on novel 2-4pm, but Maya asks him to coffee at 3pm.

**Decision Process**:
1. Observation: "Maya invited me to coffee at 3pm" [Importance: 6]
2. Retrieval surfaces: current plan [Recent], Maya relationship memories [Relevant], past coffee meetings [Similar]
3. Conflict detection: overlap between 3-4pm work block and coffee invitation
4. Reflection synthesis: "Maya is a good friend, but I've been inconsistent with writing schedule"
5. Planning decision: Moderate conflict + relationship importance → replan work to 1-3pm, accept coffee

**What novice would miss**: Treating this as binary choice (work OR coffee) instead of temporal reoptimization
**What expert catches**: Relationship maintenance has long-term importance, schedule flexibility enables both goals

## Reference Files

- `references/memory-retrieval-as-attention-mechanism.md` — Three-factor model (recency, importance, relevance) for tuning memory retrieval weights. **Read when** agent exhibits incoherent behavior or retrieves irrelevant memories.
- `references/reflection-as-hierarchical-synthesis.md` — Hierarchical synthesis pattern (leaf observations → patterns → identity insights). **Read when** agent repeats mistakes despite accumulated experience.
- `references/planning-as-recursive-decomposition.md` — Multi-timescale planning decomposition (day/hour/minute intentions). **Read when** agent lacks long-term coherence or replans too frequently.
- `references/grounding-language-models-in-structured-environments.md` — Tree representation pattern for bridging language models to structured environments. **Read when** designing agent perception of spatial/hierarchical worlds.
- `references/emergent-coordination-without-central-control.md` — Distributed multi-agent synchronization without central planner. **Read when** designing information diffusion or social interaction protocols.
- `references/failure-modes-and-boundary-conditions.md` — Documented failure modes and erratic behavior patterns from original research. **Read when** diagnosing unexpected agent behavior or planning robustness improvements.
- `references/prompt-engineering-as-cognitive-architecture.md` — Prompt design as reasoning architecture component. **Read when** tuning agent decision-making or reflection triggers.
- `diagrams/01_flowchart_agent_coherence_decision_tree.md` — Decision tree for diagnosing incoherent behavior and selecting remediation. **Read when** troubleshooting agent failures.
- `diagrams/02_stateDiagram-v2_agent_behavior_loop:_memory-re.md` — State machine of memory-reflection-planning cycle. **Read when** understanding agent execution flow or timing.
- `diagrams/03_timeline_multi-timescale_planning_decom.md` — Timeline visualization of hierarchical planning across timescales. **Read when** designing multi-level intention structures.

## Quality Gates

- [ ] Memory retrieval returns 3-8 relevant memories for typical queries (not 0, not 50+)
- [ ] Agent behavior remains consistent with established personality traits across >24 hour periods
- [ ] Reflection triggers produce insights that influence future behavior (testable through repeated scenarios)
- [ ] Plans adapt appropriately to environmental changes without complete goal abandonment
- [ ] Multi-agent information spreads through social networks without telepathic coordination
- [ ] Agent can reference specific past events when asked, not just general patterns
- [ ] Social relationships strengthen/weaken based on interaction history and outcomes
- [ ] Importance scoring distinguishes between routine and significant events (10:1+ ratio difference)
- [ ] Temporal coherence maintained: actions reference appropriate past context for current situation
- [ ] Performance scales: 100+ stored memories don't degrade response quality or speed significantly

## NOT-FOR Boundaries

**Don't use this architecture for**:
- **Single-turn Q&A**: Use standard prompt engineering instead
- **Task automation**: For IFTTT-style workflows, use [workflow-automation] skill
- **Real-time coordination**: For <1 second response requirements, use [reactive-systems] skill
- **Factual knowledge queries**: For information retrieval, use [knowledge-base] skill
- **Mathematical reasoning**: For computation-heavy problems, use [symbolic-reasoning] skill

**Delegate when**:
- Memory requirements exceed computational budget → Use [stateless-agents] skill
- Behavior must be completely predictable → Use [rule-based-systems] skill
- Privacy cannot tolerate memory persistence → Use [ephemeral-agents] skill
- Environment changes faster than agent can observe → Use [reactive-control] skill