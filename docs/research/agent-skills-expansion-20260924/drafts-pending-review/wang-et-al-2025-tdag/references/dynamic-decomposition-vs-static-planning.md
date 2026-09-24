# Dynamic Decomposition vs. Static Planning: Why Early Commitment Kills Complex Problem Solving

## The Core Problem with Static Planning

When an intelligent system faces a complex, multi-step task, the intuitive approach is to break it down: decompose the problem into subtasks, assign each to a specialist, execute sequentially. This is the foundation of nearly every task planning system from hierarchical task networks to modern LLM-based agents.

Yet this paper demonstrates a critical failure mode: **static decomposition—deciding all subtasks upfront—creates brittle execution chains where early failures cascade catastrophically through the entire task sequence.**

The TDAG study evaluates its framework on ItineraryBench, a curated travel-planning simulator with 364 test scenarios and GPT-3.5-turbo-16k for the primary comparison. Table 2 reports 49.08 for TDAG, 43.02 for ReAct, and 42.85 for P&E under the paper's 60/20/20 scoring. Table 3 reports each error category as a percentage of that method's total errors; CTF is 34.78% for P&E and 4.35% for TDAG. These are benchmark-specific results, not deployment failure probabilities or proof of statistical significance.

## What Is Cascading Task Failure?

Consider this scenario from the paper's travel planning domain:

```
Subtask 1: Book train from Shanghai to Beijing, departing 14:40
Subtask 2: Arrive Beijing at 20:30, visit the Great Wall
Subtask 3: Visit Forbidden City
Subtask 4: Return to Shanghai by train
```

In static decomposition, these subtasks are fixed at planning time. If Subtask 1 fails—perhaps the 14:40 train is unavailable—the system has three bad options:

1. **Proceed anyway**: Subtask 2 assumes 20:30 arrival but the agent never boards a train. The plan becomes nonsensical.
2. **Abort entirely**: Throw away Subtasks 2-4 even though visiting the Great Wall tomorrow would work fine.
3. **Retry forever**: Keep attempting the 14:40 train, never considering the 18:25 alternative that would merely delay the Great Wall visit by a few hours.

This is an illustrative path, not a quantified paper finding: a downstream task may be blocked while unrelated verified work remains useful.

## Dynamic Decomposition: Replanning as First-Class Operation

The following train and itinerary stories are constructed teaching cases; they are not quoted benchmark traces. Paper-specific equations and metrics are linked at https://arxiv.org/html/2402.10178.

TDAG's solution is deceptively simple but architecturally profound. Task decomposition is *not* a one-time planning phase but an **ongoing process that updates based on execution results**:

```
t'_i = Update(t_i, r_1, r_2, ..., r_{i-1})
```

Where `t'_i` is the revised i-th subtask and `r_1...r_{i-1}` are the actual results of completed subtasks (Equation 6).

In the train booking example, when Subtask 1 fails, the system doesn't execute Subtask 2 blindly. Instead:

1. **Execution feedback**: "Train G2304 at 14:40 is fully booked"
2. **Dynamic update**: Main agent receives this result and regenerates Subtask 2: "Bob arrives in Beijing by train G2305 at 22:45 on July 8th. Adjust the Beijing itinerary to start the next morning."
3. **Cascade prevention**: Later subtasks remain executable; the Great Wall visit shifts to July 9th morning instead of July 8th evening.

The paper's Algorithm 1 shows this explicitly: after each subtask execution (line 6), the task list is updated (line 11), not just marked complete/incomplete.

## Why This Matters for Agent Orchestration Systems

### 1. Error Containment Boundaries

In static systems, errors have **task-wide scope**—any failure potentially invalidates the entire plan. Dynamic decomposition creates **subtask-scoped errors** with contained blast radius. The system asks: "Given what actually happened in steps 1-3, what should step 4 become?" not "Does step 4 match the original plan?"

For an orchestration system, a practical implication to evaluate is:
- **Don't**: Generate complete task graphs upfront with fixed edges
- **Do**: Generate next-subtask proposals after each subtask completes, consuming actual execution traces

### 2. The Replan Decision Is Itself a Coordination Problem

TDAG uses a "main agent" to perform decomposition updates (line 11, Algorithm 1). This is a coordinator role distinct from executors. The coordinator:
- Receives execution results from subagents
- Decides if replanning is needed
- Generates updated subtask specifications
- Routes them to appropriate (possibly new) subagents

This maps to orchestration patterns where:
- **Executors** are skills/agents that perform atomic actions
- **Coordinators** are meta-agents that observe execution traces and revise plans
- **Communication** flows bidirectionally: coordinators send tasks, executors return structured results (not just success/failure)

### 3. Context Management Through Decomposition

The paper notes that single-agent ReAct approaches suffer from "excessive irrelevant contexts" degrading LLM performance. But naive decomposition doesn't solve this—P&E performs worse than ReAct despite using subagents.

The difference: **dynamic decomposition allows context refinement at each step**. When generating Subtask i, the main agent has access to:
- Original task specification
- Actual results r_1 through r_{i-1}
- Environmental state changes caused by those results

This allows generating subtask descriptions that are *contextually precise*—"Bob is now in Beijing at 22:45 on July 8th" vs. the original plan's "Bob should arrive at 20:30." Subagents receive accurate context without needing the full task history.

For multi-agent orchestration:
- Subagents should receive **current state summaries**, not full execution logs
- Coordinators maintain the full history and synthesize it into fresh, accurate context per subtask
- Each subtask description should reflect *reality*, not *original intentions*

