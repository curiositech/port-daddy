/**
 * whitepaper/textbook.schema.json, actually run against the data.
 *
 * The schema is the Book's declared contract: it is what `"$schema"` at the
 * top of whitepaper/textbook.json points at, what an editor reads to offer
 * completion, and what a reviewer is told the file conforms to. Until this
 * script existed, nothing in the repo ever fed one to the other. The schema
 * said `additionalProperties: false` and a typo'd key sailed through; it
 * declared `required` lists and a missing key sailed through. A schema
 * nothing validates is a comment with punctuation.
 *
 * `scripts/generate-mega-whitepaper.mjs` does validate the data, in
 * validateTextbook() — but by hand, field by field, and only the fields the
 * Book build happens to consume. The two are complementary and both are
 * wanted: validateTextbook knows the Book's semantics (a proving chapter must
 * come after the chapter it discharges), the schema knows the file's shape,
 * and each catches drift the other does not. Adding a key to textbook.json and
 * forgetting to declare it in the schema is precisely the drift only this
 * script sees.
 *
 * Dependency-free on purpose: this runs in the Library Checks job, which
 * installs no npm packages, so there is no ajv here. It implements the draft-07
 * subset textbook.schema.json actually uses and FAILS CLOSED on any keyword it
 * does not implement — a validator that silently skips the keyword carrying the
 * constraint is worse than no validator, because it reports success.
 *
 * It also asserts the uniqueness invariants JSON Schema draft-07 cannot state
 * at all: no vocabulary in it can say "every parts[].slug is distinct". Those
 * live here, next to the shape check, rather than only in the Book generator.
 *
 * Run: npm run check:textbook-schema
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SCHEMA = 'whitepaper/textbook.schema.json';
export const INSTANCES = [
  'whitepaper/textbook.json',
  // The site reads a byte-identical mirror written by
  // scripts/generate-mega-whitepaper.mjs --sync-shared. It is a separate file
  // on disk, so it is validated as one: "the mirror is identical" is a
  // different check (--check-shared), and this one must not lean on it.
  'website-v2/src/data/textbook.json',
];

/**
 * Keywords with no effect on validity. Listed rather than ignored wholesale so
 * that a keyword which DOES constrain something can never be mistaken for
 * annotation and skipped.
 */
const ANNOTATION_KEYWORDS = new Set([
  '$schema', '$id', '$comment', 'title', 'description', 'default', 'examples',
]);

const SUPPORTED_KEYWORDS = new Set([
  'type', 'properties', 'additionalProperties', 'required', 'items',
  'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern',
  'enum', 'const', 'minimum', 'maximum',
]);

const TYPE_OF = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object'
};

const matchesType = (value, type) => {
  const actual = TYPE_OF(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
};

/**
 * Validate `value` against `schema`, appending human-readable problems to
 * `errors`. `path` is a JSON-pointer-ish trail so a message names the field
 * rather than the file.
 *
 * Throws — rather than returning an error — when the schema itself uses a
 * keyword this validator does not implement. That is not invalid data; it is a
 * validator that would report success while measuring less than the schema
 * says, so it stops the run.
 */
export function validate(value, schema, errors = [], path = '', schemaPath = '#') {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword) && !ANNOTATION_KEYWORDS.has(keyword)) {
      throw new Error(
        `${SCHEMA}: ${schemaPath} uses "${keyword}", which ${'scripts/check-textbook-schema.mjs'}`
        + ' does not implement. Implement it (and test it) rather than letting the'
        + ' check pass over a constraint it cannot see.',
      );
    }
  }

  const at = path || '(root)';

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${at}: expected ${types.join(' or ')}, got ${TYPE_OF(value)}`);
      return errors; // Every other keyword below assumes the type matched.
    }
  }

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum !== undefined && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${at}: ${JSON.stringify(value)} does not match pattern ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: ${value} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: ${value} is above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: has ${value.length} items, minItems is ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${at}: has ${value.length} items, maxItems is ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      value.forEach((item, i) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${at}[${i}]: duplicate item ${key}`);
        seen.add(key);
      });
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => validate(item, schema.items, errors, `${path}[${i}]`, `${schemaPath}/items`));
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${at}: missing required property "${key}"`);
      }
    }
    const declared = schema.properties ?? {};
    for (const [key, sub] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(declared, key)) {
        validate(sub, declared[key], errors, path ? `${path}.${key}` : key, `${schemaPath}/properties/${key}`);
      } else if (schema.additionalProperties === false) {
        errors.push(
          `${at}: undeclared property "${key}" (additionalProperties is false in ${schemaPath})`,
        );
      } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
        validate(sub, schema.additionalProperties, errors, path ? `${path}.${key}` : key, `${schemaPath}/additionalProperties`);
      }
    }
  }

  return errors;
}

/**
 * The invariants no draft-07 vocabulary can express: a property whose value
 * must be distinct across the items of an array. `uniqueItems` compares whole
 * items, which is satisfied by two parts that differ only in their title while
 * sharing a slug — and two parts sharing a slug is the failure that collapses
 * `--part-<slug>` to one pair and silently repaints a part of the Book.
 *
 * These field names are the one place this file names a property of the data
 * rather than a keyword of the schema, and they are a deliberate list of what
 * must be distinct, not an inventory of what exists. So a field retired from
 * textbook.json is reported here rather than passed over: a rule that quietly
 * stops applying because the field it names is gone is a check reporting
 * success while measuring nothing, which is exactly what this script exists to
 * stop. Retiring a field means deleting its line below, in the same change.
 */
export function uniquenessErrors(textbook) {
  const errors = [];
  const unique = (items, label, field) => {
    const seen = new Map();
    let present = 0;
    (items ?? []).forEach((item, i) => {
      const value = item?.[field];
      if (value === undefined) return; // one absence is the required-keyword's business
      present += 1;
      const key = JSON.stringify(value);
      if (seen.has(key)) {
        errors.push(`${label}[${i}].${field}: ${key} is already used by ${label}[${seen.get(key)}]`);
      } else {
        seen.set(key, i);
      }
    });
    if ((items ?? []).length > 0 && present === 0) {
      errors.push(
        `${label}: nothing carries "${field}", but ${'scripts/check-textbook-schema.mjs'} still`
        + ` requires it to be unique across ${label}. If the field was retired, delete its`
        + ' uniqueness rule in the same change instead of leaving a rule that checks nothing.',
      );
    }
  };
  unique(textbook.parts, 'parts', 'id');
  // The web role layer derives var(--part-<slug>) straight from this field.
  unique(textbook.parts, 'parts', 'slug');
  unique(textbook.parts, 'parts', 'numeral');
  unique(textbook.chapters, 'chapters', 'id');
  unique(textbook.chapters, 'chapters', 'number');
  unique(textbook.chapters, 'chapters', 'prefix');
  return errors;
}

function main() {
  const schema = JSON.parse(readFileSync(resolve(repoRoot, SCHEMA), 'utf8'));
  const failures = [];
  for (const instance of INSTANCES) {
    const data = JSON.parse(readFileSync(resolve(repoRoot, instance), 'utf8'));
    for (const message of validate(data, schema)) failures.push(`${instance}: ${message}`);
    for (const message of uniquenessErrors(data)) failures.push(`${instance}: ${message}`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(
    `${SCHEMA} validates ${INSTANCES.length} instances`
    + ' (shape, patterns, required, additionalProperties, and cross-item uniqueness)',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
