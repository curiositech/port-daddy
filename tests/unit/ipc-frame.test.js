import { encodeFrame, createFrameDecoder, nextConvId } from '../../lib/ipc-frame.ts';
import { Performative, HEADER_SIZE, MAX_PAYLOAD_SIZE, FIRE_AND_FORGET, PERFORMATIVE_NAME } from '../../lib/ipc-types.ts';

describe('IPC Frame Codec', () => {
  describe('encodeFrame', () => {
    test('encodes header fields correctly', () => {
      const frame = {
        type: Performative.INFORM,
        convId: 0,
        payload: { action: 'heartbeat', agentId: 'agent-001', ts: 1234567890 },
      };

      const buf = encodeFrame(frame);

      expect(buf.readUInt8(0)).toBe(Performative.INFORM);
      expect(buf.readUInt32BE(1)).toBe(0);
      const payloadLen = buf.readUInt16BE(5);
      expect(payloadLen).toBe(buf.length - HEADER_SIZE);
      expect(payloadLen).toBeGreaterThan(0);  // Non-trivial payload
    });

    test('encodes conv_id for request frames', () => {
      const buf = encodeFrame({
        type: Performative.REQUEST,
        convId: 42,
        payload: { action: 'port.claim', identity: 'myapp:api:main' },
      });
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

    test('empty payload roundtrips to empty object', () => {
      const decoder = createFrameDecoder();
      const decoded = decoder.push(encodeFrame({
        type: Performative.AGREE,
        convId: 1,
        payload: {},
      }));
      expect(decoded).toHaveLength(1);
      expect(decoded[0].payload).toEqual({});
      expect(decoded[0].type).toBe(Performative.AGREE);
      expect(decoded[0].convId).toBe(1);
    });
  });

  describe('createFrameDecoder', () => {
    test('decodes a single complete frame with correct values', () => {
      const encoded = encodeFrame({
        type: Performative.INFORM,
        convId: FIRE_AND_FORGET,
        payload: { action: 'heartbeat', agentId: 'a-001' },
      });
      const decoder = createFrameDecoder();
      const decoded = decoder.push(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0].type).toBe(Performative.INFORM);
      expect(decoded[0].convId).toBe(0);
      expect(decoded[0].payload.action).toBe('heartbeat');
      expect(decoded[0].payload.agentId).toBe('a-001');
    });

    test('handles multiple frames in one chunk', () => {
      const frame1 = encodeFrame({ type: Performative.INFORM, convId: 0, payload: { n: 1 } });
      const frame2 = encodeFrame({ type: Performative.REQUEST, convId: 99, payload: { n: 2 } });

      const combined = Buffer.concat([frame1, frame2]);
      const decoder = createFrameDecoder();
      const decoded = decoder.push(combined);

      expect(decoded).toHaveLength(2);
      expect(decoded[0].payload.n).toBe(1);
      expect(decoded[0].type).toBe(Performative.INFORM);
      expect(decoded[1].payload.n).toBe(2);
      expect(decoded[1].convId).toBe(99);
      expect(decoded[1].type).toBe(Performative.REQUEST);
    });

    test('handles partial frames across chunks', () => {
      const frame = encodeFrame({
        type: Performative.QUERY_REF,
        convId: 7,
        payload: { action: 'port.find', pattern: 'myapp:*' },
      });

      const decoder = createFrameDecoder();
      const mid = Math.floor(frame.length / 2);

      expect(decoder.push(frame.subarray(0, mid))).toHaveLength(0);
      expect(decoder.bufferedBytes).toBe(mid);

      const decoded = decoder.push(frame.subarray(mid));
      expect(decoded).toHaveLength(1);
      expect(decoded[0].convId).toBe(7);
      expect(decoded[0].payload.action).toBe('port.find');
      expect(decoder.bufferedBytes).toBe(0);
    });

    test('handles header-only partial read (3 chunks)', () => {
      const frame = encodeFrame({
        type: Performative.INFORM,
        convId: 0,
        payload: { x: 'hello' },
      });

      const decoder = createFrameDecoder();
      expect(decoder.push(frame.subarray(0, 3))).toHaveLength(0);
      expect(decoder.push(frame.subarray(3, HEADER_SIZE))).toHaveLength(0);

      const decoded = decoder.push(frame.subarray(HEADER_SIZE));
      expect(decoded).toHaveLength(1);
      expect(decoded[0].payload.x).toBe('hello');
    });

    test('reset clears buffer and decoder works after reset', () => {
      const decoder = createFrameDecoder();
      decoder.push(Buffer.from([0x01, 0x00]));
      expect(decoder.bufferedBytes).toBe(2);

      decoder.reset();
      expect(decoder.bufferedBytes).toBe(0);

      // Must still work after reset
      const frame = encodeFrame({ type: Performative.INFORM, convId: 0, payload: { postReset: true } });
      const decoded = decoder.push(frame);
      expect(decoded).toHaveLength(1);
      expect(decoded[0].payload.postReset).toBe(true);
    });

    test('skips frame with malformed msgpack payload', () => {
      const decoder = createFrameDecoder();

      // Build a frame with valid header but garbage payload
      const garbage = Buffer.alloc(HEADER_SIZE + 10);
      garbage.writeUInt8(Performative.INFORM, 0);
      garbage.writeUInt32BE(0, 1);
      garbage.writeUInt16BE(10, 5);
      // Fill payload with invalid msgpack bytes
      garbage.fill(0xFF, HEADER_SIZE);

      // Append a valid frame after the garbage
      const valid = encodeFrame({ type: Performative.REQUEST, convId: 5, payload: { ok: true } });
      const combined = Buffer.concat([garbage, valid]);

      const decoded = decoder.push(combined);
      // Garbage frame skipped, valid frame decoded
      expect(decoded).toHaveLength(1);
      expect(decoded[0].payload.ok).toBe(true);
      expect(decoded[0].convId).toBe(5);
    });
  });

  describe('roundtrip', () => {
    test('all 13 performative types survive encode/decode', () => {
      const decoder = createFrameDecoder();
      const performativeCount = Object.keys(Performative).length;
      expect(performativeCount).toBe(13);  // Guard against silent additions

      for (const [name, code] of Object.entries(Performative)) {
        const frame = { type: code, convId: code, payload: { performative: name } };
        const decoded = decoder.push(encodeFrame(frame));

        expect(decoded).toHaveLength(1);
        expect(decoded[0].type).toBe(code);
        expect(decoded[0].convId).toBe(code);
        expect(decoded[0].payload.performative).toBe(name);
      }
    });

    test('complex nested payload survives roundtrip', () => {
      const original = {
        action: 'session.begin',
        result: {
          sessionId: 'sess-abc',
          agentId: 'agent-xyz',
          port: 3001,
          identity: 'myapp:api:main',
          files: ['src/auth.ts', 'src/middleware.ts'],
          meta: { nested: { deep: true } },
        },
      };

      const decoder = createFrameDecoder();
      const decoded = decoder.push(encodeFrame({
        type: Performative.INFORM_DONE,
        convId: 12345,
        payload: original,
      }));

      expect(decoded).toHaveLength(1);
      expect(decoded[0].payload).toEqual(original);  // Deep equality, not cherry-picking
    });

    test('boundary payload sizes: 0 bytes, 1 byte, near-max', () => {
      const decoder = createFrameDecoder();

      // Empty
      const d1 = decoder.push(encodeFrame({ type: Performative.AGREE, convId: 1, payload: {} }));
      expect(d1).toHaveLength(1);

      // 1 field
      const d2 = decoder.push(encodeFrame({ type: Performative.AGREE, convId: 2, payload: { x: 1 } }));
      expect(d2).toHaveLength(1);
      expect(d2[0].payload.x).toBe(1);

      // Large (but under limit) — 50KB of data
      const big = { data: 'A'.repeat(50000) };
      const d3 = decoder.push(encodeFrame({ type: Performative.INFORM, convId: 3, payload: big }));
      expect(d3).toHaveLength(1);
      expect(d3[0].payload.data.length).toBe(50000);
    });
  });

  describe('nextConvId', () => {
    test('generates unique incrementing IDs that are never 0', () => {
      const ids = new Set();
      for (let i = 0; i < 1000; i++) {
        const id = nextConvId();
        expect(id).not.toBe(0);
        expect(id).toBeGreaterThan(0);
        ids.add(id);
      }
      // All unique
      expect(ids.size).toBe(1000);
    });
  });

  describe('PERFORMATIVE_NAME', () => {
    test('maps ALL performative codes to names', () => {
      for (const [name, code] of Object.entries(Performative)) {
        expect(PERFORMATIVE_NAME[code]).toBe(name);
      }
      // Same count
      expect(Object.keys(PERFORMATIVE_NAME).length).toBe(Object.keys(Performative).length);
    });
  });
});
