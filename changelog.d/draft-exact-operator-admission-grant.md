type: added

- **Operators can admit one exact recovery worker without weakening identity policy.** `pd actor admission grant` records a short-lived, one-shot daemon grant bound to the requested identity, canonical linked worktree, branch, normalized remote, exact HEAD/base, and roadmap; `pd begin --admission-grant` revalidates that tuple, atomically commits grant use, actor mint, and session admission, records durable issue/reject/expiry/consume receipts, leaves `newcomer_pool` byte-for-byte untouched, and never prints or shell-exports the minted credential.
