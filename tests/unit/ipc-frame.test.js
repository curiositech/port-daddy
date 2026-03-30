import { encodeFrame, createFrameDecoder, nextConvId } from '../../lib/ipc-frame.ts';
import { Performative, HEADER_SIZE, MAX_PAYLOAD_SIZE, FIRE_AND_FORGET, PERFORMATIVE_NAME } from '../../lib/ipc-types.ts';

describe('IPC Frame Codec', () => {
  describe('encodeFrame', () => {
    test('encodes a simple inform frame', () => {
      const frame = {
        type: Performative.INFORM,
        convId: 0,
        payload: { action: 'heartbeat', agentId: 'agent-001', ts: 1234567890 },
      };

      const buf = encodeFrame(frame);

      // Header checks
      expect(buf.length).toBeGreaterThan(HEADER_SIZE);
      expect(buf.readUInt8(0)).toBe(Performative.INFORM);
      expect(buf.readUInt32BE(1)).toBe(0);  // fire-and-forget
      expect(buf.readUInt16BE(5)).toBe(buf.length - HEADER_SIZE);
    });

    test('encodes a request frame with conv_id', () => {
      const frame = {
        type: Performative.REQUEST,
        convId: 42,
        payload: { action: 'port.claim', identity: 'myapp:api:main' },
      };

      const buf = encodeFrame(frame);
      expect(buf.readUInt8(0)).toBe(Performative.REQUEST);
      expect(buf.readUInt32BE(1)).toBe(42);
    });

    test('throws on oversized payload', () => {
      const frame = {
        type: Performative.INFORM,
        convId: 0,
        payload: { data: 'x'.repeat(MAX_PAYLOAD_SIZE + 1000) },
      };

      expect(() => encodeFrame(frame)).toThrow('payload too large');
    });

    test('handles empty payload', () => {
      const frame = {
        type: Performative.AGREE,
        convId: 1,
        payload: {},
      };

      const buf = encodeFrame(frame);
      expect(buf.length).toBeGreaterThanOrEqual(HEADER_SIZE);
    });
  });

  describe('createFrameDecoder', () => {
    test('decodes a single complete frame', () => {
      const frame = {
        type: Performative.INFORM,
        convId: FIRE_AND_FORGET,
        payload: { action: 'heartbeat', agentId: 'a-001' },
      };

      const encoded = encodeFrame(frame);
      const decoder = createFrameDecoder();
      const decoded = decoder.push(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0].type).toBe(Performative.INFORM);
      expect(decoded[0].convId).toBe(0);
      expect(decoded[0].payload.action).toBe('heartbeat');
      expect(decoded[0].payload.agentId).toBe('a-001');
    });

    test('handles multiple frames in one chunk', () => {
      const frame1 = encodeFrame({
        type: Performative.INFORM,
        convId: 0,
        payload: { n: 1 },
      });
      const frame2 = encodeFrame({
        type: Performative.REQUEST,
        convId: 99,
        payload: { n: 2 },
      });

      const combined = Buffer.concat([frame1, frame2]);
      const decoder = createFrameDecoder();
      const decoded = decoder.push(combined);

      expect(decoded).toHaveLength(2);
      expect(decoded[0].payload.n).toBe(1);
      expect(decoded[1].payload.n).toBe(2);
      expect(decoded[1].convId).toBe(99);
    });

    test('handles partial frames across chunks', () => {
      const frame = encodeFrame({
        type: Performative.QUERY_REF,
        convId: 7,
        payload: { action: 'port.find', pattern: 'myapp:*' },
      });

      const decoder = createFrameDecoder();

      // Split in the middle
      const mid = Math.floor(frame.length / 2);
      const chunk1 = frame.subarray(0, mid);
      const chunk2 = frame.subarray(mid);

      // First chunk: no complete frame yet
      expect(decoder.push(chunk1)).toHaveLength(0);
      expect(decoder.bufferedBytes).toBe(mid);

      // Second chunk: frame completes
      const decoded = decoder.push(chunk2);
      expect(decoded).toHaveLength(1);
      expect(decoded[0].convId).toBe(7);
      expect(decoded[0].payload.action).toBe('port.find');
      expect(decoder.bufferedBytes).toBe(0);
    });

    test('handles header-only partial read', () => {
      const frame = encodeFrame({
        type: Performative.INFORM,
        convId: 0,
        payload: { x: 'hello' },
      });

      const decoder = createFrameDecoder();

      // Only send 3 bytes (partial header)
      expect(decoder.push(frame.subarray(0, 3))).toHaveLength(0);

      // Send rest of header but not payload
      expect(decoder.push(frame.subarray(3, HEADER_SIZE))).toHaveLength(0);

      // Send payload
      const decoded = decoder.push(frame.subarray(HEADER_SIZE));
      expect(decoded).toHaveLength(1);
      expect(decoded[0].payload.x).toBe('hello');
    });

    test('reset clears buffer', () => {
      const decoder = createFrameDecoder();
      decoder.push(Buffer.from([0x01, 0x00]));  // partial junk
      expect(decoder.bufferedBytes).toBe(2);

      decoder.reset();
      expect(decoder.bufferedBytes).toBe(0);
    });
  });

  describe('roundtrip', () => {
    test('all performative types survive encode/decode', () => {
      const decoder = createFrameDecoder();

      for (const [name, code] of Object.entries(Performative)) {
        const frame = {
          type: code,
          convId: code,  // use code as convId for uniqueness
          payload: { performative: name },
        };

        const encoded = encodeFrame(frame);
        const decoded = decoder.push(encoded);

        expect(decoded).toHaveLength(1);
        expect(decoded[0].type).toBe(code);
        expect(decoded[0].convId).toBe(code);
        expect(decoded[0].payload.performative).toBe(name);
      }
    });

    test('complex nested payload survives roundtrip', () => {
      const frame = {
        type: Performative.INFORM_DONE,
        convId: 12345,
        payload: {
          action: 'session.begin',
          result: {
            sessionId: 'sess-abc',
            agentId: 'agent-xyz',
            port: 3001,
            identity: 'myapp:api:main',
            files: ['src/auth.ts', 'src/middleware.ts'],
            meta: { nested: { deep: true } },
          },
        },
      };

      const decoder = createFrameDecoder();
      const decoded = decoder.push(encodeFrame(frame));

      expect(decoded).toHaveLength(1);
      expect(decoded[0].payload.result.sessionId).toBe('sess-abc');
      expect(decoded[0].payload.result.files).toEqual(['src/auth.ts', 'src/middleware.ts']);
      expect(decoded[0].payload.result.meta.nested.deep).toBe(true);
    });
  });

  describe('nextConvId', () => {
    test('generates incrementing IDs', () => {
      const id1 = nextConvId();
      const id2 = nextConvId();
      expect(id2).toBe(id1 + 1);
    });

    test('never returns 0', () => {
      // Generate many IDs and verify none are 0
      for (let i = 0; i < 1000; i++) {
        expect(nextConvId()).not.toBe(0);
      }
    });
  });

  describe('PERFORMATIVE_NAME', () => {
    test('maps all codes to names', () => {
      expect(PERFORMATIVE_NAME[Performative.INFORM]).toBe('INFORM');
      expect(PERFORMATIVE_NAME[Performative.REQUEST]).toBe('REQUEST');
      expect(PERFORMATIVE_NAME[Performative.NOT_UNDERSTOOD]).toBe('NOT_UNDERSTOOD');
      expect(PERFORMATIVE_NAME[Performative.SUBSCRIBE]).toBe('SUBSCRIBE');
    });
  });
});
