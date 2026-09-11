// Repository conformance test: Ajv is supplied by the repository lockfile.
// The standalone packet CLI and audit_reconciliation.test.mjs remain dependency-free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import schema from '../schemas/reconciliation-packet.schema.json' with { type: 'json' };
import sample from '../examples/sample-input.json' with { type: 'json' };
import { auditThing } from '../scripts/audit_reconciliation.mjs';

const Ajv = createRequire(import.meta.url)('ajv');
const accepts = new Ajv({ strict: true }).compile(schema);

function* leaves(rule, path = []) {
  if (rule.properties) {
    for (const [key, child] of Object.entries(rule.properties)) yield* leaves(child, [...path, key]);
  } else if (rule.items) {
    yield* leaves(rule.items, [...path, 0]);
  } else if (rule.type === 'string' || rule.type === 'integer') {
    yield [path, rule];
  }
}

for (const [path, rule] of leaves(schema)) {
  const values = rule.type === 'string'
    ? ['', ' ', '\t\n', '\u00a0', '\ufeff', 'x', ' x ', '🧭']
    : [-1, 0, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1];
  test(`schema parity: ${path.join('.')}`, () => {
    for (const value of values) {
      const packet = structuredClone(sample);
      const parent = path.slice(0, -1).reduce((object, key) => object[key], packet);
      parent[path.at(-1)] = value;
      // Keep semantic ID references valid: this suite compares shape, not policy.
      if (path.join('.') === 'evidence.0.id') packet.findings[0].evidenceIds = [value];
      if (path.join('.') === 'findings.0.evidenceIds.0') packet.evidence[0].id = value;
      if (path.join('.') === 'dissent.0.findingId') packet.findings[1].id = value;
      let acceptedShape = true;
      try { auditThing(packet); } catch (error) {
        assert.ok(error instanceof TypeError);
        acceptedShape = false;
      }
      assert.equal(acceptedShape, accepts(packet), `${JSON.stringify(value)}: ${JSON.stringify(accepts.errors)}`);
    }
  });
}
