import { expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const LATEX_LOGS = [
  'harbor-economy.log',
  'legible-swarm.log',
  'single-writer-kernel.log'
];

test('No overfull boxes or undefined references in LaTeX logs', () => {
  LATEX_LOGS.forEach(logFile => {
    const logPath = join(__dirname, `../../website-v2/public/whitepaper/${logFile}`);
    const logContent = readFileSync(logPath, 'utf-8');
    
    expect(logContent).not.toMatch(/Overfull/);
    expect(logContent).not.toMatch(/Undefined control sequence/);
    expect(logContent).not.toMatch(/Undefined reference/);
  });
});