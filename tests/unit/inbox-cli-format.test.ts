import { describe, expect, test } from '@jest/globals';
import { inboxMessagePreview } from '../../cli/utils/message-preview.js';

describe('inboxMessagePreview', () => {
  test.each([
    ['plain text', 'plain text'],
    [{ kind: 'coordination', files: 2 }, '{"kind":"coordination","files":2}'],
    [42, '42'],
    [null, 'null'],
    [undefined, ''],
  ])('renders %p without throwing', (content, expected) => {
    expect(inboxMessagePreview(content)).toBe(expected);
  });

  test('truncates the normalized payload once', () => {
    expect(inboxMessagePreview({ message: 'abcdefghij' }, 13)).toBe('{"message":"a...');
  });
});