## When Static Planning Is Acceptable

The paper reports generalization experiments in Section 5.5. Interpret each score only within the stated task, environment, and model setup; it is not a universal deployment estimate. But TextCraft and WebShop don't exhibit the same CTF vulnerability. Why?

**Static planning can be adequate when:**

1. **Subtasks are loosely coupled**: Failure in subtask i doesn't invalidate subtask i+1's preconditions
2. **Environment is deterministic**: Executing action A reliably produces state B
3. **Failure recovery is local**: Retrying a subtask eventually succeeds without changing the overall plan

Travel planning violates all three:
- Booking train X at time T1 is a hard precondition for arriving at city Y at time T2
- Ticket availability is stochastic
- If train X is unavailable, no amount of retrying helps; you need a *different plan*

**For Jury-rig skill design**: Classify problems along these dimensions. Use static decomposition for deterministic, loosely-coupled tasks (e.g., "analyze these 10 files" where file order doesn't matter). Reserve dynamic decomposition for tightly-coupled, stochastic workflows (e.g., "debug this system" where each finding changes what to investigate next).

## Implementation Pattern: The Update Mechanism

The paper doesn't detail the Update function's internals, but Section 4.1 implies it's an LLM prompt that:

**Inputs:**
- Original subtask specification t_i
- Execution results r_1...r_{i-1} from previous subtasks
- (Implicitly) the original task T for goal context

**Outputs:**
- Revised subtask t'_i that:
  - Achieves the same *goal* as t_i (visit the Great Wall)
  - Adjusts *constraints* based on reality (start time is now 09:00 not 08:00)
  - Updates *preconditions* (agent is in Beijing Railway Hotel, not at train station)

For orchestration systems, implement this as a **replanning skill** that:

```python
def replan_subtask(
    original_subtask: Task,
    completed_subtasks: List[Task],
    execution_results: List[Result],
    original_goal: Task
) -> Task:
    """
    Given actual execution history, rewrite the next subtask
    to maintain goal feasibility under current conditions.
    """
    prompt = f"""
    Original plan: {original_subtask}
    What actually happened: {execution_results}
    
    Rewrite the next subtask to:
    1. Still work toward the goal: {original_goal}
    2. Account for actual current state
    3. Preserve intent while adjusting constraints
    
    If the original subtask is now impossible, propose an alternative
    that achieves the same purpose.
    """
    return llm.generate(prompt)
```

## The Measurement Problem

Section 5.4 and Figure 3 compare binary success (defined as full Level 1 executability) with ItineraryBench's fine-grained score. The authors report that binary scoring distinguishes methods poorly on this challenging benchmark; the figure does not establish statistical significance or a universal “20% gap.” Table 2's average scores and Figure 3's comparison are different reported views and should not be conflated.

**Evaluation implication:** define task-level success separately from partial-credit progress. Partial credit explains where a run progressed; it is not a substitute for completion.

**For agent system development:** predeclare end-to-end success criteria, and separately instrument validated subtasks, critical constraints, and failure state. Report denominator and uncertainty for each measure.

The paper's three-level evaluation (Executability → Constraint Satisfaction → Efficiency) provides a template:
- **Level 1**: Are individual actions valid? (train exists, time is consistent)
- **Level 2**: Do actions satisfy requirements? (budget not exceeded, attractions visited)
- **Level 3**: Is the solution optimized? (minimize time/cost)

For this benchmark, Section 3.3 defines weighted levels (60/20/20) and gates higher-level scoring on lower-level validity. Preserve that as the paper’s scoring rule, not a universal rubric.

For ItineraryBench, executability gates the later constraint and efficiency scores. A local evaluation may adopt staged scoring, but should separately report task completion and avoid assigning value to partial work that violates a critical requirement.

## Connection to DAG Orchestration

Jury-rig likely represents tasks as directed acyclic graphs where nodes are skills and edges are data dependencies. The TDAG paper suggests:

**Don't**: Build the entire DAG upfront
**Do**: Build a meta-DAG where:
- **Execute subtask i** → **Evaluate result** → **Replan subtasks i+1...n** → **Execute subtask i+1**

Each "Replan" node consumes execution history and generates new subtask specifications. The DAG grows and mutates during execution.

This is feasible because:
1. Each subtask completes before the next is fully specified (sequential execution within complexity levels)
2. The coordinator maintains global state while executors work locally
3. Subtask boundaries provide natural checkpoints for replanning decisions

## Boundary Conditions: When Dynamic Decomposition Adds Overhead

**Unnecessary replanning costs tokens and latency.** If subtask success rate is >95%, dynamic updates rarely trigger—you pay planning overhead for minimal benefit.

**Highly parallel tasks don't benefit.** If subtasks 2-10 can all run simultaneously independent of subtask 1, dynamic decomposition adds sequencing constraints that hurt performance.

**Small task spaces.** If there are only 3 possible plans and you can enumerate them upfront, replanning is overkill—just try plan A, then plan B, then plan C.

ItineraryBench includes route and schedule dependencies over 83 attractions in 15 cities, with 364 manually curated and code-assisted test samples. It is a useful testbed for studying changing prerequisites, not proof that the pattern is “ideal” for all tasks.

## Summary: The Architectural Principle

**Static decomposition treats planning as a one-time compilation step that generates an execution plan.**

**Dynamic decomposition treats planning as continuous interpretation where each execution step provides feedback that reshapes subsequent plans.**

For tasks where observations change later prerequisites, compare an outcome-updated policy with a static plan. Measure coordination overhead and task outcomes rather than assuming either policy always wins.