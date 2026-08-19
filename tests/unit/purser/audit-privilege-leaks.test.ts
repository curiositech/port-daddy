// tests/unit/purser/audit-privilege-leaks.test.ts
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Simple ANSI escape sequence remover.
 * Handles common CSI sequences, including those used for color and cursor control.
 */
function stripAnsi(str: string): string {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /\x1B\[[0-?]*[ -/]*[@-~]/g,
    '',
  );
}

/**
 * Parses an asciicast (v2 or v3) and returns an object containing:
 * - header: the header object (v2 or v3)
 * - output: the concatenated raw output string (without ANSI)
 * - lines: array of output lines (split on '\n')
 *
 * The function is tolerant of malformed files; it throws a descriptive error on parse failure.
 */
function parseAsciicast(data: string) {
  const trimmed = data.trim();
  if (!trimmed) {
    throw new Error('Empty cast file');
  }

  // Determine format by inspecting first character
  const firstChar = trimmed[0];
  let header: any;
  let events: any[] = [];
  let offset = 0;

  if (firstChar === '{') {
    // v3: header JSON + NDJSON events
    const headerEnd = trimmed.indexOf('}\n');
    if (headerEnd === -1) {
      throw new Error('Invalid v3 header');
    }
    const headerStr = trimmed.slice(0, headerEnd + 1);
    header = JSON.parse(headerStr);
    const eventsStr = trimmed.slice(headerEnd + 2); // skip '}\n'
    const lines = eventsStr.split('\n').filter(Boolean);
    events = lines.map((line) => JSON.parse(line));
  } else {
    // v2: NDJSON header + events
    const lines = trimmed.split('\n').filter(Boolean);
    header = JSON.parse(lines[0]);
    events = lines.slice(1).map((line) => JSON.parse(line));
  }

  // Accumulate output
  const outputParts: string[] = [];
  for (const ev of events) {
    if (ev[1] === 'o') {
      const bytes = ev[2] as number[];
      const txt = Buffer.from(bytes).toString('utf8');
      outputParts.push(txt);
    }
  }
  const output = outputParts.join('');
  const lines = output.split('\n').map(stripAnsi);

  return { header, output, lines };
}

/**
 * Checks a single cast for:
 * - correct dimensions (100x28)
 * - absence of privilege leaks or error output
 * - absence of fabricated content (simple heuristic: no lines containing
 *   suspicious markers like 'CommandTerminal', 'TerminalDemos.tsx', or
 *   'gif:' etc.)
 */
function auditCast(filePath: string) {
  const data = readFileSync(filePath, 'utf8');
  let parsed: ReturnType<typeof parseAsciicast>;

  try {
    parsed = parseAsciicast(data);
  } catch (e: any) {
    return [
      {
        file: filePath,
        error: `Parse error: ${e.message}`,
      },
    ];
  }

  const { header, lines } = parsed;
  const issues: { file: string; message: string }[] = [];

  // Dimension check
  const width =
    header.width ??
    header.cols ??
    (header.term?.cols ?? header.term?.cols);
  const height =
    header.height ??
    header.rows ??
    (header.term?.rows ?? header.term?.rows);

  if (width !== 100 || height !== 28) {
    issues.push({
      file: filePath,
      message: `Incorrect dimensions: ${width}x${height} (expected 100x28)`,
    });
  }

  // Patterns to forbid
  const forbiddenPatterns = [
    /Unknown command/i,
    /✗/,
    /ERROR/i,
    /\/Users\//,
    /C:\\Users\\/,
    /home\/[^/]+/,
    /~\//,
    // fabricated content heuristics
    /CommandTerminal/i,
    /TerminalDemos\.tsx/i,
    /gif:/i,
    /Session started/i, // likely fabricated
  ];

  for (const line of lines) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line)) {
        issues.push({
          file: filePath,
          message: `Forbidden content matched '${pattern}': ${line.trim()}`,
        });
        break;
      }
    }
  }

  return issues;
}

describe('Privilege Leak and Error Audit', () => {
  const castDir = resolve(__dirname, '../../../website-v2/public/casts');
  const castFiles = readdirSync(castDir)
    .filter((f) => f.endsWith('.cast'))
    .map((f) => join(castDir, f));

  const allIssues: { file: string; message: string }[] = [];

  for (const file of castFiles) {
    const issues = auditCast(file);
    allIssues.push(...issues);
  }

  test('All casts are clean and correctly sized', () => {
    if (allIssues.length > 0) {
      const msg = allIssues
        .map((i) => `- ${i.file}: ${i.message}`)
        .join('\n');
      fail(`Audit failed with issues:\n${msg}`);
    }
  });
});