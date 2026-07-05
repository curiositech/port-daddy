# Broker Migration Gap Report

Fill in every section before declaring a broker-collapse migration complete. Validate the underlying claims with `node scripts/broker_migration_audit.mjs --input <this-migration-as-json>.json` before publishing.

```markdown
## Legacy Verb Inventory

- Total legacy verbs accounted for: <n> (expected 19)
- Unmapped verbs: <list, or "none">
- Verbs on a forbidden (non intake-metadata/alias/doc-history) migration path: <list, or "none">

## Broker Tool Surface

- Tools present: <list> (expected exactly: work, act, ask, recall, status)
- Tools missing: <list, or "none">
- Extra/non-canonical tools: <list, or "none">
- Tools missing a denial shape or a transcript event: <list, or "none">

## Compliance Mode Gate

- Declared complianceMode: <C0-C6>
- emitsLegacyVerbCalls: <true|false>
- If C4+: proof of zero legacy-verb calls (transcript grep window + result): <evidence>

## Audit Result

- `node scripts/broker_migration_audit.mjs --input <spec>.json` → `pass`: <true|false>, `score`: <n>
- Remaining findings (if any): <list with severity + id>
```

## Checklist before declaring the migration complete

- [ ] All 19 legacy verbs have a non-null `mappedTo` that is exactly one of `work`/`act`/`ask`/`recall`/`status`.
- [ ] Every legacy verb's `migrationPath` is `intake-metadata`, `alias`, or `doc-history` — never a parallel runtime.
- [ ] The broker tool surface is exactly `work`/`act`/`ask`/`recall`/`status` — no bridge/shim/compat tool.
- [ ] Every one of the 5 tools declares both a denial shape and a transcript event.
- [ ] If `complianceMode` is `C4` or above, `emitsLegacyVerbCalls` is proven `false` from a transcript grep, not asserted from source-code intent.
- [ ] `broker_migration_audit.mjs` returns `pass: true`.
