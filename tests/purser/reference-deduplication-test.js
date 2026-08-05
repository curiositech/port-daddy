const assert = require('assert');
const { collateReferences, referenceFingerprint } = require('../../scripts/generate-mega-whitepaper');

// Test reference deduplication
const references = [
  { body: '\bibitem{doi:10.1234/abc}', key: 'ref1' },
  { body: '\bibitem{doi:10.1234/abc}', key: 'ref2' }
];

const prepared = [{ references }];
const canonical = collateReferences(prepared);

assert.strictEqual(canonical.length, 1, 'References should be deduplicated');
assert.strictEqual(canonical[0].key, 'mega001', 'Should have correct key');

// Test normalized fingerprint
const normalized = referenceFingerprint({ body: '\bibitem{doi:10.1234/abc}' });
assert.strictEqual(normalized, 'doi:10.1234/abc', 'Fingerprint should match DOI');