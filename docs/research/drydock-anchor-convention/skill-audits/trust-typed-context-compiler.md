# Skill audit — `trust-typed-context-compiler`

**Disposition:** new focused skill, accepted at version 1.0.0 for static context
compilation and continuation-fixture work. It cannot admit a body or grant a
capability.

## Gap that required a new skill

The old context-partitioning bundle mixed relevance optimization with birth and
handoff behavior. It lacked authority filters before ranking, enforceable
embedding-space identity, typed control/evidence channels, obligation coverage,
secret indirection, and explicit backend translation. A successor could
therefore receive plausible text that silently became instruction or authority.

## Steelman of the simpler approach

For a disposable assistant, a concise transcript summary plus tool list is
cheap and often useful. Semantic retrieval over one trusted corpus can be
enough. The extra type system is justified only when context crosses bodies,
backends, repositories, disclosure scopes, or consequential authority.

Drydock crosses all five boundaries. A continuation packet therefore needs
proof of what was included, omitted, translated, narrowed, and blocked.

## Red-team findings built into the replacement

- Tenant, repository, disclosure, retention, revocation, and audience authority
  filter candidates before lexical or dense ranking.
- Every vector carries a full immutable retrieval-space identity; incompatible
  spaces fail closed or require separately receipted re-embedding.
- Facts, attributed claims, historical intent, current guidance, secrets, and
  untrusted observations remain different trust classes.
- Secret material is represented by a scoped handle, never copied into the
  context capsule.
- Required obligations have coverage or explicit omission receipts.
- Backend changes emit `EXACT`, `EQUIVALENT`, `NARROWED`, `OMITTED`, or
  `BLOCKED` mappings for tools, MCPs, skills, hooks, prompts, and settings.
- A continuation nonce is single-use input to a separate lifecycle authority.
- Context confidence never becomes admission, capability, effect, or truth
  authority.

## Executed adversarial suite

The 17-case suite rejects cross-space comparison, rank-before-authority,
poisoned evidence promoted to guidance, raw secrets, missing obligations,
unreceipted omissions, widened backend permissions, hidden tool substitution,
double nonce use, identity inferred from a provider session, and a context
compiler attempting to fence or admit.

## Residual limits

This is `T0_STATIC`. It does not prove semantic completeness, manipulation
resistance, provider prompt behavior, privacy of a live retrieval service, or
safe resurrection. Human review and lifecycle receipts remain independent.
