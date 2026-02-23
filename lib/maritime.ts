/**
 * Port Daddy Maritime Module
 *
 * Nautical-themed agent coordination with signal flag rendering.
 * Because ports deserve proper maritime protocol.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *                            DESIGN SYSTEM
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * THREE VISUAL LAYERS:
 *
 * 1. SIGNAL FLAGS (Status Indicators)
 *    ┌─────────────────────────────────────────────────────────────────────────┐
 *    │ Flag         │ Meaning              │ Used For                          │
 *    ├─────────────────────────────────────────────────────────────────────────┤
 *    │ Charlie ▓▒░  │ Affirmative          │ Success, acquired, completed      │
 *    │ November ░▓░ │ Negative             │ Errors, failures                  │
 *    │ Kilo    ▓▓   │ Ready to communicate │ Listening, standby, ready         │
 *    │ Uniform ░▓   │ Danger ahead         │ Warnings, conflicts               │
 *    │ Victor  ╲╱   │ Require assistance   │ Mayday, help needed               │
 *    │ Lima    ▓░   │ Stop immediately     │ Stop, halt, blocked               │
 *    └─────────────────────────────────────────────────────────────────────────┘
 *
 * 2. CHANNEL TOKENS (scope:topic:qualifier)
 *    ┌─────────────────────────────────────────────────────────────────────────┐
 *    │ Position  │ Color  │ Semantic Meaning                                   │
 *    ├─────────────────────────────────────────────────────────────────────────┤
 *    │ scope     │ CYAN   │ The domain/category (sea = horizon blue-green)    │
 *    │ :         │ GRAY   │ Separators (dim, structural)                       │
 *    │ topic     │ YELLOW │ The subject (signal flag = attention)              │
 *    │ qualifier │ GREEN  │ The specificity (starboard = right/specific)       │
 *    └─────────────────────────────────────────────────────────────────────────┘
 *
 *    Example: bug:JIRA-123:war-room
 *             ^^^  ^^^^^^^  ^^^^^^^^
 *             cyan yellow   green
 *
 * 3. AGENT VOICES (Radio Messages)
 *    ┌─────────────────────────────────────────────────────────────────────────┐
 *    │ Signal     │ Color   │ Meaning                                          │
 *    ├─────────────────────────────────────────────────────────────────────────┤
 *    │ mayday     │ RED     │ EMERGENCY - life threatening situation           │
 *    │ pan-pan    │ YELLOW  │ URGENT - serious but not immediately dangerous   │
 *    │ securite   │ CYAN    │ SAFETY - navigational hazard or weather warning  │
 *    │ hail       │ GREEN   │ Announcing presence                              │
 *    │ roger      │ GREEN   │ Message received and understood                  │
 *    │ wilco      │ GREEN   │ Will comply                                      │
 *    │ report     │ WHITE   │ Sharing a finding (neutral information)          │
 *    │ over       │ GRAY    │ Finished, awaiting response                      │
 *    │ out        │ GRAY    │ Finished, no response expected                   │
 *    └─────────────────────────────────────────────────────────────────────────┘
 *
 *    Agent callsigns are BOLD, message content is standard weight.
 *    Timestamps are DIM GRAY.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// ANSI Escape Codes
// ─────────────────────────────────────────────────────────────────────────────

const ANSI = {
  reset: '\x1b[0m',
  // Backgrounds for signal flags
  bgBlue: '\x1b[44m',
  bgWhite: '\x1b[107m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlack: '\x1b[40m',
  // Foregrounds for text
  fgBlue: '\x1b[34m',
  fgYellow: '\x1b[33m',
  fgGreen: '\x1b[32m',
  fgCyan: '\x1b[36m',
  fgWhite: '\x1b[97m',
  fgGray: '\x1b[90m',
  fgRed: '\x1b[31m',
  fgMagenta: '\x1b[35m',
  // Text styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// Export ANSI for direct use
export { ANSI };

/**
 * Nautical signal flags rendered in ANSI
 *
 * Each flag is 3 chars wide × 2 lines tall for visibility
 */
