real answer')).toBe('real answer');
  });

  it('removes deeply nested blocks', () => {
    const input =
      'd</think>e</think>text';
    expect(stripThinkTags(input)).toBe('text');
  });

  it('removes blocks with text outside of the outermost block', () => {
    expect(stripThinkTags('text')).toBe('text');
  });

  it('removes an orphan closing tag but keeps surrounding text', () => {
    const input = 'half a thought</think>the actual answer';
    // The trailing space is trimmed by the function.
    expect(stripThinkTags(input)).toBe('half a thoughtthe actual answer');
  });

  it('removes an orphan opening tag with trailing content', () => {
    expect(stripThinkTags('prefix ')).toBe('');
  });

  it('does not alter strings without any content')).toBe('content');
  });

  it('handles adjacent blocks without intervening text', () => {
    expect(stripThinkTags('c')).toBe('c');
  });

  it('removes nested blocks with text inside the outer block', () => {
    expect(stripThinkTags(' end</think>')).toBe('');
  });

  it('removes stray closing tags after content', () => {
    const input = 'prefix</think>suffix';
    expect(stripThinkTags(input)).toBe('prefixsuffix');
  });

  it('removes stray closing tags after nested content', () => {
    const input = 'sometext</think>more';
    expect(stripThinkTags(input)).toBe('some');
  });

  it('does not remove non-   middle   ')).toBe('middle');
  });

  it('handles multiple nested and orphan tags together', () => {
    const input = 'sometext</think>more';
    expect(stripThinkTags(input)).toBe('some');
  });

  it('removes all nested tags even if there are stray closers inside', () => {
    const input = ' end</think>extra</think>text';
    expect(stripThinkTags(input)).toBe('text');
  });
});
```