/**
 * Port Daddy IPC Frame Codec
 *
 * Encodes/decodes binary IPC frames with 7-byte header + MessagePack payload.
 *
 * Frame format:
 *   [type:1][conv_id:4][payload_len:2][msgpack payload]
 *
 * - type:        FIPA performative code (uint8)
 * - conv_id:     conversation ID for req/res matching (uint32 BE)
 * - payload_len: msgpack payload length in bytes (uint16 BE)
 * - payload:     MessagePack-encoded object
 *
 * Fire-and-forget frames use conv_id=0.
 * Request-response frames use non-zero conv_id for correlation.
 */

import { pack, unpack } from 'msgpackr';
import { HEADER_SIZE, MAX_PAYLOAD_SIZE, Performative } from './ipc-types.js';
import type { IpcFrame, PerformativeCode } from './ipc-types.js';

/** Valid performative type codes — reject frames with unknown types */
const VALID_TYPES = new Set<number>(Object.values(Performative));

// ─── Encode ─────────────────────────────────────────────────────────────────

/**
 * Encode a frame into a Buffer ready for the wire.
 * Throws if payload exceeds MAX_PAYLOAD_SIZE.
 */
export function encodeFrame(frame: IpcFrame): Buffer {
  const payloadBuf = pack(frame.payload);

  if (payloadBuf.length > MAX_PAYLOAD_SIZE) {
    throw new RangeError(
      `IPC payload too large: ${payloadBuf.length} bytes (max ${MAX_PAYLOAD_SIZE})`
    );
  }

  const buf = Buffer.allocUnsafe(HEADER_SIZE + payloadBuf.length);

  // Header
  buf.writeUInt8(frame.type, 0);                    // type: 1 byte
  buf.writeUInt32BE(frame.convId, 1);                // conv_id: 4 bytes
  buf.writeUInt16BE(payloadBuf.length, 5);           // payload_len: 2 bytes

  // Payload
  payloadBuf.copy(buf, HEADER_SIZE);

  return buf;
}

// ─── Decode ─────────────────────────────────────────────────────────────────

/**
 * Streaming frame decoder. Feed it chunks from a socket and it emits
 * complete frames. Handles partial reads and multi-frame buffers.
 *
 * Usage:
 *   const decoder = createFrameDecoder();
 *   socket.on('data', (chunk) => {
 *     for (const frame of decoder.push(chunk)) {
 *       handleFrame(frame);
 *     }
 *   });
 */
export function createFrameDecoder() {
  let buffer = Buffer.alloc(0);

  return {
    /**
     * Push a chunk of data from the socket.
     * Returns an array of complete frames decoded from the buffer.
     */
    push(chunk: Buffer): IpcFrame[] {
      buffer = Buffer.concat([buffer, chunk]);
      const frames: IpcFrame[] = [];

      while (buffer.length >= HEADER_SIZE) {
        const payloadLen = buffer.readUInt16BE(5);

        // Check if we have the full frame
        const frameLen = HEADER_SIZE + payloadLen;
        if (buffer.length < frameLen) break;  // Wait for more data

        // Validate payload length
        if (payloadLen > MAX_PAYLOAD_SIZE) {
          // Protocol violation — skip this frame, advance past header
          buffer = buffer.subarray(HEADER_SIZE);
          continue;
        }

        // Decode header — validate type is a known performative
        const rawType = buffer.readUInt8(0);
        if (!VALID_TYPES.has(rawType)) {
          // Unknown performative — skip frame, count as protocol violation
          buffer = buffer.subarray(frameLen);
          continue;
        }
        const type = rawType as PerformativeCode;
        const convId = buffer.readUInt32BE(1);

        // Decode payload
        const payloadBuf = buffer.subarray(HEADER_SIZE, frameLen);
        let payload: Record<string, unknown>;
        try {
          payload = unpack(payloadBuf) as Record<string, unknown>;
        } catch {
          // Malformed msgpack — skip frame
          buffer = buffer.subarray(frameLen);
          continue;
        }

        frames.push({ type, convId, payload });

        // Advance buffer past this frame
        buffer = buffer.subarray(frameLen);
      }

      return frames;
    },

    /** Reset the decoder state (e.g., on reconnection) */
    reset(): void {
      buffer = Buffer.alloc(0);
    },

    /** Current buffered bytes (for diagnostics) */
    get bufferedBytes(): number {
      return buffer.length;
    },
  };
}

// ─── Conversation ID Generator ──────────────────────────────────────────────

let _nextConvId = 1;

/**
 * Generate a unique conversation ID for request-response correlation.
 * Wraps at uint32 max. Never returns 0 (reserved for fire-and-forget).
 */
export function nextConvId(): number {
  const id = _nextConvId;
  _nextConvId = (_nextConvId + 1) & 0x7FFFFFFF;  // Stay positive, wrap at ~2B
  if (_nextConvId === 0) _nextConvId = 1;
  return id;
}
