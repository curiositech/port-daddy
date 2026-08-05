import assert from 'node:assert/strict';
import { test } from 'node:test';
import { namespaceChapterSyntax } from '../../scripts/generate-mega-whitepaper.mjs';

test('namespaces chapter environments correctly', () => {
  const input = '\\begin{exercises}\\end{exercises}';
  const output = namespaceChapterSyntax(input, { prefix: 'ls' });

  assert.equal(output, '\\begin{lsexercises}\\end{lsexercises}');
});
