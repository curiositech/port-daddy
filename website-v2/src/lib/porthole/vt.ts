/**
 * Porthole VT interpreter — turns an asciicast byte stream into an
 * append-only transcript of styled terminal lines.
 *
 * Motivation: the site's old CLI demos were GIFs (`AUDIT-2026-08-18.md`
 * found 12 of 47 shipped errors or empty payoffs on camera, several
 * truncated past 18 lines, and one spliced two different sessions
 * together). `asciinema-player` was evaluated and disqualified for the
 * replacement — it renders into a fixed `cols×rows` viewport with pooled,
 * recycled row nodes, so scrollback (anything the terminal scrolled past)
 * is simply gone, which is the exact GIF failure this project exists to
 * fix. This module is a from-scratch VT (ECMA-48 / xterm subset)
 * interpreter that instead keeps every line it has ever produced, keyed by
 * absolute row index, so a session that prints 300 lines into a 28-row
 * terminal still has all 300 lines to scroll, select, and copy — a real
 * terminal's scrollback, not a fixed window onto the last screen.
 *
 * This file has NO DOM dependency on purpose: `PortholeEmbed.tsx` uses it
 * in the browser to drive a live player, and `scripts/check-porthole-casts.mjs`
 * imports the exact same `parseCast`/`VT` to replay every committed cast in
 * CI and assert it never shipped an error, an empty payoff, or a leaked
 * path — the two callers sharing one implementation is what makes the CI
 * gate trustworthy: it interprets bytes exactly the way a viewer's browser
 * will, not an approximation of it.
 *
 * Ported from the validated prototype at `demos/porthole/porthole.template.html`
 * (headless-Playwright verified in PR 7487: a 92-line transcript survives
 * scroll in a 28-row viewport). Behavior is unchanged; this port adds types,
 * splits cast-parsing from interpretation, and drops DOM rendering so the
 * class is reusable outside a browser.
 */

/** One character cell's visual style. `fg`/`bg` are resolved CSS color
 *  values (already through the theme palette), never raw ANSI indices —
 *  that resolution happens once in `sgr()`, not on every render. */
export interface CellStyle {
  fg: string | null;
  bg: string | null;
  b: boolean; // bold
  d: boolean; // dim
  i: boolean; // italic
  u: boolean; // underline
  inv: boolean; // inverse (fg/bg swapped)
}

/** One terminal character cell. */
export interface Cell {
  ch: string;
  st: CellStyle;
}

/** A single decoded terminal line: an ordered array of cells. Sparse in
 *  practice — a line is only as long as something was written to it. */
export type Line = Cell[];

/** Resolves a raw ANSI color slot (0-15 base palette, or a 256-color /
 *  truecolor index) to a CSS color value. Ported 1:1 from the validated
 *  prototype's `c256`; xterm's 6x6x6 color cube + 24-step grayscale ramp
 *  math, `THEME` supplies the 16-slot base palette. */
