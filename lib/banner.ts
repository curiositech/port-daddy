/**
 * Port Daddy ASCII Art Banner
 *
 * Nautical-themed startup banner for the daemon.
 */

import { ANSI } from './maritime.js';

// Re-export ANSI for consumers
export { ANSI };

/**
 * Main Port Daddy banner - displayed on daemon start
 * Stacked "Port" over "Daddy" in blocky 3D style
 */
export const BANNER = `
${ANSI.fgCyan}${ANSI.bold} ███████████                      █████
▒▒███▒▒▒▒▒███                    ▒▒███
 ▒███    ▒███  ██████  ████████  ███████
 ▒██████████  ███▒▒███▒▒███▒▒███▒▒▒███▒
 ▒███▒▒▒▒▒▒  ▒███ ▒███ ▒███ ▒▒▒   ▒███
 ▒███        ▒███ ▒███ ▒███       ▒███ ███
 █████       ▒▒██████  █████      ▒▒█████
▒▒▒▒▒         ▒▒▒▒▒▒  ▒▒▒▒▒        ▒▒▒▒▒
 ██████████                 █████     █████
▒▒███▒▒▒▒███               ▒▒███     ▒▒███
 ▒███   ▒▒███  ██████    ███████   ███████  █████ ████
 ▒███    ▒███ ▒▒▒▒▒███  ███▒▒███  ███▒▒███ ▒▒███ ▒███
 ▒███    ▒███  ███████ ▒███ ▒███ ▒███ ▒███  ▒███ ▒███
 ▒███    ███  ███▒▒███ ▒███ ▒███ ▒███ ▒███  ▒███ ▒███
 ██████████  ▒▒████████▒▒████████▒▒████████ ▒▒███████
▒▒▒▒▒▒▒▒▒▒    ▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒   ▒▒▒▒▒███
                                             ███ ▒███
                                            ▒▒██████
                                             ▒▒▒▒▒▒   ${ANSI.reset}`;

/**
 * Compact banner for tight spaces
 */
export const BANNER_COMPACT = `${ANSI.fgCyan}${ANSI.bold}PORT DADDY${ANSI.reset}`;

/**
 * Tagline shown under the banner
 */
export const TAGLINE = `${ANSI.fgGray}Your ports. My rules. Zero conflicts.${ANSI.reset}`;

/**
 * Ship wheel decoration
 */
export const WHEEL = `${ANSI.fgCyan}⎈${ANSI.reset}`;

/**
 * Anchor decoration
 */
export const ANCHOR = `${ANSI.fgBlue}⚓${ANSI.reset}`;

/**
 * Wave decoration
 */
export const WAVE = `${ANSI.fgCyan}≋${ANSI.reset}`;

/**
 * Skull emoji for dead agents
 */
export const SKULL = '☠️';

/**
 * Jolly Roger Braille art - displayed when salvage finds dead agents
 */
export const JOLLY_ROGER = `${ANSI.fgCyan}
⠀⠀⠀⠀⠀⢀⣤⣶⣾⣿⣿⣿⣷⣶⣤⡀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆⠀⠀⠀⠀
⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀
⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡏⠀⠀⠀⠀
⠀⠀⠀⠀⢰⡟⠛⠉⠙⢻⣿⡟⠋⠉⠙⢻⡇⠀⠀⠀⠀
⠀⠀⠀⠀⢸⣷⣀⣀⣠⣾⠛⣷⣄⣀⣀⣼⡏⠀⠀⠀⠀
⠀⠀⣀⠀⠀⠛⠋⢻⣿⣧⣤⣸⣿⡟⠙⠛⠀⠀⣀⠀⠀
⢀⣰⣿⣦⠀⠀⠀⠼⣿⣿⣿⣿⣿⡷⠀⠀⠀⣰⣿⣆⡀
⢻⣿⣿⣿⣧⣄⠀⠀⠁⠉⠉⠋⠈⠀⠀⣀⣴⣿⣿⣿⡿
⠀⠀⠀⠈⠙⠻⣿⣶⣄⡀⠀⢀⣠⣴⣿⠿⠛⠉⠁⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠉⣻⣿⣷⣿⣟⠉⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢀⣠⣴⣿⠿⠋⠉⠙⠿⣷⣦⣄⡀⠀⠀⠀⠀
⣴⣶⣶⣾⡿⠟⠋⠀⠀⠀⠀⠀⠀⠀⠙⠻⣿⣷⣶⣶⣦
⠙⢻⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⡿⠋
⠀⠀⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠀⠀
${ANSI.reset}`;

/**
 * Compact jolly roger for inline use
 */
export const JOLLY_ROGER_COMPACT = `${ANSI.fgRed}☠${ANSI.reset}`;

/**
 * Print the full startup banner
 */
export function printBanner(): void {
  console.log(BANNER);
  console.log(`  ${TAGLINE}`);
  console.log('');
}

/**
 * Print a compact header with decorations
 */
export function printCompactHeader(title: string): void {
  const line = `${ANSI.fgGray}${'─'.repeat(40)}${ANSI.reset}`;
  console.log('');
  console.log(line);
  console.log(`  ${WHEEL} ${ANSI.fgCyan}${ANSI.bold}${title}${ANSI.reset}`);
  console.log(line);
  console.log('');
}

/**
 * Print a section divider
 */
export function printDivider(): void {
  console.log(`${ANSI.fgGray}${'─'.repeat(50)}${ANSI.reset}`);
}

/**
 * Format a port assignment announcement
 */
export function announcePort(service: string, port: number): string {
  return `  ${ANCHOR} ${ANSI.fgYellow}${service}${ANSI.reset} ${ANSI.fgGray}→${ANSI.reset} ${ANSI.fgGreen}${ANSI.bold}${port}${ANSI.reset}`;
}

/**
 * Format a service status line
 */
export function serviceStatus(name: string, status: 'up' | 'down' | 'starting' | 'stopping'): string {
  const statusMap = {
    up: `${ANSI.fgGreen}● UP${ANSI.reset}`,
    down: `${ANSI.fgRed}○ DOWN${ANSI.reset}`,
    starting: `${ANSI.fgYellow}◐ STARTING${ANSI.reset}`,
    stopping: `${ANSI.fgYellow}◑ STOPPING${ANSI.reset}`,
  };
  return `  ${name.padEnd(20)} ${statusMap[status]}`;
}

/**
 * Print daemon startup info block
 */
export function printStartupInfo(opts: {
  port: number;
  pid: number;
  version: string;
  hash: string;
}): void {
  console.log(`  ${ANSI.fgGray}Port:${ANSI.reset}    ${ANSI.fgCyan}${opts.port}${ANSI.reset}`);
  console.log(`  ${ANSI.fgGray}PID:${ANSI.reset}     ${opts.pid}`);
  console.log(`  ${ANSI.fgGray}Version:${ANSI.reset} ${opts.version}`);
  console.log(`  ${ANSI.fgGray}Hash:${ANSI.reset}    ${opts.hash}`);
  console.log('');
}

/**
 * Print a farewell message
 */
export function printFarewell(): void {
  console.log('');
  console.log(`  ${ANCHOR} ${ANSI.fgCyan}Fair winds and following seas!${ANSI.reset}`);
  console.log('');
}
