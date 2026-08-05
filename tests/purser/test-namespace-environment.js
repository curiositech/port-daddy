import { test } from 'node:test';
import { namespaceChapterSyntax } from '../scripts/generate-mega-whitepaper.mjs';

test('namespaces chapter environments correctly', () => {
  const input = '\begin{exercises}\end{exercises}';
  const output = namespaceChapterSyntax(input, { prefix: 'swk' });
  
  assert.equal(output, '\begin{swkexercises}\end{swkexercises}');
});