export const SignalFlags = {
  /** Charlie (C) - Affirmative/Yes - Blue-White-Red-White-Blue horizontal */
  charlie: () => [
    `${ANSI.bgBlue} ${ANSI.bgWhite} ${ANSI.bgRed} ${ANSI.reset}`,
    `${ANSI.bgBlue} ${ANSI.bgWhite} ${ANSI.bgRed} ${ANSI.reset}`,
  ],

  /** November (N) - Negative/No - Blue-White checkerboard */
  november: () => [
    `${ANSI.bgBlue} ${ANSI.bgWhite} ${ANSI.bgBlue} ${ANSI.reset}`,
    `${ANSI.bgWhite} ${ANSI.bgBlue} ${ANSI.bgWhite} ${ANSI.reset}`,
  ],

  /** Kilo (K) - Ready to communicate - Yellow-Blue vertical split */
  kilo: () => [
    `${ANSI.bgYellow} ${ANSI.bgBlue}  ${ANSI.reset}`,
    `${ANSI.bgYellow} ${ANSI.bgBlue}  ${ANSI.reset}`,
  ],

  /** Uniform (U) - Danger ahead - Red-White quarters */
  uniform: () => [
    `${ANSI.bgRed} ${ANSI.bgWhite} ${ANSI.reset}`,
    `${ANSI.bgWhite} ${ANSI.bgRed} ${ANSI.reset}`,
  ],

  /** Victor (V) - Require assistance - White with red X */
  victor: () => [
    `${ANSI.bgWhite}${ANSI.fgRed}╲${ANSI.bgRed} ${ANSI.bgWhite}╱${ANSI.reset}`,
    `${ANSI.bgWhite}${ANSI.fgRed}╱${ANSI.bgRed} ${ANSI.bgWhite}╲${ANSI.reset}`,
  ],

  /** Lima (L) - Stop immediately - Yellow-Black quarters */
  lima: () => [
    `${ANSI.bgYellow} ${ANSI.bgBlack} ${ANSI.reset}`,
    `${ANSI.bgBlack} ${ANSI.bgYellow} ${ANSI.reset}`,
  ],

  /** Alpha (A) - Diver down - White-Blue swallowtail */
  alpha: () => [
    `${ANSI.bgWhite} ${ANSI.bgBlue}▶${ANSI.reset}`,
    `${ANSI.bgWhite} ${ANSI.bgBlue}▶${ANSI.reset}`,
  ],

  /** Bravo (B) - Dangerous cargo - Red swallowtail */
  bravo: () => [
    `${ANSI.bgRed}  ▶${ANSI.reset}`,
    `${ANSI.bgRed}  ▶${ANSI.reset}`,
  ],
};

export type FlagName = keyof typeof SignalFlags;

/**
 * Render a signal flag inline (single line, compact)
 */
export function flag(name: FlagName): string {
  const lines = SignalFlags[name]();
  return lines[0]; // Just top row for inline use
}

/**
 * Render a signal flag block (2 lines, full)
 */
