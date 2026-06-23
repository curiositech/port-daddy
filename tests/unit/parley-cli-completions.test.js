import { readFileSync } from 'node:fs';

const files = [
  'completions/port-daddy.bash',
  'completions/port-daddy.fish',
  'completions/port-daddy.zsh',
];

function parleyBlock(file, content) {
  if (file.endsWith('.bash')) {
    return content.match(/# parley[\s\S]*?# fleet/)?.[0] ?? '';
  }
  if (file.endsWith('.fish')) {
    return content.match(/# parley[\s\S]*?complete -c \$prog -n "__pd_using_command parley" -s q[^\n]*/)?.[0] ?? '';
  }
  return content.match(/_pd_cmd_parley\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
}

describe('parley shell completions', () => {
  test.each(files)('%s advertises the CLI-supported parley flags', (file) => {
    const content = parleyBlock(file, readFileSync(file, 'utf8'));
    expect(content).not.toBe('');
    for (const expected of ['--ttl-ms', '--round-limit', '--content', '--shape', '--independence', '--contention']) {
      const needle = file.endsWith('.fish') ? `-l ${expected.slice(2)}` : expected;
      expect(content).toContain(needle);
    }
  });

  test.each(files)('%s does not advertise stale parley flags', (file) => {
    const content = parleyBlock(file, readFileSync(file, 'utf8'));
    expect(content).not.toBe('');
    for (const stale of ['--ttl', '--text', '--type', '--agents', '--subtasks', '--contexts', '--criticality', '--exploration', '--shared-files']) {
      const pattern = file.endsWith('.fish')
        ? new RegExp(`-l ${stale.slice(2)}(?![\\w-])`)
        : new RegExp(`${stale.replace('-', '\\-')}(?![\\w-])`);
      expect(pattern.test(content)).toBe(false);
    }
  });
});
