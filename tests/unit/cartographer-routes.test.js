import { afterEach, describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cartographerPlugin } from '../../routes/cartographer.js';

const tempDirs = [];

function writeProgressFixture(root, slug) {
  mkdirSync(join(root, 'docs', 'recovery'), { recursive: true });
  mkdirSync(join(root, '.cartographer'), { recursive: true });
  writeFileSync(join(root, 'docs', 'ROADMAP.md'), `# Roadmap

## Next Cuts

- **\`${slug}\`** — Surface roadmap state.
`);
  writeFileSync(join(root, 'docs', 'recovery', 'IDEAS-TROVE.md'), `# Ideas

### \`${slug}\`

- status: \`now\`
- why it matters:
  - operators need this in one place
`);
  writeFileSync(join(root, 'docs', 'recovery', 'DOGFOOD-FEEDBACK.md'), '# Feedback\n');
  writeFileSync(join(root, 'docs', 'recovery', 'CURRENT-WORK.md'), '# Current\n');
  writeFileSync(join(root, '.cartographer', 'status.md'), '# Status\n');
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('cartographer routes', () => {
  test('GET /cartographer/roadmap-progress uses daemonDir by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-cartographer-route-'));
    tempDirs.push(root);
    writeProgressFixture(root, 'cartographer-roadmap-progress-screen');

    const app = Fastify();
    await app.register(cartographerPlugin, { deps: { daemonDir: root } });

    const res = await app.inject({
      method: 'GET',
      url: '/cartographer/roadmap-progress',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nextCuts).toEqual([
      {
        slug: 'cartographer-roadmap-progress-screen',
        summary: 'Surface roadmap state.',
      },
    ]);

    await app.close();
  });

  test('GET /cartographer/roadmap-progress can read an explicit repo root', async () => {
    const daemonRoot = mkdtempSync(join(tmpdir(), 'pd-cartographer-daemon-'));
    const requestedRoot = mkdtempSync(join(tmpdir(), 'pd-cartographer-requested-'));
    tempDirs.push(daemonRoot, requestedRoot);
    writeProgressFixture(daemonRoot, 'daemon-root');
    writeProgressFixture(requestedRoot, 'requested-root');

    const app = Fastify();
    await app.register(cartographerPlugin, { deps: { daemonDir: daemonRoot } });

    const res = await app.inject({
      method: 'GET',
      url: `/cartographer/roadmap-progress?root=${encodeURIComponent(requestedRoot)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nextCuts[0].slug).toBe('requested-root');

    await app.close();
  });
});
