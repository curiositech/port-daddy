type: fixed

- Coordination preflight recognizes equivalent relative and absolute file claims only inside the exact repository and worktree. Mismatched session roots or stored claim worlds now expose preserved claim evidence as a critical context inconsistency instead of incorrectly saying files are unclaimed. Traversal and symlink escapes cannot borrow another project's claims; symbol and range selectors stay intact.
