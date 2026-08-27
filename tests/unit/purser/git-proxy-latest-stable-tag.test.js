// tests/unit/purser/git-proxy-latest-stable-tag.test.js
import { describe, test, expect, jest } from '@jest/globals';
import {
  latestStableTag,
  findLatestStableTag,
} from '../../../scripts/release-workflow-state.mjs';

describe('latestStableTag', () => {
  test('returns null for an empty tag list', () => {
    expect(latestStableTag([])).toBeNull();
  });

  test('returns null when only prerelease tags are present', () => {
    const tags = ['v3.30.2-rc.1', 'v3.30.2-beta.2', 'v4.0.0-alpha'];
    expect(latestStableTag(tags)).toBeNull();
  });

  test('selects the newest stable tag, ignoring prereleases and zero‑padded tags', () => {
    const tags = [
      'v3.30.1',
      'v3.30.2-rc.1', // prerelease, should be ignored
      'v03.30.2', // invalid due to leading zero, ignored
      'v3.30.2',
      'v3.30.2-rc.2', // prerelease, ignored
      'v3.29.9',
    ];
    expect(latestStableTag(tags)).toBe('v3.30.2');
  });

  test('handles very large numeric components without loss of precision', () => {
    const tags = [
      'v9007199254740992.0.0',
      'v9007199254740993.0.0', // should win
      'v9007199254740991.0.0',
    ];
    expect(latestStableTag(tags)).toBe('v9007199254740993.0.0');
  });

  test('does not mutate the original array', () => {
    const original = ['v1.0.0', 'v2.0.0'];
    const copy = [...original];
    latestStableTag(original);
    expect(original).toEqual(copy);
  });
});

describe('findLatestStableTag (git proxy)', () => {
  test('uses the default pattern "v*" when none is supplied', () => {
    const gitMock = jest.fn(() => 'v1.0.0\nv2.0.0');
    const result = findLatestStableTag(gitMock);
    expect(result).toBe('v2.0.0');
    expect(gitMock).toHaveBeenCalledTimes(1);
    expect(gitMock).toHaveBeenCalledWith(['tag', '--list', 'v*']);
  });

  test('passes a custom pattern through to git unchanged', () => {
    const gitMock = jest.fn(() => 'v3.30.1\nv3.30.2-rc.1');
    const result = findLatestStableTag(gitMock, 'v3.30.*');
    expect(result).toBe('v3.30.1');
    expect(gitMock).toHaveBeenCalledWith(['tag', '--list', 'v3.30.*']);
  });

  test('returns null when git produces no output', () => {
    const gitMock = jest.fn(() => '');
    expect(findLatestStableTag(gitMock)).toBeNull();
    expect(gitMock).toHaveBeenCalledWith(['tag', '--list', 'v*']);
  });

  test('returns null when git output contains only prerelease tags', () => {
    const gitMock = jest.fn(() => 'v3.30.2-rc.1\nv3.30.2-beta.2');
    expect(findLatestStableTag(gitMock)).toBeNull();
  });

  test('correctly filters out zero‑padded tags from git output', () => {
    const gitMock = jest.fn(() => 'v03.29.0\nv3.029.0\nv3.29.00\nv3.29.1');
    expect(findLatestStableTag(gitMock)).toBe('v3.29.1');
  });

  test('selects the highest stable tag among unsorted git output', () => {
    const gitMock = jest.fn(() => 'v3.30.2\nv3.30.1\nv3.29.9');
    expect(findLatestStableTag(gitMock)).toBe('v3.30.2');
  });

  test('handles very large versions from git without precision loss', () => {
    const gitMock = jest.fn(() => 'v9007199254740992.0.0\nv9007199254740993.0.0');
    expect(findLatestStableTag(gitMock)).toBe('v9007199254740993.0.0');
  });
});