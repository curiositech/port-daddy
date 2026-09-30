import { describe, expect, it } from 'vitest';
import { preservesHarnessContract } from '../src/purser-harness-repair.js';

const file = (contents: string) => [{ path: 'tests/unit/widget.test.ts', contents }];
const body = 'it("rejects negatives", () => expect(() => widget(-1)).toThrow("negative"));';
const original = file('import { widget } from "../../wrong.ts";\n' + body);

describe('execution repair cannot dilute the contract', () => {
  it('permits a module location correction without changing any assertion', () => {
    expect(preservesHarnessContract(original, file('import { widget } from "../../right.ts";\n' + body))).toBe(true);
    expect(preservesHarnessContract(file('const { widget } = require("a");' + body), file('const { widget } = require("b");' + body))).toBe(true);
  });
  it.each([
    'it.skip("rejects negatives", () => expect(() => widget(-1)).toThrow("negative"));',
    'it("rejects negatives", () => expect(true).toBe(true));',
    'it("rejects negatives", () => {});',
    'beforeEach(() => jest.resetAllMocks());' + body,
    body + 'it.only("other", () => {});',
  ])('rejects changed cases, skips, helpers, hooks or assertions: %s', changed => {
    expect(preservesHarnessContract(original, file('import { widget } from "../../right.ts";\n' + changed))).toBe(false);
  });
  it('rejects missing, moved, duplicated and unparsable files', () => {
    expect(preservesHarnessContract(original, [])).toBe(false);
    expect(preservesHarnessContract(original, [{ ...original[0], path: 'tests/other.ts' }])).toBe(false);
    expect(preservesHarnessContract(original, [...original, ...original])).toBe(false);
    expect(preservesHarnessContract(original, file('it('))).toBe(false);
  });
});
