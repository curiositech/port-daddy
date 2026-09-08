(() => {
  const root = document.documentElement;
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let running = !prefersReduced.matches;
  let last = performance.now();
  let clock = 0;

  const colors = {
    paper: "#f2eee6",
    ink: "#121212",
    dark: "#101216",
    panel: "#181c22",
    raised: "#222833",
    line: "#3b4654",
    cobalt: "#1f4ec9",
    cobaltSoft: "#7db4ff",
    kelp: "#006b5f",
    health: "#1f7a4d",
    lime: "#cad900",
    gold: "#d09a2d",
    coral: "#aa432e",
    violet: "#933fa5",
    foam: "#f5f3ed",
    muted: "#a59f93",
  };

  const bayer = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
  ];

  const canvases = {
    fleet: document.getElementById("fleetCanvas"),
    harbor: document.getElementById("harborCanvas"),
    motion: document.getElementById("motionCanvas"),
    shader: document.getElementById("shaderCanvas"),
  };

  const motionButton = document.getElementById("motionToggle");
  const themeButton = document.getElementById("themeToggle");
  const navLinks = Array.from(document.querySelectorAll("nav a"));

  function setMotion(next) {
    running = next;
    motionButton.textContent = running ? "pause" : "play";
    motionButton.setAttribute("aria-pressed", String(running));
    motionButton.setAttribute("aria-label", running ? "Pause animated studies" : "Play animated studies");
  }

  function setTheme(next) {
    root.dataset.theme = next;
    const isDark = next === "dark";
    themeButton.textContent = isDark ? "light" : "dark";
    themeButton.setAttribute("aria-pressed", String(isDark));
    themeButton.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  }

  motionButton.addEventListener("click", () => setMotion(!running));
  themeButton.addEventListener("click", () => setTheme(root.dataset.theme === "dark" ? "light" : "dark"));
  prefersReduced.addEventListener("change", event => setMotion(!event.matches));
  const params = new URLSearchParams(window.location.search);
  const requestedTheme = window.__galleryTheme || params.get("theme");
  const requestedMotion = window.__galleryMotion || params.get("motion");

  if (requestedTheme === "light" || requestedTheme === "dark") {
    setTheme(requestedTheme);
  }

  if (requestedMotion === "play") {
    setMotion(true);
  } else if (requestedMotion === "pause" || requestedMotion === "paused") {
    setMotion(false);
  } else {
    setMotion(running);
  }

  function setActiveNav(id) {
    navLinks.forEach(link => {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  navLinks.forEach(link => {
    link.addEventListener("click", () => {
      const target = link.getAttribute("href").slice(1);
      setActiveNav(target);
    });
  });

  const navTargets = navLinks
    .map(link => ({ link, target: document.getElementById(link.getAttribute("href").slice(1)) }))
    .filter(entry => entry.target);

  if ("IntersectionObserver" in window && navTargets.length > 0) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) {
        setActiveNav(visible[0].target.id);
      }
    }, { rootMargin: "-35% 0px -55% 0px", threshold: [0.15, 0.3, 0.5, 0.75] });

    navTargets.forEach(({ target }) => observer.observe(target));
  }

  setActiveNav("fleet");

  function ctx(canvas) {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, w: rect.width, h: rect.height };
  }

  function fill(c, color) {
    c.fillStyle = color;
    c.fill();
  }

  function line(c, color, width = 1) {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }

  function rect(c, x, y, w, h, color) {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  }

  function strokeRect(c, x, y, w, h, color, width = 1) {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.strokeRect(x, y, w, h);
  }

  function text(c, value, x, y, color = colors.foam, size = 16, weight = 700) {
    c.fillStyle = color;
    c.font = `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    c.fillText(value, x, y);
  }

  function tickBox(c, x, y, w, h, color = colors.foam) {
    const l = Math.min(34, w * 0.08, h * 0.14);
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x, y + l);
    c.lineTo(x, y);
    c.lineTo(x + l, y);
    c.moveTo(x + w - l, y);
    c.lineTo(x + w, y);
    c.lineTo(x + w, y + l);
    c.moveTo(x, y + h - l);
    c.lineTo(x, y + h);
    c.lineTo(x + l, y + h);
    c.moveTo(x + w - l, y + h);
    c.lineTo(x + w, y + h);
    c.lineTo(x + w, y + h - l);
    c.stroke();
  }

  function microFlag(c, x, y, a, b) {
    rect(c, x, y, 13, 18, a);
    rect(c, x + 13, y, 13, 18, b);
    strokeRect(c, x, y, 26, 18, colors.dark, 1);
  }

  function row(c, y, name, detail, tone, age, pulse = 0, tag = "") {
    const x = 58;
    if (pulse > 0) {
      c.globalAlpha = 0.12 + pulse * 0.22;
      rect(c, x - 10, y - 6, 760, 34, tone);
      c.globalAlpha = 1;
    }
    rect(c, x, y, 6, 28, tone);
    rect(c, x + 24, y + 9, 12, 12, tone);
    if (pulse > 0) {
      c.globalAlpha = 0.18 + pulse * 0.15;
      rect(c, x + 44, y + 2, 710, 24, tone);
      c.globalAlpha = 1;
    }
    text(c, name, x + 54, y + 21, colors.foam, 17, 900);
    text(c, detail, x + 178, y + 21, colors.muted, 17, 500);
    if (tag) {
      rect(c, x + 578, y + 4, 70, 18, tone);
      text(c, tag, x + 588, y + 17, colors.dark, 11, 900);
    }
    text(c, age, x + 790, y + 21, colors.muted, 16, 500);
    c.globalAlpha = 0.18;
    rect(c, x, y + 42, 820, 1, colors.foam);
    c.globalAlpha = 1;
  }

  function drawFleet(t) {
    const { c, w, h } = ctx(canvases.fleet);
    rect(c, 0, 0, w, h, colors.dark);
    c.globalAlpha = 0.08;
    for (let x = 0; x < w; x += 64) {
      rect(c, x, 0, 1, h, colors.cobaltSoft);
    }
    for (let y = 0; y < h; y += 64) {
      rect(c, 0, y, w, 1, colors.cobaltSoft);
    }
    c.globalAlpha = 1;
    rect(c, 24, 24, w - 48, 74, "#0f1218");
    strokeRect(c, 24.5, 24.5, w - 49, 73, colors.line, 1);
    text(c, "fleet truth deck / 6 live", 46, 56, colors.foam, 18, 900);
    text(c, "ready, gated, degraded, waiting", 46, 82, colors.muted, 13, 700);
    microFlag(c, w - 132, 42, colors.cobalt, colors.gold);
    text(c, "operator truth", w - 96, 58, colors.foam, 12, 900);
    rect(c, 46, 112, 120, 26, colors.cobalt);
    text(c, "ACTIVE", 58, 129, colors.foam, 12, 900);
    rect(c, 172, 112, 118, 26, colors.health);
    text(c, "READY", 187, 129, colors.foam, 12, 900);
    rect(c, 296, 112, 120, 26, colors.gold);
    text(c, "PENDING", 308, 129, colors.foam, 12, 900);
    rect(c, 422, 112, 118, 26, colors.violet);
    text(c, "UNKNOWN", 434, 129, colors.foam, 12, 900);
    tickBox(c, 28, 30, w - 56, h - 62);
    const p = 0.5 + 0.5 * Math.sin(t * 2.2);
    row(c, 168, "spider", "security scan · pass 4/7", colors.cobaltSoft, "18s", p, "scan");
    row(c, 208, "cartographer", "indexing src/ 412/1840", colors.cobalt, "2m14s", 0, "index");
    row(c, 248, "qa", "14/14 passed", colors.lime, "8s", 0, "green");
    row(c, 288, "gardener", "3 warnings, 1 unused export", colors.gold, "1m", 0.2, "watch");
    row(c, 328, "spark", "workers-ai 401 · auth expired", colors.coral, "23s", 0.35, "error");
    row(c, 368, "approver", "waiting on operator · PR #91", colors.violet, "4m", 0, "hold");
    rect(c, 40, h - 88, w - 80, 52, "#0b0d11");
    strokeRect(c, 40, h - 88, w - 80, 52, colors.line, 1);
    microFlag(c, 58, h - 72, colors.lime, colors.gold);
    text(c, "honest states only / receipts visible / no fake green", 100, h - 54, colors.muted, 15, 700);
    text(c, "salvage route open", w - 168, h - 54, colors.foam, 13, 900);
  }

  function drawHarbor(t) {
    const { c, w, h } = ctx(canvases.harbor);
    rect(c, 0, 0, w, h, "#0b0d11");
    c.globalAlpha = 0.08;
    for (let x = 0; x < w; x += 72) {
      rect(c, x, 0, 1, h, colors.cobaltSoft);
    }
    for (let y = 0; y < h; y += 72) {
      rect(c, 0, y, w, 1, colors.cobaltSoft);
    }
    c.globalAlpha = 1;
    rect(c, 24, 24, w - 48, 54, "#10151c");
    strokeRect(c, 24.5, 24.5, w - 49, 53, colors.line, 1);
    text(c, "harbor editor claims / 3 aboard", 46, 57, colors.foam, 18, 900);
    text(c, "frozen lines stay visible", 46, 81, colors.muted, 13, 700);
    microFlag(c, w - 136, 40, colors.cobalt, colors.gold);
    text(c, "claim / parley", w - 96, 57, colors.foam, 12, 900);

    const codeX = 38;
    const codeY = 104;
    const codeW = w - 326;
    const codeH = h - 168;
    rect(c, codeX, codeY, codeW, codeH, "#0f1218");
    strokeRect(c, codeX, codeY, codeW, codeH, colors.line, 1);
    text(c, "44  export async function submitFeedback(req: Request) {", codeX + 14, codeY + 34, colors.muted, 17, 500);
    text(c, "45    const user = await auth(req)", codeX + 14, codeY + 76, colors.foam, 17, 500);
    rect(c, codeX + 188, codeY + 106, 404, 28, "rgba(125, 180, 255, 0.26)");
    text(c, "46    const q = sql`SELECT * FROM feedback WHERE uid = ${user.id}`", codeX + 14, codeY + 128, colors.foam, 17, 500);
    const claimX = codeX + codeW - 148;
    rect(c, claimX, codeY + 104, 126, 24, colors.cobaltSoft);
    text(c, "spider | claim 46-52", claimX + 8, codeY + 121, colors.dark, 11, 900);
    c.globalAlpha = 0.12 + 0.08 * Math.sin(t * 3);
    rect(c, codeX + 12, codeY + 140, 8, 76, colors.coral);
    c.globalAlpha = 1;
    text(c, "47    // spider: parameterizing - injection candidate", codeX + 14, codeY + 170, colors.muted, 17, 500);
    text(c, "48    return render(q)", codeX + 14, codeY + 212, colors.foam, 17, 500);
    text(c, "49  }", codeX + 14, codeY + 254, colors.foam, 17, 500);
    text(c, "forecast: qa test claim lands here in ~4m", codeX + 324, codeY + 212, colors.gold, 14, 700);

    const panelX = w - 264;
    rect(c, panelX, 104, 226, codeH, "#0d1218");
    rect(c, panelX, 104, 1, codeH, colors.line);
    text(c, "PARLEY · THIS BUFFER", panelX + 24, 140, colors.muted, 14, 900);
    rect(c, panelX + 24, 168, 74, 24, colors.cobalt);
    text(c, "SECURITE", panelX + 32, 185, colors.foam, 12, 900);
    text(c, "spider claim", panelX + 108, 185, colors.cobaltSoft, 15, 800);
    text(c, "query 46 · param fix", panelX + 24, 214, colors.muted, 15, 600);
    rect(c, panelX + 24, 258, 76, 24, colors.gold);
    text(c, "PAN-PAN", panelX + 32, 275, colors.foam, 12, 900);
    text(c, "qa needs line 48", panelX + 108, 275, colors.lime, 15, 800);
    rect(c, panelX + 24, 314, 178, 1, colors.line);
    text(c, "salvage note", panelX + 24, 346, colors.subtle, 12, 900);
    text(c, "cartographer died holding lines 61-74", panelX + 24, 372, colors.foam, 15, 700);

    rect(c, 40, h - 76, w - 80, 42, "#0b0d11");
    strokeRect(c, 40, h - 76, w - 80, 42, colors.line, 1);
    microFlag(c, 58, h - 62, colors.lime, colors.gold);
    text(c, "trace 7dc3 · claim 46-52 · freeze line 47 · salvage safe", 100, h - 45, colors.muted, 15, 700);
    tickBox(c, 28, 30, w - 56, h - 62, colors.foam);
  }

  function drawMotion(t) {
    const { c, w, h } = ctx(canvases.motion);
    rect(c, 0, 0, w, h, colors.dark);
    c.globalAlpha = 0.06;
    for (let x = 0; x < w; x += 72) {
      rect(c, x, 0, 1, h, colors.cobaltSoft);
    }
    for (let y = 0; y < h; y += 72) {
      rect(c, 0, y, w, 1, colors.cobaltSoft);
    }
    c.globalAlpha = 1;
    text(c, "receipt motion / 5 state lane", 38, 54, colors.foam, 20, 900);
    text(c, "caller timed out · daemon may still launch · reconcile receipt", 38, 84, colors.muted, 15, 600);
    rect(c, w - 240, 36, 202, 28, colors.violet);
    text(c, "reduced motion path", w - 226, 55, colors.foam, 12, 900);
    const columns = [
      ["pending", colors.gold, 0.18],
      ["unknown", colors.violet, 0.42],
      ["recovering", colors.cobaltSoft, 0.64],
      ["confirmed", colors.health, 0.86],
      ["dead-letter", colors.coral, 1.0],
    ];

    const railX = 58;
    const railY = 210;
    const railW = w - 116;
    rect(c, railX, railY, railW, 3, colors.line);
    columns.forEach(([label, color, frac], index) => {
      const x = railX + railW * frac;
      const lift = Math.sin(t * 2 + index) * 5;
      rect(c, x - 2, railY - 38, 4, 80, color);
      rect(c, x - 34, railY - 86 + lift, 68, 36, color);
      text(c, label, x - 44, railY + 74, color, 13, 900);
      if (label === "unknown") {
        c.globalAlpha = 0.25 + 0.25 * Math.sin(t * 4);
        strokeRect(c, x - 48, railY - 100, 96, 64, color, 3);
        c.globalAlpha = 1;
      }
      if (label === "recovering") {
        const a = (Math.sin(t * 2.5) + 1) / 2;
        rect(c, x - 52, railY + 34, 104 * a, 8, color);
      }
      if (label === "dead-letter") {
        for (let k = -36; k < 44; k += 10) {
          c.beginPath();
          c.moveTo(x + k, railY - 92);
          c.lineTo(x + k + 28, railY - 42);
          line(c, color, 2);
        }
      }
    });

    rect(c, 38, h - 110, w - 76, 54, "#0b0d11");
    strokeRect(c, 38, h - 110, w - 76, 54, colors.line, 1);
    text(c, "trace 7dc3 · retry 2/5 · reconcile ledger", 58, h - 77, colors.foam, 15, 700);
    tickBox(c, 28, 30, w - 56, h - 62, colors.foam);
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function drawShader(t) {
    const { c, w, h } = ctx(canvases.shader);
    const width = Math.floor(w);
    const height = Math.floor(h);
    const image = c.createImageData(width, height);
    const data = image.data;
    const spots = [
      { x: 0.14, y: 0.72, r: 0.12, warm: 1.0 },
      { x: 0.31, y: 0.82, r: 0.09, warm: 0.82 },
      { x: 0.56, y: 0.68, r: 0.11, warm: 0.95 },
      { x: 0.82, y: 0.79, r: 0.1, warm: 0.88 },
    ];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const block = 4;
        const bx = Math.floor(x / block) * block;
        const by = Math.floor(y / block) * block;
        const u = bx / width;
        const v = by / height;
        const d = bayer[(x & 3) + ((y & 3) << 2)] / 16;
        const wave = Math.sin(u * 18 + t * 1.1) * 0.5 + Math.sin((u + v) * 16 - t * 0.7) * 0.5;
        const bus = Math.max(0, 1 - Math.abs(v - 0.18) / 0.16);
        const ledger = Math.max(0, 1 - Math.abs(v - 0.42) / 0.13);
        const sediment = Math.max(0, 1 - Math.abs(v - 0.73) / 0.24);
        let island = 0;
        for (const spot of spots) {
          const dx = (u - spot.x) / spot.r;
          const dy = (v - spot.y) / spot.r;
          const dist = Math.sqrt(dx * dx + dy * dy);
          island += Math.max(0, 1 - dist) ** 2 * spot.warm;
        }
        let r = 13;
        let g = 18;
        let b = 22;
        if (v < 0.24) {
          const glow = Math.min(1, bus + Math.max(0, wave) * 0.25 + d * 0.1);
          r = mix(16, 0, glow * 0.7);
          g = mix(18, 105, glow);
          b = mix(22, 184, glow * 0.75);
        } else if (v < 0.52) {
          const rail = Math.max(0, ledger + wave * 0.18 + d * 0.12);
          r = mix(12, 31, rail * 0.45);
          g = mix(18, 84, rail);
          b = mix(22, 199, rail * 0.75);
        } else {
          const base = mix(12, 24, sediment * 0.4 + d * 0.08);
          const teal = mix(18, 104, sediment * 0.55 + island * 0.15);
          const blue = mix(22, 72, sediment * 0.4);
          r = base;
          g = teal;
          b = blue;
          if (island > 0) {
            r = mix(r, 202, island);
            g = mix(g, 217, island);
            b = mix(b, 0, island * 0.95);
          }
        }
        if (island > 0.7) {
          r = mix(r, 245, island * 0.25);
          g = mix(g, 243, island * 0.15);
        }
        const idx = (y * width + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    c.putImageData(image, 0, 0);
    rect(c, 42, 42, 220, 38, colors.cobalt);
    text(c, "HOT BUS 41ms", 58, 68, colors.foam, 15, 900);
    rect(c, 42, 96, 310, 38, "rgba(16,18,22,0.78)");
    text(c, "cool ledger: receipt sediment visible", 58, 122, colors.foam, 14, 700);
    rect(c, w - 212, 42, 168, 38, colors.gold);
    text(c, "receipt gap", w - 194, 68, colors.foam, 15, 900);
    rect(c, 42, h - 106, 248, 30, "rgba(16,18,22,0.84)");
    text(c, "token atlas / dither field", 58, h - 85, colors.foam, 13, 700);
    tickBox(c, 30, 30, w - 60, h - 60, colors.foam);
  }

  function frame(now) {
    const dt = Math.min(48, now - last);
    last = now;
    if (running) {
      clock += dt / 1000;
    }
    drawFleet(clock);
    drawHarbor(clock);
    drawMotion(clock);
    drawShader(clock);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", () => {
    drawFleet(clock);
    drawHarbor(clock);
    drawMotion(clock);
    drawShader(clock);
  });

  requestAnimationFrame(frame);
})();
