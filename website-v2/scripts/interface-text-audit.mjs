export const auditText = () => {
  const swatch = document.createElement('canvas'); swatch.width = swatch.height = 1; const ctx = swatch.getContext('2d', { willReadFrequently: true });
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) { if (!ctx || !CSS.supports('color', c)) return null; ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const channels = ctx.getImageData(0, 0, 1, 1).data; return [channels[0], channels[1], channels[2], channels[3] / 255]; }
    const v = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return [...v.slice(0, 3), v[3] ?? 1];
  };
  const linear = (v) =>
    (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const lum = (c) =>
    0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
  const blend = (a, b) => [
    ...a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3])),
    1,
  ];
  const ratio = (a, b) =>
    (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const background = (e) => {
    const stack = [];
    for (let n = e; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3]) {
        stack.push(c);
        if (c[3] === 1) break;
      }
    }
    return stack.reverse().reduce((b, c) => blend(c, b), [255, 255, 255, 1]);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT),
    seen = new Set(),
    failed = [];
  let checked = 0,
    minRatio = 99,
    minNormalRatio = 99,
    minLargeRatio = 99;
  while (walker.nextNode()) {
    const t = walker.currentNode,
      e = t.parentElement;
    if (
      !t.textContent.trim() ||
      !e ||
      seen.has(e) ||
      e.closest('script,style,svg,[hidden],.sr-only')
    )
      continue;
    seen.add(e);
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    if (!e.checkVisibility() || r.width < 2 || r.height < 2) continue;
    const fg = parse(s.color);
    if (!fg) continue;
    const bg = background(e),
      contrast = ratio(blend(fg, bg), bg),
      large =
        parseFloat(s.fontSize) >= 24 ||
        (parseFloat(s.fontSize) >= 18.66 && parseInt(s.fontWeight) >= 700),
      need = large ? 4.5 : 7;
    checked++;
    minRatio = Math.min(minRatio, contrast);
    if (large) minLargeRatio = Math.min(minLargeRatio, contrast);
    else minNormalRatio = Math.min(minNormalRatio, contrast);
    if (contrast < need)
      failed.push({
        text: t.textContent.trim().slice(0, 80),
        ratio: contrast,
        need,
        foreground: s.color,
        background: bg,
      });
  }
  return {
    checked,
    minRatio,
    minNormalRatio,
    minLargeRatio,
    failed,
    overflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  };
};
