# Stigmergic Backlog: Undone Ideas & Future Harvests

This document tracks high-fidelity ideas from the "Parallel Universes" (worktrees) and our own brainstorming that haven't been implemented yet.

## 1. Physical Layer: The Worktree Reaper
**Concept:** Automatically prune isolated agent worktrees to prevent disk waste.
*   **Trigger:** Session marked `completed` or `abandoned`.
*   **Action:** `git worktree remove --force <path>`.
*   **Why:** Concurrency requires isolation, but isolation shouldn't be permanent.

## 2. Biological Layer: Pheromone Evaporation
**Concept:** Metadata traces that fade over time to guide agent swarming.
*   **Status:** Logic implemented in `lib/pheromone.ts`, integrated into `server.ts`.
*   **TODO:** Add CLI command `pd pheromone spray <token> <value>` and `pd pheromone sniff`.
*   **ADHD Note:** Needs a satisfying "Scent" visualization in the dashboard.

## 3. Cognitive Layer: WinDAGs Bridge
**Concept:** Map WinDAGs abstract nodes to Port Daddy physical Harbors.
*   **Action:** Automatically create a Harbor for every WinDAGs execution ID.
*   **Security:** Use the Arbiter to revoke Harbor Cards if WinDAGs evaluation fails.

## 4. Marketing Layer: The Asciinema Engine
**Concept:** High-fidelity terminal demos that show multi-agent coordination.
*   **Status:** `pd demo` command and `.tape` files created in `demos/`.
*   **TODO:** Record and render these into dual-theme (Light/Dark) GIFs for the landing page.

## 5. Deployment Layer: Homebrew & Binary
**Concept:** Move away from `npm install -g`.
*   **Status:** `Formula/port-daddy.rb` created.
*   **TODO:** Automate SHA-256 updates in the release pipeline.
*   **Binary:** Package the Rust Core + TS Daemon into a single signed binary using `pkg`.

---
*Stay hungry, stay stigmergic.*
