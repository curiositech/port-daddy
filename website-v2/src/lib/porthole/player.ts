/**
 * Porthole player — mounts a scrubbable, real-DOM-text terminal replay
 * into a container element.
 *
 * Motivation: this is the "why bother" of the whole project made concrete.
 * A GIF is pixels: you cannot select a command out of it, it cannot scroll
 * past however many frames it was baked with, and a viewer has no way to
 * tell a real session from a hand-typed fiction. This player instead
 * renders each terminal line as a real `<div>` of real `<span>`s — visible
 * proof is `::selection` working and a hover-to-copy affordance per line —
 * built from the same {@link VT} interpreter the CI gate replays, so what
 * a viewer sees here is provably the bytes the recorder captured.
 *
 * Kept as a plain, framework-agnostic class (imperative DOM, its own
 * `requestAnimationFrame` clock) rather than idiomatic React state, on
 * purpose: this logic is a direct, behavior-preserving port of the
 * prototype validated headless via Playwright in PR 7487 (a 92-line
 * transcript survives scroll in a 28-row viewport). Re-deriving it as
 * React reconciliation risked introducing new bugs in the one thing this
 * project's entire premise is that it must never get wrong — the replay
 * has to be faithful to the captured bytes, not merely convenient to write.
 * `PortholeEmbed.tsx` is the thin React lifecycle wrapper around this class,
 * the same pattern React's own docs recommend for wrapping non-React
 * widgets (video players, map libraries, D3).
 */
import { VT, parseCast, sourceTimeAtDisplayTime, type CastJumpCut, type ParsedCast } from "./vt";
import { PORTHOLE_ANSI_THEME } from "./theme";

export interface PortholePlayerOptions {
  /** Reduced-motion viewers get the final transcript immediately, no
   *  playback clock, no autoplay — "jump to final transcript" per the
   *  plan's accessibility edge case. */
  reducedMotion?: boolean;
  /** Start playing as soon as a cast loads. The React wrapper only sets
   *  this once the embed has actually scrolled into view. */
  autoplay?: boolean;
}

const SPEEDS = [0.25, 0.5, 1, 2] as const;

/** Escapes the two characters that matter inside a `style="color:...">text`
 *  span: `&` (so an already-escaped entity in captured output can't
 *  double-decode) and `<` (so captured output can never inject markup —
 *  recorded PTY bytes are attacker-adjacent the moment a session records
 *  anything derived from an issue title, a filename, or pasted input). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function styleSpan(st: { fg: string | null; bg: string | null; b: boolean; d: boolean; i: boolean; u: boolean; inv: boolean }): string {
  let fg = st.fg || "var(--ph-text)";
  let bg = st.bg;
  if (st.inv) {
    const t = fg;
    fg = bg || "var(--ph-bg)";
    bg = t;
  }
  let s = `color:${fg};`;
  if (bg) s += `background:${bg};`;
  if (st.b) s += "font-weight:700;";
  if (st.d) s += "opacity:0.6;";
  if (st.i) s += "font-style:italic;";
  if (st.u) s += "text-decoration:underline;";
  return s;
}

type PortholeSemantic = "anchor" | "hook" | "error";

function markSemantic(text: string, pattern: RegExp, kind: PortholeSemantic, at: Array<Set<PortholeSemantic>>): void {
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    for (let index = start; index < end && index < at.length; index++) at[index].add(kind);
  }
}

/**
 * Terminal bytes retain their ANSI styling, but the proof viewer adds a small
 * semantic layer around high-value evidence: durable session/agent anchors,
 * injected harness context, and actual command refusals. This is deliberately
 * text-derived rather than a parallel transcript so capture fidelity remains
 * inspectable and selectable.
 */
function semanticCells(text: string): Array<Set<PortholeSemantic>> {
  const at = Array.from({ length: text.length }, () => new Set<PortholeSemantic>());
  markSemantic(text, /\b(?:session|agent)-[a-z0-9-]+\b|\b[a-z0-9-]+:[a-z0-9-]+(?::[a-z0-9-]+){0,2}\b/gi, "anchor", at);
  markSemantic(text, /HARNESSED CONTEXT|PORT DADDY HARNESS|MODEL SEES THIS|UserPromptSubmit\.additionalContext/gi, "hook", at);
  markSemantic(text, /\b(?:REFUSED|ERROR|failed|denied|unhealthy)\b|Lock '[^']+' is held by/gi, "error", at);
  return at;
}

