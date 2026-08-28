import { LLMCompletionRequest } from '../../../lib/llm-call.ts';
import { Readable } from 'stream';

test('streams SSE correctly', async () => {
  const mockStream = new Readable({
    read() {
      this.push('data: {"content":"Hello"}\n\n');
      this.push('data: {"content":"World"}\n\n');
      this.push(null);
    }
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: {
      get: (name) => (name === 'content-type' ? 'text/event-stream' : null)
    },
    body: mockStream
  });
  const request = new LLMCompletionRequest({ model: 'test', messages: [] }, { stream: true });
  const chunks = [];
  for await (const chunk of request.stream()) {
    chunks.push(chunk);
  }
  expect(chunks).toEqual([{content:'Hello'}, {content:'World'}]);
});