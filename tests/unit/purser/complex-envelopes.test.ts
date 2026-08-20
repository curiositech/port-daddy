Final answer',
    };
    const out = extractAiText(res);
    expect(out.text).toBe('Final answer');
  });

  it('removes orphan closing tags but keeps surrounding text', () => {
    const res = { response: 'partial</think>answer' };
    const out = extractAiText(res);
    expect(out.text).toBe('partialanswer');
  });

  it('removes unclosed opening tags and any following content', () => {
    const res = { response: 'start ',
          },
        },
      ],
    };
    const out = extractAiText(res);
    expect(out.shape).toBe('reasoning-only');
    expect(out.text).toBe('');
  });

  it('uses the reasoning fallback for qwen3-style responses', () => {
    const res = {
      choices: [
        {
          message: {
            content: '',
            reasoning_content:
              'Ok\n\nFLEET-VERDICT: PASS',
          },
        },
      ],
    };
    const out = extractAiText(res);
    expect(out.shape).toBe('chat-completions-reasoning');
    expect(out.text).toBe('Ok\n\nFLEET-VERDICT: PASS');
    expect(out.text).not.toContain('BLOCK');
  });

  it('removes nested think blocks within reasoning fallback', () => {
    const res = {
      choices: [
        {
          message: {
            content: '',
            reasoning_content:
              'tail</think>FLEET-VERDICT: PASS',
          },
        },
      ],
    };
    const out = extractAiText(res);
    expect(out.shape).toBe('chat-completions-reasoning');
    expect(out.text).toBe('FLEET-VERDICT: PASS');
  });

  /* ---------- 3. Diagnostic shaping (obligation 5, 10) ---------- */
  it('includes reasoning length in describeResponseShape when present', () => {
    const res = {
      choices: [
        {
          message: { reasoning_content: 'x'.repeat(42), content: '' },
        },
      ],
    };
    const desc = describeResponseShape(res);
    expect(desc).toContain('reasoning.len=42');
  });

  it('does not include reasoning length when reasoning_content is empty', () => {
    const res = {
      choices: [
        {
          message: { reasoning_content: '', content: '' },
        },
      ],
    };
    const desc = describeResponseShape(res);
    expect(desc).not.toContain('reasoning.len');
  });

  /* ---------- 4. stripThinkTags utility (obligation 1, 9) ---------- */
  it('removes multiple free-standing real answer');
    expect(stripped).toBe('real answer');
  });

  it('handles nested blocks leaving no residue', () => {
    const stripped = stripThinkTags('c</think>real answer');
    expect(stripped).toBe('real answer');
  });

  it('drops orphan closers without affecting surrounding text', () => {
    const stripped = stripThinkTags('half a thought</think>the actual answer');
    expect(stripped).toBe('half a thoughtthe actual answer');
  });

  it('truncates at an unclosed opener and removes following content', () => {
    const stripped = stripThinkTags('begin