/**
 * One mounted Porthole instance. `new PortholePlayer(root, opts)` builds
 * its DOM inside `root`; call `load(url)` to fetch, parse, and (unless
 * reduced-motion) start replaying a cast; call `destroy()` to tear down
 * timers/observers when the embed unmounts.
 */
export class PortholePlayer {
  private root: HTMLElement;
  private opts: PortholePlayerOptions;
  private term!: HTMLElement;
  private els: { play: HTMLButtonElement; restart: HTMLButtonElement; time: HTMLElement; fill: HTMLElement; seek: HTMLElement; cuts: HTMLElement; cutNotice: HTMLElement; wrapBtn: HTMLButtonElement; copyAll: HTMLButtonElement; resume: HTMLButtonElement; toast: HTMLElement; titleDims: HTMLElement; prov: HTMLElement };
  private cast: ParsedCast | null = null;
  private vt: VT | null = null;
  private lineEls: HTMLDivElement[] = [];
  private idx = 0;
  private playedT = 0;
  private playing = false;
  private lastTick: number | null = null;
  private speed = 1;
  private follow = true;
  private raf = 0;
  private wrapUser: boolean | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: HTMLElement, opts: PortholePlayerOptions = {}) {
    this.root = root;
    this.opts = opts;
    this.root.classList.add("ph-root");
    this.root.innerHTML = `
      <div class="ph-win">
        <div class="ph-win-bar">
          <span class="ph-dots"><i class="r"></i><i class="a"></i><i class="g"></i></span>
          <span class="ph-title"><b>pd</b><span class="ph-dims" data-el="titleDims"></span></span>
          <span class="ph-hint">select any line — it's real text</span>
        </div>
        <div class="ph-term-wrap">
          <div class="ph-term" data-el="term" tabindex="0" aria-live="off"></div>
          <button class="ph-resume" data-el="resume" type="button">▼ resume follow</button>
        </div>
        <div class="ph-cut-notice" data-el="cutNotice" hidden></div>
        <div class="ph-ctl">
          <button class="ph-btn" data-el="play" type="button" aria-label="Play or pause">❚❚</button>
          <button class="ph-btn" data-el="restart" type="button" aria-label="Restart from the beginning">↺</button>
          <div class="ph-speeds" data-el="speeds"></div>
          <div class="ph-seek" data-el="seek"><div class="ph-rail"><div class="ph-fill" data-el="fill"></div><div class="ph-cuts" data-el="cuts"></div></div></div>
          <div class="ph-time" data-el="time">0.0s / 0.0s</div>
          <button class="ph-btn" data-el="wrapBtn" type="button" aria-pressed="false" aria-label="Toggle line wrapping">↩</button>
          <button class="ph-btn" data-el="copyAll" type="button" aria-label="Copy full transcript">⧉ copy</button>
        </div>
      </div>
      <div class="ph-provenance" data-el="prov"></div>
      <div class="ph-toast" data-el="toast">copied</div>
    `;
    const $ = <T extends HTMLElement>(name: string) => this.root.querySelector<T>(`[data-el="${name}"]`)!;
    this.term = $("term");
    this.els = {
      play: $("play"),
      restart: $("restart"),
      time: $("time"),
      fill: $("fill"),
      seek: $("seek"),
      cuts: $("cuts"),
      cutNotice: $("cutNotice"),
      wrapBtn: $("wrapBtn"),
      copyAll: $("copyAll"),
      resume: $("resume"),
      toast: $("toast"),
      titleDims: $("titleDims"),
      prov: $("prov"),
    };
    const speedsEl = $("speeds");
    for (const s of SPEEDS) {
      const b = document.createElement("button");
      b.className = "ph-speed-chip";
      b.type = "button";
      b.textContent = `${s}×`;
      b.setAttribute("aria-pressed", String(s === 1));
      b.addEventListener("click", () => this.setSpeed(s));
      speedsEl.appendChild(b);
    }
    this.wireControls();
  }

  private wireControls(): void {
    this.els.play.addEventListener("click", () => (this.playing ? this.pause() : this.play()));
    this.els.restart.addEventListener("click", () => {
      this.restart();
    });
    this.els.seek.addEventListener("click", (e) => {
      if (!this.cast) return;
      const r = this.els.seek.getBoundingClientRect();
      const t = ((e.clientX - r.left) / r.width) * this.cast.duration;
      const was = this.playing;
      this.pause();
      this.seekTo(Math.max(0, t));
      if (was) this.play();
    });
    this.term.addEventListener("scroll", () => {
      const pinned = this.term.scrollTop + this.term.clientHeight >= this.term.scrollHeight - 8;
      if (!pinned && this.playing) {
        this.follow = false;
        this.els.resume.style.display = "block";
      }
      if (pinned) {
        this.follow = true;
        this.els.resume.style.display = "none";
      }
    });
    this.els.resume.addEventListener("click", () => {
      this.follow = true;
      this.term.scrollTop = this.term.scrollHeight;
      this.els.resume.style.display = "none";
    });
    this.term.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const line = target.closest<HTMLElement>(".ph-line");
      if (!line) return;
      const rect = line.getBoundingClientRect();
      if (e.clientX < rect.left) {
        void navigator.clipboard.writeText(line.textContent?.replace(/\u200b/g, "") ?? "").then(() => this.toast("line copied"));
      }
    });
    this.els.wrapBtn.addEventListener("click", () => {
      this.wrapUser = !this.term.classList.contains("ph-wrap");
      this.setWrap(this.wrapUser);
    });
    this.els.copyAll.addEventListener("click", () => {
      const text = Array.from(this.term.children)
        .map((el) => el.textContent?.replace(/\u200b/g, "") ?? "")
        .join("\n");
      void navigator.clipboard.writeText(text).then(() => this.toast("full transcript copied"));
    });
    new ResizeObserver(() => {
      if (this.cast) this.autoWrap();
    }).observe(this.term);
  }

  private toast(msg: string): void {
    this.els.toast.textContent = msg;
    this.els.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.els.toast.classList.remove("show"), 1400);
  }

  private setWrap(on: boolean): void {
    this.term.classList.toggle("ph-wrap", on);
    this.els.wrapBtn.setAttribute("aria-pressed", String(on));
  }

  private charW(): number {
    const probe = document.createElement("span");
    probe.textContent = "0000000000";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
    this.term.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return w || 8.1;
  }

  private autoWrap(): void {
    if (!this.cast) return;
    if (this.vt?.sawAlt) {
      this.setWrap(false);
      return;
    }
    if (this.wrapUser !== null) {
      this.setWrap(this.wrapUser);
      return;
    }
    const inner = this.term.clientWidth - 44;
    this.setWrap(inner < this.cast.cols * this.charW());
  }

  private renderLine(r: number): void {
    let el = this.lineEls[r];
    if (!el) {
      el = document.createElement("div");
      el.className = "ph-line";
      el.dataset.idx = String(r);
      this.lineEls[r] = el;
      let next: HTMLElement | null = null;
      for (let i = r + 1; i < this.lineEls.length; i++) {
        if (this.lineEls[i]) {
          next = this.lineEls[i];
          break;
        }
      }
      this.term.insertBefore(el, next);
    }
    const L = this.vt!.lines[r] || [];
    const semantics = semanticCells(L.map((cell) => cell.ch).join(""));
    el.classList.toggle("ph-line--anchor", semantics.some((kinds) => kinds.has("anchor")));
    el.classList.toggle("ph-line--hook", semantics.some((kinds) => kinds.has("hook")));
    el.classList.toggle("ph-line--error", semantics.some((kinds) => kinds.has("error")));
    let html = "";
    let curStyle: string | null = null;
    let curClasses = "";
    let run = "";
    const flush = () => {
      if (curStyle !== null) {
        const classAttribute = curClasses ? ` class="${curClasses}"` : "";
        html += `<span${classAttribute} style="${curStyle}">${esc(run)}</span>`;
      }
      run = "";
    };
    for (const [index, cell] of L.entries()) {
      const style = styleSpan(cell.st);
      const classes = [...semantics[index]].sort().map((kind) => `ph-token--${kind}`).join(" ");
      if (style !== curStyle || classes !== curClasses) {
        flush();
        curStyle = style;
        curClasses = classes;
      }
      run += cell.ch;
    }
    flush();
    el.innerHTML = html || "\u200b";
  }

  private applyDirty(): void {
    if (!this.vt) return;
    while (this.lineEls.length > this.vt.lines.length) {
      const el = this.lineEls.pop();
      el?.remove();
    }
    // Alt-screen (TUI) casts need a near-1:1 line pitch for box-drawing
    // borders to connect between rows — see porthole.css's `.ph-tui` rule.
    // `sawAlt` flips true mid-stream the moment the cast enters alt-screen,
    // so this checks it every frame rather than once at load.
    this.term.classList.toggle("ph-tui", this.vt.sawAlt);
    if (!this.vt.dirty.size) return;
    for (const r of this.vt.dirty) {
      if (r < this.vt.lines.length) this.renderLine(r);
      else this.vt.dirty.delete(r);
    }
    this.vt.dirty.clear();
    if (this.follow) this.term.scrollTop = this.term.scrollHeight;
  }

  private updateTime(): void {
    if (!this.cast) return;
    const displayTime = Math.min(this.playedT, this.cast.duration);
    const sourceTime = Math.min(sourceTimeAtDisplayTime(this.cast, displayTime), this.cast.sourceDuration);
    this.els.time.textContent = this.cast.jumpCuts.length
      ? `${sourceTime.toFixed(1)}s real · ${displayTime.toFixed(1)}s shown`
      : `${displayTime.toFixed(1)}s / ${this.cast.duration.toFixed(1)}s`;
    this.els.fill.style.width = `${Math.min(100, (this.playedT / (this.cast.duration || 1)) * 100)}%`;
    const activeCut = this.cast.jumpCuts.find((cut) => displayTime >= cut.displayFrom && displayTime <= cut.displayTo);
    this.els.cutNotice.hidden = !activeCut;
    if (activeCut) this.els.cutNotice.innerHTML = this.cutLabel(activeCut);
  }

  private clockLabel(sourceSeconds: number): string {
    const timestamp = this.cast?.head.timestamp;
    if (typeof timestamp !== "number") return `${sourceSeconds.toFixed(1)}s`;
    return new Date((timestamp + sourceSeconds) * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  private cutLabel(cut: CastJumpCut): string {
    const elapsed = Math.max(0, cut.sourceTo - cut.sourceFrom);
    return `<span class="ph-axis" aria-hidden="true">//</span>`
      + `<strong>jump cut</strong> ${this.clockLabel(cut.sourceFrom)} → ${this.clockLabel(cut.sourceTo)}`
      + `<span>${elapsed.toFixed(1)}s genuinely elapsed · no terminal output omitted</span>`;
  }

  private renderJumpCuts(): void {
    if (!this.cast) return;
    this.els.cuts.replaceChildren();
    for (const cut of this.cast.jumpCuts) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "ph-cut-marker";
      marker.style.left = `${Math.min(100, (cut.displayFrom / (this.cast.duration || 1)) * 100)}%`;
      marker.setAttribute("aria-label", `Jump cut from ${this.clockLabel(cut.sourceFrom)} to ${this.clockLabel(cut.sourceTo)}`);
      marker.title = `${this.clockLabel(cut.sourceFrom)} → ${this.clockLabel(cut.sourceTo)}; ${(cut.sourceTo - cut.sourceFrom).toFixed(1)}s elapsed`;
      marker.textContent = "//";
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        this.pause();
        this.seekTo(cut.displayFrom);
      });
      this.els.cuts.appendChild(marker);
    }
  }

  private setSpeed(s: number): void {
    this.speed = s;
    const chips = Array.from(this.els.play.parentElement!.querySelectorAll<HTMLButtonElement>(".ph-speed-chip"));
    chips.forEach((x, i) => x.setAttribute("aria-pressed", String(SPEEDS[i] === s)));
  }

  private seekTo(t: number): void {
    if (!this.cast) return;
    if (t < this.playedT) {
      this.vt = new VT(this.cast.cols, this.cast.rows, PORTHOLE_ANSI_THEME);
      this.idx = 0;
      this.term.innerHTML = "";
      this.lineEls.length = 0;
      this.playedT = 0;
    }
    while (this.idx < this.cast.events.length && this.cast.events[this.idx][0] <= t) {
      this.vt!.feed(this.cast.events[this.idx][1]);
      this.idx++;
    }
    this.playedT = t;
    this.applyDirty();
    this.updateTime();
  }

  private tick = (now: number): void => {
    if (!this.playing || !this.cast) return;
    if (this.lastTick == null) this.lastTick = now;
    this.playedT += ((now - this.lastTick) / 1000) * this.speed;
    this.lastTick = now;
    while (this.idx < this.cast.events.length && this.cast.events[this.idx][0] <= this.playedT) {
      this.vt!.feed(this.cast.events[this.idx][1]);
      this.idx++;
    }
    this.applyDirty();
    this.updateTime();
    if (this.idx >= this.cast.events.length) {
      this.playing = false;
      this.els.play.innerHTML = "▶";
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Starts (or resumes) playback from the current position. A no-op if
   *  already playing or nothing has loaded yet. */
  play(): void {
    if (this.playing || !this.cast) return;
    if (this.idx >= this.cast.events.length) this.seekTo(0);
    this.playing = true;
    this.lastTick = null;
    this.els.play.innerHTML = "❚❚";
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Pauses playback in place; `play()` resumes from here. */
  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.els.play.innerHTML = "▶";
  }

  /** Rewinds to time zero and begins playback. Gallery scene changes call
   * this explicitly so a new scene never inherits a prior scene's position. */
  restart(): void {
    this.pause();
    this.follow = true;
    this.seekTo(0);
    this.play();
  }

  /**
   * Fetches and parses a `.cast` file, then either replays it live
   * (respecting `autoplay`) or, under `prefers-reduced-motion`, renders
   * the fully-settled final transcript immediately with no clock running.
   * On failure (404, malformed cast), renders a visible in-terminal error
   * line rather than leaving the chrome looking like it is still loading,
   * then re-throws so the caller can log/report it.
   */
  async load(url: string): Promise<void> {
    try {
      await this.loadOrThrow(url);
    } catch (err) {
      // A broken embed should read as "this recording is temporarily
      // unavailable," never as a silently blank box a visitor assumes is
      // still buffering — the whole premise of this project is that a
      // terminal demo should never lie about its own state.
      this.term.innerHTML = "";
      this.lineEls.length = 0;
      const line = document.createElement("div");
      line.className = "ph-line";
      line.style.color = "var(--status-error)";
      line.textContent = "⚠ this recording is temporarily unavailable";
      this.term.appendChild(line);
      throw err;
    }
  }

  private async loadOrThrow(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Porthole: failed to fetch cast ${url}: ${res.status}`);
    const text = await res.text();
    this.cast = parseCast(text);
    this.vt = new VT(this.cast.cols, this.cast.rows, PORTHOLE_ANSI_THEME);
    this.idx = 0;
    this.playedT = 0;
    this.playing = false;
    this.term.innerHTML = "";
    this.lineEls.length = 0;
    this.term.style.setProperty("--ph-term-h", `min(60vh, ${this.cast.rows * 1.42 * 13.5 + 24}px)`);
    const versionLabel = typeof this.cast.head.version === "number" ? this.cast.head.version : 2;
    this.els.titleDims.textContent = ` — ${this.cast.cols}×${this.cast.rows} · asciicast v${versionLabel}`;
    const recordedAt = typeof this.cast.head.timestamp === "number" ? new Date(this.cast.head.timestamp * 1000).toISOString().slice(0, 10) : "unknown";
    this.els.prov.innerHTML =
      `<span><span class="ph-prov-k">source</span>released pd CLI, live daemon</span>` +
      `<span><span class="ph-prov-k">captured</span>${recordedAt}</span>` +
      `<span><span class="ph-prov-k">events</span>${this.cast.events.length} · ${this.cast.sourceDuration.toFixed(1)}s real</span>` +
      (this.cast.jumpCuts.length ? `<span><span class="ph-prov-k">timeline</span>${this.cast.jumpCuts.length} declared jump cut${this.cast.jumpCuts.length === 1 ? "" : "s"} · ${this.cast.duration.toFixed(1)}s shown</span>` : "") +
      `<span><span class="ph-prov-k">fidelity</span>unfiltered PTY bytes</span>`;
    this.renderJumpCuts();

    if (this.opts.reducedMotion) {
      this.seekTo(this.cast.duration);
      this.autoWrap();
      return;
    }
    this.follow = true;
    this.updateTime();
    this.autoWrap();
    if (this.opts.autoplay) this.play();
  }

  /** Releases timers/observers. Call from a React `useEffect` cleanup. */
  destroy(): void {
    this.pause();
    clearTimeout(this.toastTimer);
  }
}
