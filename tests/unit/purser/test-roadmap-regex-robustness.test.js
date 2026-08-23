We need to create a new test file tests/unit/purser/test-roadmap-regex-robustness.test.js. It should validate regex patterns against reworded phrases, synonyms, and edge-case phrasing. It must grill the contract above. The PR fixes tests to use regex patterns; this new test should ensure that the regex patterns are robust enough to match reworded phrases. It should test that the regex patterns defined in test-roadmap-markdown.js and test-whitepaper-section.js still match after rewording. Also maybe test that the regex patterns don't match unintended content.

We need to import the regex patterns from those files? They are defined inside tests, but not exported. We could duplicate them or import the test files? But test files are not modules. However we can import the modules that contain the regex patterns? In test-roadmap-markdown.js, the regex patterns are defined in that file but not exported. So we can't import. But we can replicate the patterns in our test file. We need to test that the regex patterns match the content after rewording. But the content is in docs files: docs/recovery/UNIFIED-ROADMAP.md and docs/roadmap/whitepaper-research-program.md. We can load them, simulate reworded phrases? The test should verify that the regex patterns still match after rewording. We can apply some rewording transformations to the content and then test.

Specifically, we need to test:

- Implementation priorities regex array in test-roadmap-markdown.js: ensures each priority regex matches the section after rewording.

- Release exit evidence regex array: ensures each evidence regex matches the section after rewording.

- Receipt clauses array in test-whitepaper-section.js: ensures each bullet matches exactly one bullet.

- Non-receipt evidence regex array: ensures each evidence regex matches the section after rewording.

Also we should test that the regex patterns don't match unintended content: e.g., they should not match other parts of the docs.

Edge-case phrasing: synonyms, case-insensitive, whitespace variations, punctuation.

We need to read the docs files. Let's inspect the docs: docs/recovery/UNIFIED-ROADMAP.md and docs/roadmap/whitepaper-research-program.md. But we don't have actual content; we need to assume content. But we can import them as strings.

We need to write tests that load the markdown files, maybe apply some rewording transformations: e.g., replace "sealed relay" with "sealed cross-harbor relay" and "federated revocation" with "witness-log revocation". Also maybe replace "custody/settlement conformance" with "custody and settlement conformance". Also maybe change "source commit" phrase.

The test should apply these rewordings to the content and test that regex patterns still match.

Also test that the regex patterns don't match unintended content: e.g., they shouldn't match the same phrase in other sections. But we can test that the regex patterns are not too greedy.

Simplify: For each regex pattern, test that it matches the content after rewording. Also test that it matches a minimal string that contains the term. Also test that it doesn't match a string that doesn't contain the term.

Also test that the regex patterns are case-insensitive and allow whitespace variations.

Edge-case: punctuation, newline.

Also test that the regex patterns are anchored? They are not anchored; they use /iu. For example, /reputation-grade/iu matches "reputation-grade outcome ledger". That is fine.

We need to test the new test file itself.

Let's design test file:

- Import fs, path, maybe import the content.

- Define the regex patterns arrays.

- For each pattern, create a test that ensures pattern.test(content) is true after rewording.

- Also test that pattern.test('something else') returns false.

- For receipt clauses, we need to extract bullets from whitepaper section. We'll load the markdown, find the section "whitepaper publication receipt contract" maybe by heading "### ...". Use similar logic as test-whitepaper-section.js but we can replicate minimal logic.

- Then for each clause, test that exactly one bullet matches all terms.

- Additionally test that bullet count > 0.

- For non-receipt evidence, test that each evidence regex matches the section.

- Edge-case: use synonyms: e.g., "route" synonyms: "path", "link". But the regex is /route/iu, so it will match "route" but not "path". So test that it doesn't match "path".

- Also test whitespace variations: pattern /reputation-grade/iu should match "reputation‑grade" (with non-breaking hyphen). We can test that.

- Also test punctuation: pattern /source commit/iu should match "source-commit" or "source commit". But the regex is /source commit/iu, so it expects a space. So we can test that "source-commit" doesn't match.

