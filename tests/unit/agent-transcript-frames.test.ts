import { agentTranscriptFrames } from '../../routes/transcripts';

describe('agentTranscriptFrames — per-agent live stream frame builder', () => {
  it('emits a text frame for a message with content', () => {
    const frames = agentTranscriptFrames([{ role: 'assistant', content: 'hello world' }], 0);
    expect(frames).toEqual([
      { kind: 'agent.transcript', body: { text: 'hello world', role: 'assistant' } },
    ]);
  });

  it('skips empty / whitespace-only content', () => {
    const frames = agentTranscriptFrames([{ role: 'assistant', content: '   ' }], 0);
    expect(frames).toEqual([]);
  });

  it('emits a running tool frame when a tool call has no result yet', () => {
    const frames = agentTranscriptFrames(
      [{ role: 'assistant', content: '', tool_calls: [{ name: 'Bash' }] }],
      0,
    );
    expect(frames).toEqual([
      { kind: 'agent.transcript', body: { toolName: 'Bash', status: 'running' } },
    ]);
  });

  it('emits a done tool frame once a result is present', () => {
    const frames = agentTranscriptFrames(
      [{ role: 'tool', content: '', tool_calls: [{ name: 'Read', result: 'ok' }] }],
      0,
    );
    expect(frames).toEqual([
      { kind: 'agent.transcript', body: { toolName: 'Read', status: 'done' } },
    ]);
  });

  it('emits both text and tool frames for one rich message', () => {
    const frames = agentTranscriptFrames(
      [{ role: 'assistant', content: 'let me check', tool_calls: [{ name: 'Grep' }] }],
      0,
    );
    expect(frames).toEqual([
      { kind: 'agent.transcript', body: { text: 'let me check', role: 'assistant' } },
      { kind: 'agent.transcript', body: { toolName: 'Grep', status: 'running' } },
    ]);
  });

  it('is idempotent across update events via the cursor — only the new tail is emitted', () => {
    const messages = [
      { role: 'assistant', content: 'first' },
      { role: 'assistant', content: 'second' },
    ];
    // After we have already streamed 1 message, only the second is produced.
    const frames = agentTranscriptFrames(messages, 1);
    expect(frames).toEqual([
      { kind: 'agent.transcript', body: { text: 'second', role: 'assistant' } },
    ]);
  });

  it('returns nothing when the cursor is at or past the end', () => {
    const messages = [{ role: 'assistant', content: 'only' }];
    expect(agentTranscriptFrames(messages, 1)).toEqual([]);
    expect(agentTranscriptFrames(messages, 5)).toEqual([]);
  });

  it('defaults role to assistant when absent', () => {
    const frames = agentTranscriptFrames([{ content: 'no role' }], 0);
    expect(frames[0].body).toEqual({ text: 'no role', role: 'assistant' });
  });
});
