real answer')).toBe(
      'real answer',
    );
    expect(
      stripThinkTags('half a thought</think>the actual answer'),
    ).toBe('half a thoughtthe actual answer');
  });

  it('extractAiText reads typed-part array content, ignoring non‑string parts', () => {
    const res = {
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 42 },
              { type: 'text', text: 'hello' },
              { type: 'text', text: false },
            ],
          },
        },
      ],
    };
    const out = extractAiText(res);
    expect(out.shape).toBe('chat-completions');
    expect(out.text).toBe('hello');
  });

  it('unknown shape when content is a non‑string/non‑array value', () => {
    const res = { choices: [{ message: { content: 123 } }] };
    const out = extractAiText(res);
    expect(out.shape).toBe('unknown');
    expect(out.text).toBe('');
  });

  it('unknown shape when both content and reasoning are empty strings', () => {
    const res = { choices: [{ message: { content: '', reasoning_content: '' } }] };
    const out = extractAiText(res);
    expect(out.shape).toBe('unknown');
    expect(out.text).toBe('');
  });

  it('recognizes reasoning-only when reasoning contains only