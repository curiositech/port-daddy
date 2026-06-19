/**
 * Unit Tests for Log Prefixer (log-prefix.js)
 *
 * Tests padding alignment, partial line buffering, color cycling,
 * and stderr dim styling.
 */

import { describe, it, expect } from '@jest/globals';
import { createPrefixer, getServiceColor } from '../../lib/log-prefix.js';
import { PassThrough } from 'node:stream';

/**
 * Helper: collect all output from a Transform stream
 */
function collectOutput(transform, input) {
  return new Promise((resolve) => {
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));

    if (Array.isArray(input)) {
      for (const chunk of input) {
        transform.write(chunk);
      }
    } else {
      transform.write(input);
    }
    transform.end();
  });
}

describe('Log Prefix Module', () => {
  describe('createPrefixer()', () => {
    it('should pad short names to match the longest name', async () => {
      const prefix = createPrefixer(['api', 'frontend']);
      const stream = prefix('api', 'stdout');
      const output = await collectOutput(stream, 'hello world\n');

      // "api" should be padded to 8 chars (length of "frontend")
      expect(output).toContain('api     ');
      expect(output).toContain('hello world');
    });

    it('should not pad when the service name is already the longest', async () => {
      const prefix = createPrefixer(['api', 'frontend']);
      const stream = prefix('frontend', 'stdout');
      const output = await collectOutput(stream, 'ready\n');

      expect(output).toContain('frontend');
      expect(output).toContain('ready');
    });

    it('should handle multiple lines in a single chunk', async () => {
      const prefix = createPrefixer(['svc']);
      const stream = prefix('svc', 'stdout');
      const output = await collectOutput(stream, 'line1\nline2\nline3\n');

      const lines = output.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('line1');
      expect(lines[1]).toContain('line2');
      expect(lines[2]).toContain('line3');
    });

    it('should buffer partial lines across multiple writes', async () => {
      const prefix = createPrefixer(['svc']);
      const stream = prefix('svc', 'stdout');
      const output = await collectOutput(stream, ['hel', 'lo w', 'orld\n']);

      const lines = output.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('hello world');
    });

    it('should flush remaining partial line on stream end', async () => {
      const prefix = createPrefixer(['svc']);
      const stream = prefix('svc', 'stdout');
      // No trailing newline — partial line
      const output = await collectOutput(stream, 'no newline');

      expect(output).toContain('no newline');
    });

    it('should skip empty lines', async () => {
      const prefix = createPrefixer(['svc']);
      const stream = prefix('svc', 'stdout');
      const output = await collectOutput(stream, 'first\n\nsecond\n');

      const lines = output.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('first');
      expect(lines[1]).toContain('second');
    });

    it('should apply dim styling for stderr', async () => {
      const prefix = createPrefixer(['svc']);
      const stream = prefix('svc', 'stderr');
      const output = await collectOutput(stream, 'warning\n');

      // DIM = \x1b[2m should appear in stderr output
      expect(output).toContain('\x1b[2m');
      expect(output).toContain('warning');
    });

    it('should NOT apply dim styling for stdout', async () => {
      const prefix = createPrefixer(['svc']);
      const stream = prefix('svc', 'stdout');
      const output = await collectOutput(stream, 'info\n');

      // Count occurrences of DIM — should not appear in the tag
      const dimInTag = output.indexOf('\x1b[2m');
      // DIM should not be present for stdout
      expect(dimInTag).toBe(-1);
    });

    it('should cycle colors for more than 10 services', async () => {
      const names = Array.from({ length: 12 }, (_, i) => `svc${i}`);
      const prefix = createPrefixer(names);

      // Service 0 and 10 should get the same color (cycle)
      const stream0 = prefix('svc0', 'stdout');
      const stream10 = prefix('svc10', 'stdout');

      const out0 = await collectOutput(stream0, 'test\n');
      const out10 = await collectOutput(stream10, 'test\n');

      // Extract the color code (first escape sequence)
      const colorPattern = /\x1b\[\d+m/;
      const color0 = out0.match(colorPattern)?.[0];
      const color10 = out10.match(colorPattern)?.[0];

      expect(color0).toBe(color10);
    });

    it('should handle Buffer input', async () => {
      const prefix = createPrefixer(['svc']);
      const stream = prefix('svc', 'stdout');
      const output = await collectOutput(stream, Buffer.from('buffer input\n'));

      expect(output).toContain('buffer input');
    });

    it('should include pipe separator', async () => {
      const prefix = createPrefixer(['svc']);
      const stream = prefix('svc', 'stdout');
      const output = await collectOutput(stream, 'test\n');

      expect(output).toContain('| ');
    });
  });

  describe('getServiceColor()', () => {
    it('should return consistent color for a service', () => {
      const names = ['api', 'frontend', 'worker'];
      const { color, reset } = getServiceColor(names, 'frontend');

      expect(color).toMatch(/\x1b\[\d+m/);
      expect(reset).toBe('\x1b[0m');
    });

    it('should return first color for unknown service', () => {
      const names = ['api'];
      const { color } = getServiceColor(names, 'unknown');
      const { color: firstColor } = getServiceColor(names, 'api');

      // Unknown gets fallback COLORS[0], same as index 0
      expect(color).toBe(firstColor);
    });

    it('should assign different colors to different services', () => {
      const names = ['api', 'frontend', 'worker'];
      const c1 = getServiceColor(names, 'api');
      const c2 = getServiceColor(names, 'frontend');
      const c3 = getServiceColor(names, 'worker');

      expect(c1.color).not.toBe(c2.color);
      expect(c2.color).not.toBe(c3.color);
    });
  });
});
