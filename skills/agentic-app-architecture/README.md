# Agentic App Architecture

This bundle produces a five-axis design declaration and static consistency audit. It does not inspect an implementation, provider account, deployed policy, cache, or external effect.

1. Read `SKILL.md` and the three axis references.
2. Adapt `templates/output-template.md` or `examples/sample-input.json`.
3. Run `node scripts/agentic_app_audit.mjs --input spec.json`.
4. Treat a passing result as a coherent declaration, then plan separate implementation and evidence checks.

Requires Node.js; the auditor has no external package dependency. The JSON Schema describes baseline structure; the auditor also checks genuine calendar dates, HTTPS hosts, conditional MCP fields and applicable design controls. A zero CLI exit means a passing declaration; invalid/rejected declarations and malformed JSON exit nonzero.

Canonical preimage: commit `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`, directory `skills/agentic-app-architecture/`. Any original file is recoverable with `git show <commit>:skills/agentic-app-architecture/<relative-path>` in the Port Daddy repository. Campaign review retains a byte-exact source snapshot and per-file hashes outside the operative bundle.