export function flagBlock(name: FlagName): string {
  return SignalFlags[name]().join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel Syntax Highlighting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Highlight a channel name with nautical colors
 *
 * scope:topic:qualifier becomes:
 *   scope  = cyan (like the sea)
 *   :      = dim gray
 *   topic  = yellow (like signal flags)
 *   qualifier = green (starboard)
 */
export function highlightChannel(channel: string): string {
  const parts = channel.split(':');
  if (parts.length === 1) {
    return `${ANSI.fgCyan}${channel}${ANSI.reset}`;
  }

  const colors = [ANSI.fgCyan, ANSI.fgYellow, ANSI.fgGreen];
  const separator = `${ANSI.fgGray}:${ANSI.reset}`;

  return parts
    .map((part, i) => `${colors[Math.min(i, colors.length - 1)]}${part}${ANSI.reset}`)
    .join(separator);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Voice Coloring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent color palette - distinct colors for different agents
 * Based on a simple hash of the agent ID for consistency
 */
const AGENT_COLORS = [
  ANSI.fgCyan,
  ANSI.fgMagenta,
  ANSI.fgYellow,
  ANSI.fgGreen,
  ANSI.fgBlue,
  ANSI.fgRed,
];

/**
 * Get a consistent color for an agent based on their callsign
 */
export function agentColor(callsign: string): string {
  // Simple hash: sum of char codes mod color count
  const hash = callsign.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AGENT_COLORS[hash % AGENT_COLORS.length];
}

/**
 * Format an agent callsign with color and bold
 */
export function formatCallsign(callsign: string): string {
  return `${ANSI.bold}${agentColor(callsign)}${callsign}${ANSI.reset}`;
}

/**
 * Get the color for a signal type
 */
export function signalColor(signal: SignalType): string {
  switch (signal) {
    case 'mayday':
      return ANSI.fgRed;
    case 'pan-pan':
      return ANSI.fgYellow;
    case 'securite':
      return ANSI.fgCyan;
    case 'hail':
    case 'roger':
    case 'wilco':
      return ANSI.fgGreen;
    case 'report':
      return ANSI.fgWhite;
    case 'over':
    case 'out':
      return ANSI.fgGray;
    default:
      return ANSI.fgWhite;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Maritime Message Types
// ─────────────────────────────────────────────────────────────────────────────

export type SignalType =
  | 'hail'      // Announcing presence (like hailing another ship)
  | 'report'   // Sharing a finding/observation
  | 'mayday'   // Urgent help needed
  | 'pan-pan'  // Urgent but not life-threatening
  | 'securite' // Safety information
  | 'roger'    // Acknowledged
  | 'wilco'    // Will comply
  | 'over'     // Finished transmitting, awaiting response
  | 'out';     // Finished transmitting, no response expected

export interface RadioMessage<T = Record<string, unknown>> {
  callsign: string;      // Agent identifier (like a ship's callsign)
  signal: SignalType;
  message: string;
  payload?: T;
  replyTo?: string;
  timestamp: number;
}

/**
 * Get the appropriate signal flag for a message type
 */
export function signalToFlag(signal: SignalType): FlagName {
  switch (signal) {
    case 'hail':
    case 'roger':
    case 'wilco':
      return 'charlie';  // Affirmative

    case 'report':
    case 'securite':
      return 'kilo';     // Ready to communicate

    case 'mayday':
      return 'victor';   // Require assistance

    case 'pan-pan':
      return 'uniform';  // Danger

    case 'over':
    case 'out':
      return 'alpha';    // Operations in progress

    default:
      return 'kilo';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatted Output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a radio message for terminal display
 *
 * Uses the design system:
 * - Signal flag indicates message type
 * - Timestamp is dim gray
 * - Agent callsign is bold with consistent color
 * - Signal type is colored by urgency
 * - Message content is standard weight
 */
export function formatRadioMessage(msg: RadioMessage): string {
  const flagChar = flag(signalToFlag(msg.signal));
  const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const sigColor = signalColor(msg.signal);
  const callsignFormatted = formatCallsign(msg.callsign);

  return [
    `${flagChar} ${ANSI.dim}[${time}]${ANSI.reset}`,
    callsignFormatted,
    `${sigColor}${msg.signal.toUpperCase()}${ANSI.reset}: ${msg.message}`,
  ].join(' ');
}

/**
 * Format a status line with signal flag
 */
export function status(
  type: 'success' | 'error' | 'ready' | 'warning' | 'help' | 'stop',
  message: string
): string {
  const flagMap: Record<string, FlagName> = {
    success: 'charlie',
    error: 'november',
    ready: 'kilo',
    warning: 'uniform',
    help: 'victor',
    stop: 'lima',
  };

  const colorMap: Record<string, string> = {
    success: ANSI.fgGreen,
    error: ANSI.fgRed,
    ready: ANSI.fgCyan,
    warning: ANSI.fgYellow,
    help: ANSI.fgRed,
    stop: ANSI.fgYellow,
  };

  return `${flag(flagMap[type])} ${colorMap[type]}${message}${ANSI.reset}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel Naming (Maritime Style)
// ─────────────────────────────────────────────────────────────────────────────

export const Frequencies = {
  /** Distress channel for a specific incident */
  distress: (incident: string) => `mayday:${incident}:all-stations`,

  /** Bridge channel for coordination */
  bridge: (project: string) => `bridge:${project}:helm`,

  /** Ship-to-ship for specific agents */
  shipToShip: (from: string, to: string) => `s2s:${from}:${to}`,

  /** Broadcast to all agents in a project */
  broadcast: (project: string) => `broadcast:${project}:all`,

  /** Watch channel for a file */
  watch: (file: string) => `watch:${file.replace(/\//g, '-')}:edits`,

  /** Log channel for persistent records */
  log: (project: string) => `log:${project}:entries`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Demo / Test
// ─────────────────────────────────────────────────────────────────────────────

export function demo(): void {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              MARITIME SIGNAL FLAGS                            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const flags: Array<[FlagName, string, string]> = [
    ['charlie', 'Charlie (C)', 'Affirmative / Success'],
    ['november', 'November (N)', 'Negative / Error'],
    ['kilo', 'Kilo (K)', 'Ready to Communicate'],
    ['uniform', 'Uniform (U)', 'Danger / Warning'],
    ['victor', 'Victor (V)', 'Require Assistance'],
    ['lima', 'Lima (L)', 'Stop Immediately'],
  ];

  for (const [name, letter, meaning] of flags) {
    const lines = SignalFlags[name]();
    console.log(`  ${lines[0]}  ${ANSI.bold}${letter}${ANSI.reset} — ${meaning}`);
    console.log(`  ${lines[1]}`);
    console.log('');
  }

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              CHANNEL HIGHLIGHTING                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const channels = [
    'mayday:incident-42:all-stations',
    'bridge:myapp:helm',
    'watch:src-api-users:edits',
    's2s:agent-alpha:agent-bravo',
  ];

  for (const ch of channels) {
    console.log(`  ${highlightChannel(ch)}`);
  }

  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              STATUS MESSAGES                                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log(`  ${status('success', 'File claimed successfully')}`);
  console.log(`  ${status('error', 'Lock acquisition failed')}`);
  console.log(`  ${status('ready', 'Agent standing by')}`);
  console.log(`  ${status('warning', 'Conflict detected on src/api/users.ts')}`);
  console.log(`  ${status('help', 'MAYDAY: Unhandled exception in production')}`);
  console.log(`  ${status('stop', 'Deployment halted - tests failing')}`);

  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              RADIO TRAFFIC                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const messages: RadioMessage[] = [
    { callsign: 'AGENT-ALPHA', signal: 'hail', message: 'Joining bridge, standing by for tasking', timestamp: Date.now() - 5000 },
    { callsign: 'AGENT-BRAVO', signal: 'report', message: 'Found null pointer in auth.ts:42', timestamp: Date.now() - 3000 },
    { callsign: 'AGENT-ALPHA', signal: 'roger', message: 'Investigating auth.ts', timestamp: Date.now() - 2000 },
    { callsign: 'AGENT-CHARLIE', signal: 'pan-pan', message: 'Test suite failing, need review', timestamp: Date.now() - 1000 },
  ];

  for (const msg of messages) {
    console.log(`  ${formatRadioMessage(msg)}`);
  }

  console.log('');
}

// Run demo if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demo();
}
