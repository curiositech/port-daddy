# Work intake node shaping

Use the [skill](SKILL.md) to make a reasoned local topology decision and audit
supplied current-route evidence. This offline auditor compiles its bundled
Draft 2020 schema with a consumer-provided Ajv 8 `ajv/dist/2020` dependency;
see [schema enforcement](references/schema-enforcement.md). Run the tests and
example with that normal dependency resolution available:

```sh
node --test tests/node_shaping_audit.test.mjs
node scripts/node_shaping_audit.mjs --input examples/sample-input.json
```

`pass` means the declaration is coherent. `eligibleToAdmit` also requires any
required approval, authority, and resources; a non-eligible CLI result exits
nonzero. Neither result proves runtime behavior.
