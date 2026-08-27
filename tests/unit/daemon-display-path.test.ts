import { describe, expect, it } from '@jest/globals';
import { displayDaemonPath } from '../../cli/commands/daemon.js';

describe('daemon profile path display', () => {
  it('collapses paths under the active home directory', () => {
    expect(displayDaemonPath('/Users/proof/.pd/instances/dev', '/Users/proof'))
      .toBe('~/.pd/instances/dev');
  });

  it('does not rewrite a sibling whose prefix merely resembles home', () => {
    expect(displayDaemonPath('/Users/proof-other/daemon.log', '/Users/proof'))
      .toBe('/Users/proof-other/daemon.log');
  });

  it('leaves paths outside home unchanged', () => {
    expect(displayDaemonPath('/opt/port-daddy/daemon.log', '/Users/proof'))
      .toBe('/opt/port-daddy/daemon.log');
  });
});
