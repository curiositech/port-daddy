import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { checkTsFile, checkRustFile, containsPhilosophy } from '../../scripts/check-rich-docs.mjs';

const TEMP_TS_FILE = join(import.meta.dirname, 'temp-doc-test.ts');
const TEMP_RS_FILE = join(import.meta.dirname, 'temp-doc-test.rs');

describe('Rich Docstring Checker', () => {
  afterEach(() => {
    try {
      unlinkSync(TEMP_TS_FILE);
    } catch {}
    try {
      unlinkSync(TEMP_RS_FILE);
    } catch {}
  });

  test('containsPhilosophy checks keywords correctly', () => {
    expect(containsPhilosophy('This is the design philosophy of the system.')).toBe(true);
    expect(containsPhilosophy('Motivation: why we built this.')).toBe(true);
    expect(containsPhilosophy('Standard description without keywords.')).toBe(false);
  });

  test('TS: detects correct JSDoc with motivation, params, and returns', () => {
    const code = `
      /**
       * Motivation: Explain the philosophy behind this module.
       *
       * @param value - The input value.
       * @returns The processed string.
       */
      export function processValue(value: number): string {
        return String(value);
      }
    `;
    writeFileSync(TEMP_TS_FILE, code, 'utf8');

    const errors = [];
    checkTsFile(TEMP_TS_FILE, errors);
    expect(errors).toEqual([]);
  });

  test('TS: flags missing docstring', () => {
    const code = `
      export function processValue(value: number): string {
        return String(value);
      }
    `;
    writeFileSync(TEMP_TS_FILE, code, 'utf8');

    const errors = [];
    checkTsFile(TEMP_TS_FILE, errors);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toContain('Missing JSDoc');
  });

  test('TS: flags missing philosophy keyword', () => {
    const code = `
      /**
       * Process the value and return it.
       *
       * @param value - The input value.
       * @returns The processed string.
       */
      export function processValue(value: number): string {
        return String(value);
      }
    `;
    writeFileSync(TEMP_TS_FILE, code, 'utf8');

    const errors = [];
    checkTsFile(TEMP_TS_FILE, errors);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toContain('does not discuss motivation, purpose, or philosophy');
  });

  test('Rust: detects correct rustdoc comment', () => {
    const code = `
      /// Motivation: the philosophy of this function.
      /// Input: value of the parameter.
      /// Output: returns processed value.
      pub fn process(value: i32) -> String {
          value.to_string()
      }
    `;
    writeFileSync(TEMP_RS_FILE, code, 'utf8');

    const errors = [];
    checkRustFile(TEMP_RS_FILE, errors);
    expect(errors).toEqual([]);
  });

  test('Rust: flags missing rustdoc', () => {
    const code = `
      pub fn process(value: i32) -> String {
          value.to_string()
      }
    `;
    writeFileSync(TEMP_RS_FILE, code, 'utf8');

    const errors = [];
    checkRustFile(TEMP_RS_FILE, errors);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toContain('Missing rustdoc');
  });
});