export function resolve256(n: number, theme: readonly string[]): string {
  if (n < 16) return theme[n];
  if (n < 232) {
    const idx = n - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return `rgb(${levels[(idx / 36) | 0]},${levels[((idx / 6) | 0) % 6]},${levels[idx % 6]})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

type ParserState = "n" | "e" | "c" | "o" | "oe" | "skip1" | "dcs" | "dcse";

/**
 * A single-session VT100/xterm-subset interpreter with unbounded
 * scrollback. Feed it raw PTY bytes (as asciicast `"o"` events do); it
 * maintains `lines[]` — every line ever produced, growing forever in
 * transcript mode. `dirty` names which absolute row indices changed on the
 * last `feed()` call, so a renderer only has to repaint what moved.
 *
 * Why scrollback survives alt-screen apps too: `enterAlt()`/`leaveAlt()`
 * mirror how real terminals swap to the "alternate screen" for full-UI
 * programs (vim, htop, lazygit) — output while alt-screen is active
 * overwrites a fixed region instead of scrolling. On exit, if that region
 * is blank (the app cleared its screen before quitting, e.g. btop/lazygit)
 * the block is dropped from the transcript entirely rather than leaving a
 * ghost blank block; if it isn't blank (vim quit while still showing
 * content) the last frame stays in the transcript as a legitimate
 * "screen" moment.
 */
export class VT {
  cols: number;
  rows: number;
  lines: Line[] = [[]];
  row = 0;
  col = 0;
  screenTop = 0;
  st: CellStyle;
  dirty = new Set<number>([0]);
  cursorVisible = true;
  private state: ParserState = "n";
  private buf = "";
  alt = false;
  private saved: { row: number; col: number; screenTop: number; st: CellStyle } | null = null;
  private savedCur: { row: number; col: number; st: CellStyle } | null = null;
  top = 0;
  bot: number | null = null;
  /** Set once if the stream ever entered the alternate screen — callers
   *  (the player) use this to decide default line-wrap behavior: wrapping
   *  a TUI's fixed grid is nonsense (PLAN.md's "never wrap a screen"
   *  rule), so a cast that ever touched alt-screen defaults to no-wrap. */
  sawAlt = false;
  private theme: readonly string[];

  constructor(cols: number, rows: number, theme: readonly string[]) {
    this.cols = cols;
    this.rows = rows || 28;
    this.theme = theme;
    this.st = this.baseStyle();
  }

  private regionBot(): number | null {
    return this.bot !== null ? this.bot : this.alt ? this.rows - 1 : null;
  }

  private lineFeed(): void {
    const b = this.regionBot();
    if (b !== null && this.row === this.screenTop + b) this.scrollUp(1);
    else {
      this.row++;
      this.line(this.row);
      this.dirty.add(this.row);
    }
  }

  private scrollUp(n: number): void {
    const a = this.screenTop + this.top;
    const b = this.screenTop + (this.regionBot() ?? this.rows - 1);
    this.line(b);
    for (let i = 0; i < n; i++) {
      this.lines.splice(a, 1);
      this.lines.splice(b, 0, []);
    }
    for (let r = a; r <= b; r++) this.dirty.add(r);
  }

  private scrollDown(n: number): void {
    const a = this.screenTop + this.top;
    const b = this.screenTop + (this.regionBot() ?? this.rows - 1);
    this.line(b);
    for (let i = 0; i < n; i++) {
      this.lines.splice(b, 1);
      this.lines.splice(a, 0, []);
    }
    for (let r = a; r <= b; r++) this.dirty.add(r);
  }

  private enterAlt(): void {
    this.sawAlt = true;
    if (this.alt) return;
    this.saved = { row: this.row, col: this.col, screenTop: this.screenTop, st: { ...this.st } };
    this.alt = true;
    this.screenTop = this.lines.length;
    this.row = this.screenTop;
    this.col = 0;
    this.top = 0;
    this.bot = null;
    this.line(this.screenTop + this.rows - 1);
    for (let r = this.screenTop; r < this.screenTop + this.rows; r++) this.dirty.add(r);
  }

  private leaveAlt(): void {
    if (!this.alt || !this.saved) return;
    const blockStart = this.screenTop;
    const blank = this.lines.slice(blockStart).every((L) => L.every((c) => c.ch === " "));
    if (blank) this.lines.length = blockStart;
    this.alt = false;
    this.top = 0;
    this.bot = null;
    this.row = this.saved.row;
    this.col = this.saved.col;
    this.screenTop = this.saved.screenTop;
    this.st = { ...this.saved.st };
    this.saved = null;
    if (blank) for (let r = blockStart; r < blockStart + this.rows; r++) this.dirty.add(r);
  }

  private baseStyle(): CellStyle {
    return { fg: null, bg: null, b: false, d: false, i: false, u: false, inv: false };
  }

  private line(r: number): Line {
    while (this.lines.length <= r) this.lines.push([]);
    return this.lines[r];
  }

  private put(ch: string): void {
    if (this.col >= this.cols) {
      this.lineFeed();
      this.col = 0;
    }
    const L = this.line(this.row);
    while (L.length < this.col) L.push({ ch: " ", st: this.baseStyle() });
    L[this.col] = { ch, st: { ...this.st } };
    this.col++;
    this.dirty.add(this.row);
  }

  /** Feed one asciicast `"o"` event's raw bytes through the interpreter,
   *  mutating `lines`/`dirty` in place. Call repeatedly as a player
   *  advances through a cast's timeline. */
  feed(data: string): void {
    for (const ch of data) {
      if (this.state === "n") {
        if (ch === "\x1b") this.state = "e";
        else if (ch === "\n") this.lineFeed();
        else if (ch === "\r") this.col = 0;
        else if (ch === "\b") this.col = Math.max(0, this.col - 1);
        else if (ch === "\t") this.col = (Math.floor(this.col / 8) + 1) * 8;
        else if (ch === "\x07" || ch < " ") {
          /* control char with no visual effect here — ignored */
        } else this.put(ch);
      } else if (this.state === "e") {
        if (ch === "[") {
          this.state = "c";
          this.buf = "";
        } else if (ch === "]") {
          this.state = "o";
          this.buf = "";
        } else if (ch === "(" || ch === ")") this.state = "skip1";
        else if (ch === "P" || ch === "^" || ch === "_") this.state = "dcs";
        else if (ch === "M") {
          if (this.row === this.screenTop + this.top) this.scrollDown(1);
          else this.row = Math.max(0, this.row - 1);
          this.state = "n";
        } else if (ch === "D") {
          this.lineFeed();
          this.state = "n";
        } else if (ch === "7") {
          this.savedCur = { row: this.row, col: this.col, st: { ...this.st } };
          this.state = "n";
        } else if (ch === "8") {
          if (this.savedCur) {
            this.row = this.savedCur.row;
            this.col = this.savedCur.col;
            this.st = { ...this.savedCur.st };
            this.line(this.row);
          }
          this.state = "n";
        } else this.state = "n";
      } else if (this.state === "skip1") this.state = "n";
      else if (this.state === "o") {
        if (ch === "\x07") this.state = "n";
        else if (ch === "\x1b") this.state = "oe";
        else this.buf += ch;
      } else if (this.state === "oe") this.state = ch === "\\" ? "n" : "o";
      else if (this.state === "dcs") {
        if (ch === "\x1b") this.state = "dcse";
      } else if (this.state === "dcse") this.state = ch === "\\" ? "n" : "dcs";
      else if (this.state === "c") {
        if (/[@-~]/.test(ch)) {
          this.csi(this.buf, ch);
          this.state = "n";
        } else this.buf += ch;
      }
    }
  }

  private csi(params: string, fin: string): void {
    const priv = params.startsWith("?");
    const p = (priv ? params.slice(1) : params).split(";").map((s) => (s === "" ? NaN : parseInt(s, 10)));
    const n = isNaN(p[0]) ? 1 : p[0];
    switch (fin) {
      case "m":
        this.sgr(params);
        break;
      case "A":
        this.row = Math.max(this.screenTop, this.row - n);
        break;
      case "B":
        this.row += n;
        this.line(this.row);
        break;
      case "C":
        this.col += n;
        break;
      case "D":
        this.col = Math.max(0, this.col - n);
        break;
      case "G":
        this.col = Math.max(0, n - 1);
        break;
      case "d":
        this.row = this.screenTop + Math.max(0, n - 1);
        this.line(this.row);
        break;
      case "H":
      case "f": {
        const r = isNaN(p[0]) ? 1 : p[0];
        const c = isNaN(p[1]) ? 1 : p[1];
        this.row = this.screenTop + r - 1;
        this.col = c - 1;
        this.line(this.row);
        this.dirty.add(this.row);
        break;
      }
      case "r": {
        const b0 = isNaN(p[0]) ? 1 : p[0];
        const b1 = isNaN(p[1]) ? this.rows : p[1];
        this.top = b0 - 1;
        this.bot = b1 - 1;
        this.row = this.screenTop;
        this.col = 0;
        break;
      }
      case "L": {
        const b = this.screenTop + (this.regionBot() ?? this.rows - 1);
        this.line(b);
        for (let i = 0; i < n; i++) {
          this.lines.splice(b, 1);
          this.lines.splice(this.row, 0, []);
        }
        for (let r = this.row; r <= b; r++) this.dirty.add(r);
        break;
      }
      case "M": {
        const b = this.screenTop + (this.regionBot() ?? this.rows - 1);
        this.line(b);
        for (let i = 0; i < n; i++) {
          this.lines.splice(this.row, 1);
          this.lines.splice(b, 0, []);
        }
        for (let r = this.row; r <= b; r++) this.dirty.add(r);
        break;
      }
      case "@": {
        const L = this.line(this.row);
        const blanks: Cell[] = Array.from({ length: n }, () => ({ ch: " ", st: this.baseStyle() }));
        while (L.length < this.col) L.push({ ch: " ", st: this.baseStyle() });
        L.splice(this.col, 0, ...blanks);
        L.length = Math.min(L.length, this.cols);
        this.dirty.add(this.row);
        break;
      }
      case "P": {
        const L = this.line(this.row);
        L.splice(this.col, n);
        this.dirty.add(this.row);
        break;
      }
      case "S":
        this.scrollUp(n);
        break;
      case "T":
        this.scrollDown(n);
        break;
      case "s":
        this.savedCur = { row: this.row, col: this.col, st: { ...this.st } };
        break;
      case "u":
        if (this.savedCur) {
          this.row = this.savedCur.row;
          this.col = this.savedCur.col;
          this.st = { ...this.savedCur.st };
          this.line(this.row);
        }
        break;
      case "J": {
        const mode = isNaN(p[0]) ? 0 : p[0];
        if ((mode === 2 || mode === 3) && this.alt) {
          for (let r = this.screenTop; r < this.screenTop + this.rows; r++) {
            this.lines[r] = [];
            this.dirty.add(r);
          }
          this.line(this.screenTop + this.rows - 1);
        } else if (mode === 2 || mode === 3) {
          this.screenTop = this.lines.length;
          this.row = this.screenTop;
          this.col = 0;
          this.line(this.row);
          this.dirty.add(this.row);
        } else if (mode === 0) {
          const L = this.line(this.row);
          L.length = Math.min(L.length, this.col);
          this.dirty.add(this.row);
          for (let r = this.row + 1; r < this.lines.length; r++) {
            this.lines[r] = [];
            this.dirty.add(r);
          }
        }
        break;
      }
      case "K": {
        const mode = isNaN(p[0]) ? 0 : p[0];
        const L = this.line(this.row);
        if (mode === 0) L.length = Math.min(L.length, this.col);
        else if (mode === 1) {
          for (let i = 0; i <= Math.min(this.col, L.length - 1); i++) L[i] = { ch: " ", st: this.baseStyle() };
        } else if (mode === 2) L.length = 0;
        this.dirty.add(this.row);
        break;
      }
      case "X": {
        const L = this.line(this.row);
        for (let i = 0; i < n; i++) if (L[this.col + i]) L[this.col + i] = { ch: " ", st: this.baseStyle() };
        this.dirty.add(this.row);
        break;
      }
      case "h":
        if (priv && p[0] === 25) this.cursorVisible = true;
        if (priv && (p[0] === 1049 || p[0] === 1047 || p[0] === 47)) this.enterAlt();
        break;
      case "l":
        if (priv && p[0] === 25) this.cursorVisible = false;
        if (priv && (p[0] === 1049 || p[0] === 1047 || p[0] === 47)) this.leaveAlt();
        break;
      default:
        break;
    }
  }

  private sgr(params: string): void {
    const p = params === "" ? [0] : params.split(";").map((s) => (s === "" ? 0 : parseInt(s, 10)));
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (v === 0) this.st = this.baseStyle();
      else if (v === 1) this.st.b = true;
      else if (v === 2) this.st.d = true;
      else if (v === 3) this.st.i = true;
      else if (v === 4) this.st.u = true;
      else if (v === 7) this.st.inv = true;
      else if (v === 22) {
        this.st.b = false;
        this.st.d = false;
      } else if (v === 23) this.st.i = false;
      else if (v === 24) this.st.u = false;
      else if (v === 27) this.st.inv = false;
      else if (v >= 30 && v <= 37) this.st.fg = this.theme[v - 30];
      else if (v === 38 && p[i + 1] === 5) {
        this.st.fg = resolve256(p[i + 2], this.theme);
        i += 2;
      } else if (v === 38 && p[i + 1] === 2) {
        this.st.fg = `rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`;
        i += 4;
      } else if (v === 39) this.st.fg = null;
      else if (v >= 40 && v <= 47) this.st.bg = this.theme[v - 40];
      else if (v === 48 && p[i + 1] === 5) {
        this.st.bg = resolve256(p[i + 2], this.theme);
        i += 2;
      } else if (v === 48 && p[i + 1] === 2) {
        this.st.bg = `rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`;
        i += 4;
      } else if (v === 49) this.st.bg = null;
      else if (v >= 90 && v <= 97) this.st.fg = this.theme[v - 90 + 8];
      else if (v >= 100 && v <= 107) this.st.bg = this.theme[v - 100 + 8];
    }
  }
}

/** A parsed asciicast: header dimensions plus a flat, absolute-clock event
 *  list. v2 timestamps are already absolute; v3's are deltas from the
 *  previous event — this is where that difference is normalized away so
 *  every downstream consumer (player, gate) only ever sees one shape. */
export interface CastJumpCut {
  /** Real asciicast clock immediately before/after the quiet interval. */
  sourceFrom: number;
  sourceTo: number;
  /** Compressed player-clock interval occupied by the broken axis. */
  displayFrom: number;
  displayTo: number;
  skippedSeconds: number;
}

export interface ParsedCast {
  cols: number;
  rows: number;
  /** Player-clock events. Long periods with no terminal output are
   *  compressed, never deleted: `jumpCuts` preserves the exact real span. */
  events: Array<[time: number, data: string]>;
  duration: number;
  /** Duration on the original recording clock, before jump-cut compression. */
  sourceDuration: number;
  jumpCuts: CastJumpCut[];
  /** Raw asciicast header, kept for provenance display (recorded date,
   *  version, terminal theme) — see `agent-visual-evidence-manifest`. */
  head: Record<string, unknown>;
}

/**
 * Parses an asciicast v2 or v3 text file into a flat, absolute-timed event
 * list. Both versions are NDJSON: line 1 is a header object, every
 * following line is `[time, "o"|"i"|"m"|"r", data]`. Only `"o"` (stdout)
 * events carry replayable bytes here — Porthole never captures `"i"`
 * (keystrokes) per its capture doctrine (PLAN.md: "Never pass `-I`" —
 * input is the one thing this format could leak that a screen recording
 * wouldn't, so the capture step refuses to record it in the first place).
 */
export function parseCast(text: string): ParsedCast {
  const lines = text.split("\n").filter((l) => l.trim());
  const head = JSON.parse(lines[0]) as Record<string, unknown> & {
    version?: number;
    width?: number;
    height?: number;
    term?: { cols?: number; rows?: number };
  };
  const v3 = head.version === 3;
  const cols = head.width || head.term?.cols || 100;
  const rows = head.height || head.term?.rows || 28;
  const sourceEvents: Array<[number, string]> = [];
  let clock = 0;
  for (let i = 1; i < lines.length; i++) {
    const [t, kind, data] = JSON.parse(lines[i]) as [number, string, string];
    // v3 deltas advance on EVERY event, including input/marker events that
    // Porthole intentionally does not replay. Advancing only for output
    // events subtly falsifies the wall clock whenever a recorder emitted a
    // marker between writes.
    clock = v3 ? clock + t : t;
    if (kind !== "o") continue;
    sourceEvents.push([clock, data]);
  }

  // A Porthole recording is evidence, not surveillance footage. Real waits
  // belong in the evidence clock, but forcing a viewer to sit through two
  // silent minutes adds no proof. Compress only genuinely long quiet spans
  // and expose each one as an explicit broken axis in the player.
  const QUIET_GAP_SECONDS = 15;
  const CUT_DISPLAY_SECONDS = 0.85;
  const events: Array<[number, string]> = [];
  const jumpCuts: CastJumpCut[] = [];
  let removed = 0;
  let previousSource = 0;
  for (const [sourceTime, data] of sourceEvents) {
    const gap = sourceTime - previousSource;
    if (gap > QUIET_GAP_SECONDS) {
      const displayFrom = previousSource - removed;
      const skippedSeconds = gap - CUT_DISPLAY_SECONDS;
      jumpCuts.push({
        sourceFrom: previousSource,
        sourceTo: sourceTime,
        displayFrom,
        displayTo: displayFrom + CUT_DISPLAY_SECONDS,
        skippedSeconds,
      });
      removed += skippedSeconds;
    }
    events.push([sourceTime - removed, data]);
    previousSource = sourceTime;
  }
  const sourceDuration = sourceEvents.length ? sourceEvents[sourceEvents.length - 1][0] : 0;
  const duration = events.length ? events[events.length - 1][0] : 0;
  return { cols, rows, events, duration, sourceDuration, jumpCuts, head };
}

/** Translate a point on Porthole's compact display clock back onto the
 * original recording clock. Inside a cut the value advances across the
 * real quiet span, which lets the UI show truthful timestamps while the
 * broken-axis animation remains short. */
export function sourceTimeAtDisplayTime(cast: ParsedCast, displayTime: number): number {
  let priorDisplay = 0;
  let priorSource = 0;
  for (const cut of cast.jumpCuts) {
    if (displayTime < cut.displayFrom) return priorSource + (displayTime - priorDisplay);
    if (displayTime <= cut.displayTo) {
      const ratio = (displayTime - cut.displayFrom) / Math.max(0.001, cut.displayTo - cut.displayFrom);
      return cut.sourceFrom + ratio * (cut.sourceTo - cut.sourceFrom);
    }
    priorDisplay = cut.displayTo;
    priorSource = cut.sourceTo;
  }
  return priorSource + (displayTime - priorDisplay);
}

/**
 * Replays an entire parsed cast through a fresh {@link VT} and returns the
 * settled transcript (every line, final state — no timing). This is the
 * shared "what would a human see" reconstruction: the gate
 * (`scripts/check-porthole-casts.mjs`) uses it to assert a committed cast
 * never shows an error/leak, and it is what a reduced-motion viewer jumps
 * straight to instead of animating (PLAN.md's edge-case list).
 */
export function replayToTranscript(cast: ParsedCast, theme: readonly string[]): { vt: VT; lines: Line[] } {
  const vt = new VT(cast.cols, cast.rows, theme);
  for (const [, data] of cast.events) vt.feed(data);
  return { vt, lines: vt.lines };
}

/** Flattens a transcript line to plain text (for copy-to-clipboard, or for
 *  the gate's text-based assertions — deliberately char-by-char rather than
 *  scanning raw event bytes, because the audit's #1 finding was that typed
 *  commands are char-split across events and every path/secret regex
 *  silently missed them when scanned that way). */
export function lineText(line: Line): string {
  return line.map((c) => c.ch).join("");
}
