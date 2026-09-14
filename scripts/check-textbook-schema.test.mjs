/**
 * The schema checker, checked.
 *
 * A validator is only worth the mutations it rejects, so every test here
 * breaks one thing the schema is supposed to forbid and asserts the message
 * names it. The two that matter most are the ones the checker found the day it
 * was written and that nothing had ever found before: an undeclared property
 * under `additionalProperties: false`, and a `pattern` the committed data does
 * not match.
 *
 * The last test is the checker's own fail-closed rule: a schema keyword this
 * validator does not implement must stop the run, not be passed over. A
 * validator that skips the keyword carrying the constraint reports success
 * while measuring less than the schema says.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { INSTANCES, SCHEMA, uniquenessErrors, validate } from './check-textbook-schema.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(resolve(repoRoot, p), 'utf8'));

const schema = readJson(SCHEMA);
const pristine = () => readJson(INSTANCES[0]);

const only = (errors, needle) => {
  const hit = errors.filter((e) => e.includes(needle));
  assert.ok(
    hit.length > 0,
    `expected an error mentioning ${JSON.stringify(needle)}, got:\n  ${errors.join('\n  ') || '(none)'}`,
  );
  return hit;
};

test('the committed textbook data validates against its own schema', () => {
  for (const instance of INSTANCES) {
    assert.deepEqual(validate(readJson(instance), schema), [], instance);
    assert.deepEqual(uniquenessErrors(readJson(instance)), [], instance);
  }
});

test('an undeclared property is rejected, and named', () => {
  const data = pristine();
  data.chapters[0].summary = 'a site-only field nobody declared';
  const errors = validate(data, schema);
  only(errors, 'undeclared property "summary"');
  only(errors, 'chapters[0]');
});

test('a value that does not match its pattern is rejected, and the pattern shown', () => {
  const data = pristine();
  data.parts[0].color = 'cobalt';
  only(validate(data, schema), 'does not match pattern ^pd[a-z]+$');
});

test('a missing required property is rejected by name', () => {
  const data = pristine();
  delete data.parts[0].webRoleAlias;
  only(validate(data, schema), 'missing required property "webRoleAlias"');
});

test('a webRoleAlias side that is not a custom-property name is rejected', () => {
  const data = pristine();
  data.parts[0].webRoleAlias.bg = '#4a6cf7';
  only(validate(data, schema), 'does not match pattern');
});

test('a wrong type is rejected before any other keyword is applied to it', () => {
  const data = pristine();
  data.chapters[0].number = 'one';
  const errors = validate(data, schema);
  only(errors, 'expected integer, got string');
  // `minimum` must not also fire: 'one' < 1 is false in JS and would have
  // silently passed a numeric bound applied to a string.
  assert.equal(errors.filter((e) => e.includes('below minimum')).length, 0);
});

test('an empty array where minItems is 1 is rejected', () => {
  const data = pristine();
  data.parts[0].chapters = [];
  only(validate(data, schema), 'minItems is 1');
});

test('an empty string where minLength is 1 is rejected', () => {
  const data = pristine();
  data.edition.title = '';
  only(validate(data, schema), 'shorter than minLength 1');
});

test('the one empty formerNumeral the generator accepts is not rejected', () => {
  const data = pristine();
  data.chapters[0].formerNumeral = '';
  assert.deepEqual(validate(data, schema), []);
  // ...but the pattern still has to mean something.
  data.chapters[0].formerNumeral = 'IIx';
  only(validate(data, schema), 'does not match pattern');
});

test('two parts sharing a slug is rejected, which no draft-07 keyword can say', () => {
  const data = pristine();
  data.parts[3].slug = data.parts[2].slug;
  // The shape check cannot see it: each part is individually valid.
  assert.deepEqual(validate(data, schema), []);
  only(uniquenessErrors(data), 'parts[3].slug');
});

test('uniqueItems does not substitute for it: parts differing elsewhere still collide', () => {
  const data = pristine();
  data.parts[3].slug = data.parts[2].slug;
  assert.notEqual(JSON.stringify(data.parts[2]), JSON.stringify(data.parts[3]));
  only(uniquenessErrors(data), 'is already used by parts[2]');
});

test('duplicate chapter ids and duplicate chapter numbers are both rejected', () => {
  const dupeId = pristine();
  dupeId.chapters[1].id = dupeId.chapters[0].id;
  only(uniquenessErrors(dupeId), 'chapters[1].id');

  const dupeNumber = pristine();
  dupeNumber.chapters[1].number = dupeNumber.chapters[0].number;
  only(uniquenessErrors(dupeNumber), 'chapters[1].number');
});

test('a uniqueness rule whose field has left the data is reported, not passed over', () => {
  const data = pristine();
  for (const part of data.parts) delete part.numeral;
  // The rule now has nothing to compare, which is the shape a check takes on
  // the day the field it guards is retired on another branch. It must say so.
  only(uniquenessErrors(data), 'nothing carries "numeral"');
});

test('a schema keyword the validator does not implement stops the run', () => {
  assert.throws(
    () => validate({ a: 1 }, { type: 'object', properties: { a: { type: 'integer', multipleOf: 2 } } }),
    /does not implement/,
    'an unimplemented keyword must fail closed, never be skipped as if satisfied',
  );
});

test('annotation keywords are not mistaken for constraints and do not fail closed', () => {
  assert.deepEqual(
    validate('x', { $comment: 'why', title: 'T', description: 'D', default: 'y', examples: ['z'], type: 'string' }),
    [],
  );
});
