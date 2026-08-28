import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../../../dist/cli.js');

describe('parley CLI harbor flag', () => {
  test('passes harbor flag to backend', async () => {
    const result = spawnSync('node', [cliPath, 'parley', 'respond', '--harbor', 'myharbor', '--id', '123', '--performative', 'accept'], {
      env: { ...process.env, NODE_ENV: 'test' },
      encoding: 'utf-8',
    });
    // ... parse stdout for request payload captured via mock server
  });
});