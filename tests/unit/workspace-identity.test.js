import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  captureWorkspaceIdentity,
  sameWorkspaceIdentity,
} from '../../lib/workspace-identity.js';

describe('workspace identity', () => {
  test('binds a canonical path to its directory device and inode', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-workspace-identity-'));
    const workspace = join(root, 'workspace');
    const moved = join(root, 'moved');
    mkdirSync(workspace);
    try {
      const identity = captureWorkspaceIdentity(workspace);
      expect(identity).toEqual(expect.objectContaining({
        canonicalPath: realpathSync(workspace),
        device: expect.any(Number),
        inode: expect.any(Number),
      }));
      expect(sameWorkspaceIdentity(workspace, identity)).toBe(true);

      renameSync(workspace, moved);
      mkdirSync(workspace);
      expect(sameWorkspaceIdentity(workspace, identity)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
