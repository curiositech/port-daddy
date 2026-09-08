import { describe, expect, it } from '@jest/globals';
import { displayDaemonPath } from '../../cli/commands/daemon.js';

describe('daemon profile path display', () => {
  it('collapses paths under the active home directory', () => {
    expect(displayDaemonPath('/Users/proof/.pd/instances/dev', '/Users/proof'))
      .toBe('~/.pd/instances/dev');
  });

  it('normalizes trailing slashes before collapsing configured runtime paths', () => {
    expect(displayDaemonPath('/Users/proof/.pd/instances/dev/', '/Users/proof/'))
      .toBe('~/.pd/instances/dev');
    expect(displayDaemonPath('/Users/proof/', '/Users/proof/')).toBe('~');
  });

  it('does not rewrite a sibling whose prefix merely resembles home', () => {
    expect(displayDaemonPath('/Users/proof-other/daemon.log', '/Users/proof'))
      .toBe('/Users/proof-other/daemon.log');
  });

  it('leaves paths outside home unchanged', () => {
    expect(displayDaemonPath('/opt/port-daddy/daemon.log', '/Users/proof'))
      .toBe('/opt/port-daddy/daemon.log');
  });

  it('leaves a relative runtime path visible rather than inventing a home prefix', () => {
    expect(displayDaemonPath('profiles/preview/daemon.log', '/Users/proof'))
      .toBe('profiles/preview/daemon.log');
  });

  it('reports a missing legacy runtime field safely', () => {
    expect(displayDaemonPath(undefined, '/Users/proof')).toBe('-');
  });

  it('does not collapse arbitrary absolute paths when the runtime has no home value', () => {
    expect(displayDaemonPath('/opt/port-daddy/daemon.log', '')).toBe('/opt/port-daddy/daemon.log');
  });
});
