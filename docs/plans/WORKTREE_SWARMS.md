# Worktree Swarms: Stigmergic Isolation & Parallel Coordination

## 1. The Concept
In high-velocity multi-agent systems (like WinDAGs), executing agents in a single directory leads to race conditions and "edit wars." By leveraging Port Daddy's **Worktree-Aware Architecture**, we can orchestrate "Worktree Swarms" where each agent operates in total physical isolation while remaining logically connected via the Port Daddy Control Plane.

## 2. The "Physical Layer" (Isolation)
Every node in a WinDAGs execution can be mapped to a unique Git Worktree. 
*   **Path:** `.claude/worktrees/agent-<hash>`
*   **Isolation:** File changes in one worktree do not affect others.
*   **Port Daddy Pinning:** When an agent registers, Port Daddy automatically detects its `worktree_id`. 

## 3. The "Ambient Layer" (Coordination)
Even though agents are physically isolated, they are **Logically Co-located** in a Port Daddy **Harbor**.

### Cross-Worktree "Radio Traffic"
Agents use Port Daddy's SSE Pub/Sub (`lib/messaging.ts`) to coordinate across worktree boundaries:
1.  **Agent A (Worktree 1):** Completes a feature. It doesn't wait for a merge. It broadcasts a `state:feature_ready` event to the Harbor.
2.  **Agent B (Worktree 2):** A `pd watch` script smells the "pheromone" (the event). It immediately begins writing integration tests in its isolated worktree, mocking the API from Agent A.
3.  **Port Daddy:** Provides the stable, deterministic port (`myapp:api`) that remains constant even as Agent A restarts its service in a different directory.

## 4. Stigmergic Merging
Instead of a human manually merging 10 worktrees, we use **Pheromone Accumulation**.

1.  **Activity Snipping:** Agents "spray" metadata on semantic tokens in Port Daddy (e.g., `goal:refactor-auth`).
2.  **Confidence Weights:** As more agents (Coder, Reviewer, Tester) annotate the token with "SUCCESS" metadata, the pheromone concentration increases.
3.  **The Trigger:** A "Janitor Agent" watches the token graph. When the `confidence_scent` hits 0.95, it initiates a `git merge` of all involved worktrees into the main branch.

## 5. Architectural Synergy: WinDAGs + Port Daddy
| Feature | WinDAGs (Cognitive) | Port Daddy (Physical) |
| :--- | :--- | :--- |
| **Concurrency** | Parallel DAG Waves | Isolated Git Worktrees |
| **Identity** | Skill Signatures | Semantic Hashes (`proj:stack:ctx`) |
| **Communication** | Data-flow Edges | SSE Pub/Sub ("Radio Traffic") |
| **Safety** | Independent Evaluators | Formally Verified Arbiter |

## 6. Implementation Roadmap
1.  **Worktree-Harbor Binding:** Update `lib/harbors.ts` to allow pinning a Harbor to a specific set of `worktree_ids`.
2.  **Metadata Decay:** Implement a background "Evaporation" process in the daemon that slowly reduces the weight of stale metadata pheromones.
3.  **Visualizing the Swarm:** Update the `website-v2` dashboard to show agents swarming across different worktrees in real-time.
