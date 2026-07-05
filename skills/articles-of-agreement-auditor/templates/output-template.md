# Articles of Agreement Draft

Fill in every clause before signing. Validate the underlying claims with `node scripts/articles_audit.mjs --input <this-contract-as-json>.json` before treating the agent as compliant.

```markdown
## Identity

- Daemon-issued: <yes/no — was the Agent Node id minted by the daemon at agent.register, against a registrationNonce it issued first?>
- Signed: <yes/no — does an articlesSignature bind this identity to this exact Articles document?>

## Clauses

### <clause-name>

- Obligation: <plain-language statement of what the agent must do or refrain from doing>
- Enforcement mechanism: <pre-tool-gate | hook | capability-lease | mcp-gateway | probe | transcript-event | none>
- Daemon-observable: <yes/no — can the daemon independently confirm compliance/violation, not just trust the agent's report?>
- Denial shape (gate mechanisms only): <the concrete artifact a violation produces — error code, refused call, revoked lease>

<!-- repeat one block per clause: registration, transcript reporting, tool-use gating,
     file/symbol claims, parley conduct, budget/lease limits, operator control -->
```

## Checklist before signing

- [ ] `identity.daemonIssued` is true — the id came from `agent.register`, not a body-supplied string.
- [ ] `identity.signed` is true — an `articlesSignature` binds this identity to this exact contract.
- [ ] Every clause names a mechanism other than `none` (see `references/enforcement-mechanism-taxonomy.md`).
- [ ] Every clause is `daemonObservable: true` — the daemon can see it happen, not just be told it happened.
- [ ] Every gate-style clause (`pre-tool-gate`, `hook`, `capability-lease`, `mcp-gateway`) defines a `denialShape` naming the concrete rejection.
- [ ] No `denialShape` on a `probe` or `transcript-event` clause — passive mechanisms have nothing to deny.
- [ ] No duplicate clause names — each obligation maps to exactly one mechanism.
- [ ] `node scripts/articles_audit.mjs --input <contract>.json` returns `pass: true`.
