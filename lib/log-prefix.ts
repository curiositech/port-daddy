/**
 * Log Prefixer -- docker-compose-style colored output for multi-service processes
 *
 * Each service gets a consistent color and padded name prefix.
 * Partial lines are buffered until a newline arrives.
 * stderr gets dim styling to visually separate it from stdout.
 */

import { Transform } from 'node:stream';

/**
 * ANSI color palette -- 10 distinct, readable terminal colors.
 * Avoids red (reserved for errors) and black/white (background conflicts).
 */
const COLORS = [
  '\x1b[36m',  // cyan
  '\x1b[33m',  // yellow
  '\x1b[35m',  // magenta
  '\x1b[32m',  // green
  '\x1b[34m',  // blue
  '\x1b[96m',  // bright cyan
  '\x1b[93m',  // bright yellow
  '\x1b[95m',  // bright magenta
  '\x1b[92m',  // bright green
  '\x1b[94m',  // bright blue
] as const;

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

type StreamType = 'stdout' | 'stderr';

/**
 * Create a prefixer factory for a set of service names.
 *
 * @param serviceNames - All service names (used for padding calculation)
 * @returns Factory that returns Transform streams
 */
export function createPrefixer(serviceNames: string[]): (name: string, streamType?: StreamType) => Transform {
  const maxLen = Math.max(...serviceNames.map(n => n.length));
  const colorMap = new Map<string, string>();

  serviceNames.forEach((name, i) => {
    colorMap.set(name, COLORS[i % COLORS.length]);
  });

  /**
   * Create a Transform stream that prefixes each line with the service name.
   */
  return function prefix(name: string, streamType: StreamType = 'stdout'): Transform {
    const color = colorMap.get(name) || COLORS[0];
    const pad = name.padEnd(maxLen);
    const dim = streamType === 'stderr' ? DIM : '';
    const tag = `${color}${pad}${RESET} ${dim}| `;
    const lineEnd = streamType === 'stderr' ? `${RESET}\n` : '\n';

    let buffer = '';

    return new Transform({
      // We receive Buffer chunks but emit strings
      decodeStrings: false,
      encoding: 'utf8',

      transform(chunk, _encoding, callback) {
        buffer += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');

        const lines = buffer.split('\n');
        // Last element is either '' (complete line) or a partial -- keep it in buffer
        buffer = lines.pop()!;

        for (const line of lines) {
          if (line.length > 0) {
            this.push(`${tag}${line}${lineEnd}`);
          }
        }
        callback();
      },

      flush(callback) {
        // Emit any remaining partial line on stream end
        if (buffer.length > 0) {
          this.push(`${tag}${buffer}${lineEnd}`);
          buffer = '';
        }
        callback();
      }
    });
  };
}

/**
 * Get the color assigned to a service name (useful for status messages).
 */
export function getServiceColor(serviceNames: string[], name: string): { color: string; reset: string } {
  const idx = serviceNames.indexOf(name);
  return {
    color: idx >= 0 ? COLORS[idx % COLORS.length] : COLORS[0],
    reset: RESET
  };
}
