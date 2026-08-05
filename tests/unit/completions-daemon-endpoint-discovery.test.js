import { readFileSync } from 'node:fs';

/**
 * Focused regression coverage for the selected-daemon endpoint discovery fix
 * in the shell completion scripts. Guards against regressing to a fixed
 * `localhost:9876` address and pins the PORT_DADDY_URL / PORT_DADDY_PORT_FILE
 * resolution order.
 */

const files = {
  bash: 'completions/port-daddy.bash',
  fish: 'completions/port-daddy.fish',
  zsh: 'completions/port-daddy.zsh',
};

describe('completions daemon endpoint discovery', () => {
  test.each(Object.entries(files))('%s does not hardcode a fixed daemon port or host', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    expect(content).not.toContain('9876');
    expect(content).not.toMatch(/localhost:\d+/);
  });

  test.each(Object.entries(files))('%s resolves the base URL from PORT_DADDY_URL first', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    const needle = shell === 'fish' ? 'PORT_DADDY_URL' : '${PORT_DADDY_URL:-}';
    expect(content).toContain(needle);
  });

  test.each(Object.entries(files))('%s trims a trailing slash from an explicit PORT_DADDY_URL', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    const needle = shell === 'fish' ? "string replace -r '/$'" : '${PORT_DADDY_URL%/}';
    expect(content).toContain(needle);
  });

  test.each(Object.entries(files))('%s falls back to the published daemon.port file', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('PORT_DADDY_PORT_FILE');
    expect(content).toContain('.port-daddy/daemon.port');
  });

  test.each(Object.entries(files))('%s routes dynamic queries through the base-url resolver', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    const [resolver, query] = shell === 'fish'
      ? ['__pd_base_url', '__pd_query']
      : ['_pd_base_url', '_pd_query'];
    expect(content).toContain(resolver);
    expect(content).toContain(query);
    const queryFn = content.match(new RegExp(`${query}[\\s\\S]*?\\n(\\}|end)`))?.[0];
    expect(queryFn).toContain(resolver);
  });

  test.each(Object.entries(files))('%s stays silent when the daemon endpoint cannot be resolved', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    const docBlock = content.match(/DYNAMIC COMPLETIONS:[\s\S]*?\n(#|$)/)?.[0] ?? '';
    expect(docBlock.toLowerCase()).not.toContain('localhost:9876');
    // Doc comment describes discovery via a published endpoint, not a fixed address.
    expect(content).toMatch(/published/i);
  });
});
