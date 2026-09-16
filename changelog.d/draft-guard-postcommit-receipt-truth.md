type: fixed

- **Successful commits no longer appear blocked by their post-commit audit.** Coordination Guard identifies the existing commit, reports outstanding or unverifiable coordination findings separately, and explicitly says the read-only audit did not persist a note or receipt. Missing-note debt remains enforced before the next commit, including the full debt from multiple rewritten commits; post-commit audits no longer emit false commit-failure notifications.