Thus we can write tests accordingly.

Also test that regex patterns are not too broad: e.g., /revocation/iu matches "revocation" but not "revoke". But we can test that "revoke" does not match.

Also test that /sel*ed? relay/iu? Wait the pattern is /sealed[\w\s-]*relay/iu, which matches "sealed relay", "sealed cross-harbor relay", "sealed   relay", etc. So test that it matches "sealed cross-harbor relay" and "sealed relay" and "sealed   relay" and does not match "sealed relays" or "seal relay".

Also test that /actor[\s-]identity/iu matches "actor-identity" and "actor identity" but not "actoridentity".

Also test that /checkpoints/iu matches "execution-state checkpoints" but not "checkpoint".

Also test that /reputation-grade/iu matches "reputation-grade" but not "reputation grade".

Also test that /custody[\s/]*(?:and\s+)?settlement/iu matches "custody/settlement", "custody settlement", "custody and settlement".

Also test that /projection[\s-]consistency/iu matches "projection consistency", "projection-consistency", "projection consistency".

Edge-case: punctuation after term: e.g., "custody/settlement conformance" includes "conformance". The regex doesn't check for conformance. But we can test that the pattern matches "custody/settlement conformance".

Also test for release exit evidence patterns: /library route/iu, /page count/iu, /hash/iu, /source commit/iu. They should match strings like "live library route" and "production PDF hash and page count" and "source commit". They should not match "hashing" or "page counter".

Also for receipt clauses: terms include /route/iu, /page count/iu, /byte count/iu, /SHA-256/iu. So test that bullet "mega-volume route, page count, byte count, and SHA-256 digest" matches all terms. Also test that bullet "route and SHA-256 digest of each of the seven standalone papers" matches terms /route/iu, /SHA-256/iu, /standalone/iu. So test that.

Also test that /deployment identifier/iu and /verification timestamp/iu match bullet containing both terms.

Also test that each bullet is matched exactly once.

Also test that non-receipt evidence patterns /preview/iu, /local build/iu, /CI artifact/iu match the section.

Also test that they don't match bullet that is receipt bullet.

Also we need to test that regex patterns are robust to whitespace variations: e.g., "live   library   route" matches /library route/iu.

Also test that regex patterns are case-insensitive: "Live Library Route" matches.

Also test that /SHA-256/iu matches "SHA-256" but not "sha-256" (case-insensitive will match anyway). But we can test that it's case-insensitive.

Also test that /hash/iu matches "hash" but not "hashing".

Edge-case: hyphen vs en dash: "reputation‑grade" with en-dash. The regex /reputation-grade/iu might not match en-dash. But we can test that it doesn't match and maybe adjust but we just test that it doesn't.

But we can just test that it matches hyphen.

Also test that /reputation grade/iu does not match "reputation-grade" because missing space.

Ok.

Also test that regex patterns are not too broad: e.g., /revocation/iu matches "revocation" but not "revoke".

Also test that /actor[\s-]identity/iu matches "actor-identity" but not "actoridentity".

Ok.

Now, we need to create test file that runs with Jest. Use describe/test.

We need to import fs and path. Use import syntax (ESM). The repo uses type=module. So we should use import fs from 'node:fs/promises'? But we can use require? In ESM, we can use import fs from 'node:fs/promises' or import { readFileSync } from 'node:fs'. Since we need sync reading for tests, we can use readFileSync.

Let's use import { readFileSync } from 'node:fs'; import { join } from 'node:path';.

Also we need to use assert? The repo uses node assert. We can use import assert from 'node:assert';.

We need to import the regex patterns. We'll just define them in this test file.

