type: fixed

- **Briefings keep linked worktrees in their configured project.** Detection uses the physical Git worktree root, including nested directories, instead of mistaking the linked worktree's folder name for its project. CLI JSON and MCP reads use the same read-only HTTP contract; explicit project names, including `auto`, remain literal. Root-local configuration does not inherit another repository's parent or symlinked config.
