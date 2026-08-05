import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from '@jest/globals';

const CLI_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../bin/port-daddy-cli.ts'),
  'utf8',
);

describe('relay CLI dispatch', () => {
  test('has one dispatch path and delegates it to the maintained handler', () => {
    const relayCases = [...CLI_SOURCE.matchAll(/^ {6}case 'relay':/gm)];

    expect(relayCases).toHaveLength(1);
    expect(CLI_SOURCE).toMatch(
      /case 'relay':\s+await handleRelay\(positional, options\);\s+break;/,
    );
  });
});