We need to load the markdown files: docs/recovery/UNIFIED-ROADMAP.md and docs/roadmap/whitepaper-research-program.md. Use relative path from tests/unit/purser. The test file is at tests/unit/purser/test-roadmap-regex-robustness.test.js. The docs files are at docs/recovery/UNIFIED-ROADMAP.md and docs/roadmap/whitepaper-research-program.md. So relative path from test file: ../../docs/... Actually path: tests/unit/purser/.. -> tests/unit -> up one to tests, up one to root. So path join(__dirname, '..', '..', 'docs', 'recovery', 'UNIFIED-ROADMAP.md'). But __dirname is not defined in ESM. We can use import.meta.url to get file URL. Use new URL('..', import.meta.url). But easier: use import { fileURLToPath } from 'node:url'; const __filename = fileURLToPath(import.meta.url); const __dirname = path.dirname(__filename);.

Ok.

Now we need to read the content. Use readFileSync.

Then we need to apply rewording transformations: For roadmap markdown, replace "sealed relay" with "sealed cross-harbor relay", "federated revocation" with "witness-log revocation", "custody/settlement conformance" with "custody and settlement conformance", maybe also replace "source commit" with "source commit" (it's same). But we need to test rewording. So we need to create a mutated version of the content.

But the test file should not modify the original file. So we can create a string mutatedContent = originalContent.replace(...). Then use that for tests.

Similarly for whitepaper section, maybe replace "landed source commit and volume edition" with "the volume edition and the source commit it landed from" etc. But we can just test that the regex patterns still match the original content. Actually the test should test after rewording. So we need to create mutated content for both docs.

We can apply simple replacements: For roadmap: 
- replace 'sealed relay' with 'sealed cross-harbor relay'
- replace 'federated revocation' with 'witness-log revocation'
- replace 'custody/settlement conformance' with 'custody and settlement conformance'
- replace 'source commit' with 'source commit' (no change)
- maybe also replace 'live library route' with 'live   library   route' (extra spaces)
- replace 'production PDF hash and page count' with 'production PDF hash, page count' (commas)
- replace 'standalone artifact hashes' with 'standalone artifact hashes' (no change)
- replace 'source commit' etc.

But we can just do the key ones.

For whitepaper: 
- replace 'landed source commit and volume edition' with 'the volume edition and the source commit it landed from'
- replace 'mega-volume route, page count, byte count, and SHA-256 digest' with 'mega-volume route, page count, byte count, and SHA-256 digest' (no change)
- replace 'route and SHA-256 digest of each of the seven standalone papers' with 'route and SHA-256 digest of each of the seven standalone papers' (no change)
- replace 'production library deployment identifier and verification timestamp' with 'production library deployment identifier and verification timestamp' (no change)
- replace 'preview URL, local build, or CI artifact is evidence for the release, but is not the release receipt' with something else? But we can just keep.

Ok.

Now tests:

- For roadmap: check each priority regex matches mutated content. Also check each evidence regex matches mutated content.

- For whitepaper: extract bullets from section: find heading "### whitepaper publication receipt contract" maybe. But we need to find the section. The original test uses heading = '### whitepaper publication receipt contract'. So we can use same heading string.

- Extract bullets: split by '\n', filter lines starting with '- '. Then trim whitespace.

- For each clause, find matching bullets: bullet.filter(term => term.test(bullet)). Then assert exactly one bullet.

- For non-receipt evidence: ensure each evidence regex matches the section (mutated content). Also ensure they don't match any receipt bullet.

- Also test that regex patterns don't match unintended content: e.g., for each regex, test that it does not match a string that does not contain the term. For example, /reputation-grade/iu should not match 'reputation grade' (space). /actor[\s-]identity/iu should not match 'actoridentity' (no separator). /checkpoints/iu should not match 'checkpoint'. /sealed[\w\s-]*relay/iu should not match 'sealed relays' or 'seal relay'. /revocation/iu should not match 'revoke'. /custody[\s/]*(?:and\s+)?settlement/iu should not match 'custodysettlement'. /projection[\s-]consistency/iu should not match 'projectionconsistency'. /library route/iu should not match 'library routes'. /page count/iu should not match 'page counter'. /hash/iu should not match 'hashing'. /source commit/iu should not match 'source-commit'. /route/iu should not match 'path'. /byte count/iu should not match 'byte counting'. /SHA-256/iu should not match 'SHA256' (no hyphen). /deployment identifier/iu should not match 'deployment-id'. /verification timestamp/iu should not match 'verification time stamp'. /preview/iu should not match 'previews'. /local build/iu should not match 'local builder'. /CI artifact/iu should not match 'CI artifacts'. This tests that regex are precise.

Also test that regex patterns are case-insensitive: test that uppercase matches.

Also test whitespace variations: For /sealed[\w\s-]*relay/iu, test that "sealed   relay" matches.

Also test punctuation: For /hash/iu, test that "hash," matches.

Also test hyphen vs en-dash: we can test that en-dash is not matched; but not required.

Ok.

Write tests accordingly.

Also test that mutated content still contains the same number of bullets for receipt clauses.

Also test that the regex patterns cover all clauses.

Also test that the regex patterns are not too broad: e.g., /source commit/iu matches "source commit" but not "source-commit".

Ok.

Now implement.

We'll import { readFileSync } from 'node:fs'; import { join } from 'node:path'; import assert from 'node:assert'; import { fileURLToPath } from 'node:url';

Define __filename and __dirname.

Load roadmap content: const roadmapPath = join(__dirname, '..', '..', 'docs', 'recovery', 'UNIFIED-ROADMAP.md'); const roadmapContent = readFileSync(roadmapPath, 'utf8');

Mutate: const mutatedRoadmap = roadmapContent.replace('sealed relay', 'sealed cross-harbor relay').replace('federated revocation', 'witness-log revocation').replace('custody/settlement conformance', 'custody and settlement conformance').replace('live library route', 'live   library   route').replace('production PDF hash and page count', 'production PDF hash, page count').replace('source commit', 'source commit'); // maybe.

Similarly load whitepaper content: const whitepaperPath = join(__dirname, '..', '..', 'docs', 'roadmap', 'whitepaper-research-program.md'); const whitepaperContent = readFileSync(whitepaperPath, 'utf8'); Mutate: const mutatedWhitepaper = whitepaperContent.replace('landed source commit and volume edition', 'the volume edition and the source commit it landed from'); // maybe other replacements.

Now define regex arrays:

const IMPLEMENTATION_PRIORITIES = [... same as test-roadmap-markdown.js];

const RELEASE_EXIT_EVIDENCE = [... same as test-roadmap-markdown.js];

const RECEIPT_CLAUSES = [... same as test-whitepaper-section.js];

const NON_RECEIPT_EVIDENCE = [... same as test-whitepaper-section.js];

Now tests.

describe('Roadmap regex robustness', () => {
  it('priorities match mutated roadmap', () => {
    for (const regex of IMPLEMENTATION_PRIORITIES) {
      assert.match(mutatedRoadmap, regex, `priority regex ${regex} should match mutated roadmap`);
    }
  });

  it('exit evidence match mutated roadmap', () => {
    for (const regex of RELEASE_EXIT_EVIDENCE) {
      assert.match(mutatedRoadmap, regex, `exit evidence regex ${regex} should match mutated roadmap`);
    }
  });

  it('non-ambiguous matching: each regex matches only intended content', () => {
    // tests for each regex not matching unintended strings
    const tests = [
      { regex: /reputation-grade/iu, good: 'reputation-grade', bad: 'reputation grade' },
      { regex: /actor[\s-]identity/iu, good: 'actor-identity', bad: 'actoridentity' },
      { regex: /checkpoints/iu, good: 'execution-state checkpoints', bad: 'checkpoint' },
      { regex: /sealed[\w\s-]*relay/iu, good: 'sealed   relay', bad: 'sealed relays' },
      { regex: /revocation/iu, good: 'revocation', bad: 'revoke' },
      { regex: /custody[\s/]*(?:and\s+)?settlement/iu, good: 'custody/settlement', bad: 'custodysettlement' },
      { regex: /projection[\s-]consistency/iu, good: 'projection consistency', bad: 'projectionconsistency' },
      { regex: /library route/iu, good: 'live