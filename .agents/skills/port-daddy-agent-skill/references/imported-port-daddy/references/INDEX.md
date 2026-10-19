# Reference Index

Load only the file that matches the current blocking question. Do not read the entire reference tree by default.

| File | Topic | Lines | When to load | Grep hint |
|---|---|---:|---|---|
| `references/api-reference.md` | Current Port Daddy HTTP API reference | 1492 | Load when you need endpoint details or parity checks. | `rg -n "actors|advisor|coordination|spawn" references/api-reference.md` |
| `references/multi-agent-patterns.md` | Multi-agent coordination patterns with Port Daddy | 169 | Load when choosing claims, locks, notes, tuples, inboxes, or channels. | `rg -n "claim|lock|tuple|inbox|channel" references/multi-agent-patterns.md` |
| `references/portdaddyrc-spec.md` | `.portdaddyrc` specification | 172 | Load when configuring local project defaults. | `rg -n "budget|daemon|fallback|reserved" references/portdaddyrc-spec.md` |
| `references/sdk-reference.md` | Current Port Daddy JavaScript SDK reference | 500 | Load when writing SDK clients or checking helper names. | `rg -n "actors|advisor|sessions|fleet" references/sdk-reference.md` |
