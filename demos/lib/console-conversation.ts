/**
 * Reusable "agent-conversation console" renderer for Port Daddy demo GIFs.
 *
 * This is the styling the multiplex demo introduced and that we are
 * standardizing across the GIF library: instead of recording raw `pd ...`
 * shell output, a demo narrates a SEMANTICALLY-COLORED conversation — actors
 * speak (▶), the bus/router answers (◀), refusals are red, successes green —
 * grouped into titled acts. It reads as a story, not a terminal dump.
 *
 * A demo `scenario.ts` imports these helpers, prints a sequence, and a VHS tape
 * records `bun demos/<name>/scenario.ts`. Keep FontSize >= 16 in every tape
 * (readable-font rule); these helpers never set sizes — the terminal/tape does.
 */

// ── palette (ANSI; renders under Catppuccin Mocha in VHS) ───────────────────
const sgr = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`;
// Multi-attribute helper: emits one SGR open + content + reset, so nesting
// bold(green(x)) doesn't leave bold half-painted after green's inner reset.
const sgr2 = (a: number, b: number, s: string) => `\x1b[${a};${b}m${s}\x1b[0m`;
export const dim = (s: string) => sgr(2, s);
export const bold = (s: string) => sgr(1, s);
export const cyan = (s: string) => sgr(36, s); // actor / outbound
export const green = (s: string) => sgr(32, s); // success / inbound-ok
export const red = (s: string) => sgr(31, s); // refusal / failure
export const yellow = (s: string) => sgr(33, s); // reason / warning
export const magenta = (s: string) => sgr(35, s); // channel names
export const blue = (s: string) => sgr(34, s);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ConsoleOptions {
  /** Delay after each printed line (ms). Tune so the GIF reads at human pace. */
  beat?: number;
}

/** A demo console: prints titled acts and colored actor/bus turns at a pace. */
export function makeConsole(opts: ConsoleOptions = {}) {
  const beat = opts.beat ?? 220;
  const line = async (s = '') => {
    console.log(s);
    await sleep(beat);
  };
  return {
    /** Big title + one-line subtitle. */
    async title(t: string, subtitle?: string) {
      await line(bold('  ' + t));
      if (subtitle) await line(dim('  ' + subtitle));
      await line('');
    },
    /** A numbered/badged act header (e.g. "① fan-out — ..."). */
    async act(badge: string, label: string, note?: string) {
      await line(bold(badge + ' ' + label) + (note ? dim('  — ' + note) : ''));
    },
    /** An actor speaking outbound on a channel. */
    async say(actor: string, channel: string, what: string, wire?: string) {
      await line(`${dim(actor)} ${cyan('▶')} ${what} ${dim('on ' + magenta(channel))}`);
      if (wire) await line(`  ${dim('pd tube ' + channel + ' --send')} ${dim(wire)}`);
    },
    /** The bus/router answering with success. */
    async ok(from: string, kind: string, detail?: string) {
      await line(`${dim(from)} ${green('◀ ' + kind)}${detail ? '  ' + detail : ''}`);
    },
    /** The bus/router refusing (loud). */
    async refuse(from: string, reason: string) {
      await line(`${dim(from)} ${red('◀ refused')}  ${yellow(reason)}`);
    },
    /** Plain dim narration. */
    async note(s: string) {
      await line(dim('   ' + s));
    },
    async blank() {
      await line('');
    },
    /** Closing banner. */
    async done(s: string, tail?: string) {
      // Use a single combined SGR (1;32 = bold+green) so the reset at the end
      // doesn't wipe bold before green's own reset fires (Copilot #3364881865).
      await line(sgr2(1, 32, '  ✓ ' + s) + (tail ? dim('  ' + tail) : ''));
    },
  };
}
