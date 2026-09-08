import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const cliSource = readFileSync(join(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');

// Parse the ALL_COMMANDS array from port-daddy-cli.ts
function extractValidCommands(source) {
  const match = source.match(/const\s+ALL_COMMANDS\s*:\s*string\[\]\s*=\s*\[([\s\S]*?)\];/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map(c => c.replace(/['"`\s]/g, ''))
    .filter(Boolean);
}

// Parse the TOPIC_HELP object from port-daddy-cli.ts
function extractTopicHelp(source) {
  // Find TOPIC_HELP = { ... }
  const match = source.match(/const\s+TOPIC_HELP\s*:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) return {};
  
  const content = match[1];
  const topics = {};
  
  // Topic pattern: key: `multiline text`
  const topicPattern = /(\w+):\s*`([\s\S]*?)`/g;
  let topicMatch;
  while ((topicMatch = topicPattern.exec(content)) !== null) {
    topics[topicMatch[1]] = topicMatch[2];
  }
  return topics;
}

describe('CLI Help Examples Doctest', () => {
  const validCommands = new Set(extractValidCommands(cliSource));
  const topics = extractTopicHelp(cliSource);

  test('valid commands array parsed correctly', () => {
    expect(validCommands.size).toBeGreaterThan(10);
    expect(validCommands.has('setup')).toBe(true);
    expect(validCommands.has('session')).toBe(true);
  });

  test('all examples in TOPIC_HELP use valid commands', () => {
    const errors = [];
    for (const [topic, text] of Object.entries(topics)) {
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Match line starting with pd or port-daddy (optionally with prompt prefix or notes)
        if (trimmed.startsWith('pd ') || trimmed.startsWith('port-daddy ')) {
          const parts = trimmed.split(/\s+/);
          const cmd = parts[1]; // e.g. "setup" from "pd setup"
          if (cmd && !cmd.startsWith('-') && !cmd.startsWith('<') && !cmd.startsWith('[')) {
            // Some examples show placeholder commands or generic words like "inbox send", we extract the main verb
            // e.g. "pd inbox send" -> command is "inbox"
            if (!validCommands.has(cmd)) {
              errors.push(`Topic "${topic}" example uses unknown command: "${cmd}" in line: "${trimmed}"`);
            }
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });
});
