/**
 * Port Daddy Maritime Signals
 * ─────────────────────────────────────────────────────────────────────────────
 * Canonical mapping between Port Daddy coordination states and the
 * International Code of Signals (ICS) single-letter flag alphabet.
 * Single source of truth — every PD surface that renders a coordination
 * state must come through here.
 */

import { ANSI } from './maritime.js';

export type SignalCode =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

export type CoordinationState =
  | 'claim-active' | 'claim-stale' | 'awaiting-human' | 'burning-cash'
  | 'conflict' | 'blocked' | 'idle' | 'spawning' | 'fleet-healthy'
  | 'mayday' | 'inform' | 'request' | 'refuse' | 'affirmative';

// Mapping rationale (research-pass refinement, 2026-05-06):
//   awaiting-human → F, not K — F is "I am disabled; communicate with me"
//                                K is "I wish to communicate" (general channel-open) → request
//   blocked        → D, not F — D is "maneuvering with difficulty" (creds/auth)
//                                F is hard-disabled (awaiting-human)
//   conflict       → V, not D — V is "I require assistance" (arbitration)
//   spawning       → A, not P — A is "diver down, keep clear" (vulnerable boot window)
//                                P is "Blue Peter, ready to sail" → fleet-healthy
//   mayday         → J        — J is "on fire + dangerous cargo" (operational disaster)
//   inform         → R        — Port Daddy uses the procedure signal "Received" as an
//                                acknowledgement. R has no 1969 single-letter meaning.
//   burning-cash   → B, not U — B is "carrying dangerous cargo" (hazardous spend)
export const SIGNAL_FOR_STATE: Record<CoordinationState, SignalCode> = {
  'claim-active': 'H', 'claim-stale': 'Y', 'awaiting-human': 'F',
  'burning-cash': 'B', 'conflict': 'V', 'blocked': 'D', 'idle': 'M',
  'spawning': 'A', 'fleet-healthy': 'P', 'mayday': 'J',
  'inform': 'R', 'request': 'K', 'refuse': 'N', 'affirmative': 'C',
};

export const STATE_FOR_SIGNAL: Partial<Record<SignalCode, CoordinationState>> = {
  H: 'claim-active', Y: 'claim-stale', F: 'awaiting-human', B: 'burning-cash',
  V: 'conflict', D: 'blocked', M: 'idle', A: 'spawning', P: 'fleet-healthy',
  J: 'mayday', R: 'inform', K: 'request', N: 'refuse', C: 'affirmative',
};

export function signalFor(state: CoordinationState): SignalCode {
  const code = SIGNAL_FOR_STATE[state];
  if (!code) {
    throw new Error(
      `[maritime-signals] unknown coordination state: ${String(state)}. ` +
        `Known states: ${Object.keys(SIGNAL_FOR_STATE).join(', ')}`,
    );
  }
  return code;
}

export function stateFor(signal: SignalCode): CoordinationState | undefined {
  return STATE_FOR_SIGNAL[signal];
}

export const ICS_MEANING: Record<SignalCode, string> = {
  A: 'I have a diver down; keep well clear at slow speed',
  B: 'I am taking in, discharging, or carrying dangerous cargo',
  C: 'Affirmative / yes',
  D: 'Keep clear of me; I am maneuvering with difficulty',
  E: 'I am altering my course to starboard',
  F: 'I am disabled; communicate with me',
  G: 'I require a pilot',
  H: 'I have a pilot on board',
  I: 'I am altering my course to port',
  J: 'I am on fire and have dangerous cargo on board; keep well clear',
  K: 'I wish to communicate with you',
  L: 'You should stop your vessel instantly',
  M: 'My vessel is stopped and making no way through the water',
  N: 'Negative / no',
  O: 'Man overboard',
  P: 'Blue Peter — about to put to sea (in harbor); nets caught (at sea, fishing)',
  Q: 'My vessel is healthy and I request free pratique',
  R: 'No 1969 single-letter meaning; procedure signal: Received',
  S: 'I am operating astern propulsion',
  T: 'Keep clear of me; I am engaged in pair trawling',
  U: 'You are running into danger',
  V: 'I require assistance',
  W: 'I require medical assistance',
  X: 'Stop carrying out your intentions and watch for my signals',
  Y: 'I am dragging my anchor',
  Z: 'I require a tug',
};

export const NATO_PHONETIC: Record<SignalCode, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo',
  F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett',
  K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar',
  P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango',
  U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};

export const SIGNAL_ANSI: Record<SignalCode, string> = {
  // Green — success / healthy
  C: ANSI.fgGreen, H: ANSI.fgGreen, P: ANSI.fgGreen, Q: ANSI.fgGreen,
  // Yellow — caution / advisory
  K: ANSI.fgYellow, M: ANSI.fgYellow, U: ANSI.fgYellow, Y: ANSI.fgYellow,
  // Red — alert / negative / danger
  D: ANSI.fgRed, F: ANSI.fgRed, N: ANSI.fgRed, O: ANSI.fgRed,
  V: ANSI.fgRed, W: ANSI.fgRed, X: ANSI.fgRed,
  // Blue — informational / nav-state
  E: ANSI.fgBlue, I: ANSI.fgBlue, R: ANSI.fgBlue, S: ANSI.fgBlue,
  // Magenta — domain-specific signaling
  G: ANSI.fgMagenta, J: ANSI.fgMagenta,
  // Gray — neutral / structural
  A: ANSI.fgGray, B: ANSI.fgGray, L: ANSI.fgGray, T: ANSI.fgGray, Z: ANSI.fgGray,
};

export function formatSignal(state: CoordinationState): string {
  return `[${signalFor(state)}] ${state}`;
}

export function colorize(state: CoordinationState, label?: string): string {
  const letter = signalFor(state);
  const color = SIGNAL_ANSI[letter];
  const text = label !== undefined ? label : state;
  return `${color}[${letter}] ${text}${ANSI.reset}`;
}

// Hoists are multi-flag combinations carrying composite meaning. Note
// that K-1 currently uses letters-only (SignalCode is 'A'..'Z'); the '1'
// is described in `meaning`. Widening SignalCode to include numeric
// pennants is the proper fix if downstream consumers need them.
export const HOISTS: Record<string, { letters: SignalCode[]; meaning: string }> = {
  'K-1': { letters: ['K'], meaning: 'I want to communicate about subject 1 — pd ask --topic' },
  'U-Y': { letters: ['U', 'Y'], meaning: 'Running into danger, dragging anchor — cap proximity + claim stale on same actor' },
  'P-Q': { letters: ['P', 'Q'], meaning: 'About to put to sea, vessel healthy — fleet-up sequence' },
  'D-V': { letters: ['D', 'V'], meaning: 'Maneuvering with difficulty, require assistance — conflict + need-human escalation' },
  'F-G': { letters: ['F', 'G'], meaning: 'Disabled, require pilot — blocked + auto-spawn-fix-it' },
  'O-W': { letters: ['O', 'W'], meaning: 'Man overboard, require medical — agent crashed + mayday' },
};
