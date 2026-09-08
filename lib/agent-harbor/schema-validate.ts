/**
 * Agent Harbor C2 — runtime validation against the frozen F0 v0 JSON Schemas.
 *
 * The contract package (schemas/agent-harbor/v0/, ADR-0095) is language-neutral
 * JSON Schema, deliberately restricted to a draft-2020-12 keyword subset so a
 * small fail-closed validator covers it (same subset as
 * tests/unit/agent-harbor-contracts.test.js). This module is the runtime twin:
 * the probe engine and cost ledger validate every object they emit before
 * handing it to a caller, so C2 cannot silently drift off the F0 shapes.
 *
 * Tolerant reader: additionalProperties: true everywhere in v0, so unknown
 * fields pass. Fail-closed compiler: an unknown validation keyword in a schema
 * throws instead of silently not validating.
 *
 * The npm package ships schemas/ (package.json "files" — added with this
 * module), while the compiled entrypoint registers the same frozen contracts
 * in an embedded table. Filesystem schemas win when present; the table keeps
 * fail-closed validation intact after relocation into Homebrew or FleetBar.
 * The { skipped: true } path remains for genuinely trimmed/broken runtimes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

type JsonSchema = Record<string, unknown>;

const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples']);
const VALIDATION_KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'minLength', 'maxLength', 'minimum', 'maximum',
  'minItems', 'maxItems', 'pattern',
]);

/** Throws if the schema uses any keyword this validator does not implement. */
function compile(schema: unknown, path = '#'): JsonSchema {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`${path}: schema must be an object`);
  }
  const s = schema as JsonSchema;
  for (const key of Object.keys(s)) {
    if (ANNOTATION_KEYWORDS.has(key) || VALIDATION_KEYWORDS.has(key)) continue;
    throw new Error(`${path}: unsupported keyword "${key}" — extend the validator or simplify the schema`);
  }
  if (s.properties) {
    for (const [prop, sub] of Object.entries(s.properties as Record<string, unknown>)) {
      compile(sub, `${path}/properties/${prop}`);
    }
  }
  if (s.items) compile(s.items, `${path}/items`);
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') {
    compile(s.additionalProperties, `${path}/additionalProperties`);
  }
  return s;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(declared: unknown, actual: string): boolean {
  const list = Array.isArray(declared) ? declared : [declared];
  return list.some((t) => t === actual || (t === 'number' && actual === 'integer'));
}

function validateNode(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return;
  }
  if (schema.enum !== undefined && !(schema.enum as unknown[]).some((e) => e === value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    return;
  }
  if (schema.type !== undefined && !typeMatches(schema.type, typeOf(value))) {
    errors.push(`${path}: expected type ${JSON.stringify(schema.type)}, got ${typeOf(value)}`);
    return;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: string longer than maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: string does not match pattern ${schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: ${value} below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: ${value} above maximum ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validateNode(schema.items as JsonSchema, item, `${path}/${i}`, errors));
    }
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    // JSON semantics: a key holding `undefined` disappears on serialization,
    // so it is treated as absent here too.
    for (const req of (schema.required ?? []) as string[]) {
      if (!(req in obj) || obj[req] === undefined) errors.push(`${path}: missing required property "${req}"`);
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj && obj[key] !== undefined) validateNode(sub, obj[key], `${path}/${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props) && obj[key] !== undefined) errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }
}

export interface SchemaValidationResult {
  valid: boolean;
  /** True when the schema file could not be located (installed env without schemas/). */
  skipped: boolean;
  errors: string[];
  schemaPath?: string;
}

const schemaCache = new Map<string, JsonSchema | null>();

type EmbeddedSchemaGlobal = typeof globalThis & {
  __PORT_DADDY_EMBEDDED_AGENT_HARBOR_SCHEMAS__?: Readonly<Record<string, unknown>>;
};

function embeddedSchema(name: string): unknown | null {
  const table = (globalThis as EmbeddedSchemaGlobal)
    .__PORT_DADDY_EMBEDDED_AGENT_HARBOR_SCHEMAS__;
  return table && Object.hasOwn(table, name) ? table[name] : null;
}

/** Candidate roots for schemas/agent-harbor/v0/ (repo layouts + env override). */
function candidateSchemaDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PORT_DADDY_SCHEMA_DIR,
    join(here, '..', '..', 'schemas', 'agent-harbor', 'v0'),
    join(here, '..', '..', '..', 'schemas', 'agent-harbor', 'v0'),
    join(process.cwd(), 'schemas', 'agent-harbor', 'v0'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return candidates;
}

/** Load and compile a frozen v0 schema by name (e.g. "compliance-probe-result"). */
export function loadFrozenSchema(name: string): { schema: JsonSchema; path: string } | null {
  const cacheKey = name;
  if (schemaCache.has(cacheKey)) {
    const cached = schemaCache.get(cacheKey);
    return cached ? { schema: cached, path: (cached.__loadedFrom as string) ?? '' } : null;
  }
  for (const dir of candidateSchemaDirs()) {
    const file = join(dir, `${name}.schema.json`);
    if (existsSync(file)) {
      const schema = compile(JSON.parse(readFileSync(file, 'utf8')));
      schema.__loadedFrom = file;
      schemaCache.set(cacheKey, schema);
      return { schema, path: file };
    }
  }
  const embedded = embeddedSchema(name);
  if (embedded) {
    // __loadedFrom is validator metadata, not part of the frozen contract.
    const schema = compile(JSON.parse(JSON.stringify(embedded)));
    const path = `embedded:schemas/agent-harbor/v0/${name}.schema.json`;
    schema.__loadedFrom = path;
    schemaCache.set(cacheKey, schema);
    return { schema, path };
  }
  schemaCache.set(cacheKey, null);
  return null;
}

/**
 * Validate an instance against a frozen v0 schema. Fail-closed on shape errors
 * when the schema is present; honest { skipped: true } when it is not.
 */
export function validateAgainstSchema(name: string, instance: unknown): SchemaValidationResult {
  const loaded = loadFrozenSchema(name);
  if (!loaded) return { valid: true, skipped: true, errors: [] };
  const errors: string[] = [];
  const { __loadedFrom, ...schema } = loaded.schema;
  validateNode(schema as JsonSchema, instance, '#', errors);
  return { valid: errors.length === 0, skipped: false, errors, schemaPath: loaded.path };
}

/** Validate and throw on failure — for emit paths that must never ship drifted shapes. */
export function assertAgainstSchema(name: string, instance: unknown): void {
  const result = validateAgainstSchema(name, instance);
  if (!result.valid) {
    throw new Error(`agent-harbor v0 contract violation (${name}): ${result.errors.join('; ')}`);
  }
}
