const HOST_ID = 'pd-scout-region-host';
const CONFIRMATION_HOST_ID = 'pd-scout-capture-confirmation-host';

function canUseDom() {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&').replace(/\s+/g, '\\ ');
}

function selectorFor(element) {
  if (element.id) return `#${cssEscape(element.id)}`;
  const testIdAttr = element.hasAttribute('data-testid') ? 'data-testid' : element.hasAttribute('data-test') ? 'data-test' : null;
  const testId = testIdAttr ? element.getAttribute(testIdAttr) : null;
  if (testIdAttr && testId) return `[${testIdAttr}="${cssEscape(testId)}"]`;
  const aria = element.getAttribute('aria-label');
  if (aria) return `${element.tagName.toLowerCase()}[aria-label="${cssEscape(aria)}"]`;
  const classNames = Array.from(element.classList || [])
    .filter((name) => !name.startsWith('animate-') && !name.startsWith('motion-'))
    .slice(0, 2);
  if (classNames.length > 0) {
    const candidate = `${element.tagName.toLowerCase()}.${classNames.map(cssEscape).join('.')}`;
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch {
      return element.tagName.toLowerCase();
    }
  }

  const parts = [];
  let current = element;
  while (current && current !== document.body && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((node) => node.tagName === current.tagName)
      : [];
    const index = siblings.indexOf(current);
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index + 1})` : tag);
    current = current.parentElement;
  }
  return parts.join(' > ') || element.tagName.toLowerCase();
}

function xpathFor(element) {
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(index > 1 ? `${tag}[${index}]` : tag);
    current = current.parentElement;
  }
  return `/${parts.join('/')}`;
}

function textFor(element) {
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 160) : null;
}

function componentNameForFiber(fiber) {
  const type = fiber?.elementType || fiber?.type;
  return type?.displayName || type?.name || fiber?.tag || null;
}

function sourceForElement(element) {
  let node = element;
  while (node) {
    const key = Object.keys(node).find((name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
    let fiber = key ? node[key] : null;
    while (fiber) {
      if (fiber._debugSource) {
        return {
          fileName: fiber._debugSource.fileName || null,
          lineNumber: fiber._debugSource.lineNumber || null,
          columnNumber: fiber._debugSource.columnNumber || null,
          componentName: componentNameForFiber(fiber),
        };
      }
      fiber = fiber.return;
    }
    node = node.parentElement;
  }
  return null;
}

function elementEnvelope(element) {
  const bounds = element.getBoundingClientRect();
  return {
    selector: selectorFor(element),
    xpath: xpathFor(element),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    text: textFor(element),
    bounds: {
      x: Math.round(bounds.left),
      y: Math.round(bounds.top),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      coordinateSpace: 'viewport',
    },
    source: sourceForElement(element),
  };
}

function normalizedRect(a, b) {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y)),
    coordinateSpace: 'viewport',
  };
}

function sampleDom(region, host) {
  if (!canUseDom()) return null;
  const previousDisplay = host?.style.display;
  if (host) host.style.display = 'none';

  const ratios = [
    [0.18, 0.18], [0.5, 0.18], [0.82, 0.18],
    [0.18, 0.5], [0.5, 0.5], [0.82, 0.5],
    [0.18, 0.82], [0.5, 0.82], [0.82, 0.82],
  ];
  const seen = new Set();
  const elements = [];

  for (const [xr, yr] of ratios) {
    const x = Math.min(window.innerWidth - 1, Math.max(0, region.x + region.width * xr));
    const y = Math.min(window.innerHeight - 1, Math.max(0, region.y + region.height * yr));
    for (const element of document.elementsFromPoint(x, y)) {
      if (seen.has(element)) continue;
      if (element === document.documentElement || element === document.body) continue;
      if (element.closest?.(`#${HOST_ID}`)) continue;
      seen.add(element);
      elements.push(elementEnvelope(element));
      if (elements.length >= 16) break;
    }
    if (elements.length >= 16) break;
  }

  if (host) host.style.display = previousDisplay || '';

  return {
    url: window.location.href,
    title: document.title || null,
    capturedAt: new Date().toISOString(),
    selectors: elements.map((element) => element.selector),
    elementsInRegion: elements,
  };
}

function collectContext() {
  const region = {
    x: 0,
    y: 0,
    width: Math.round(window.innerWidth),
    height: Math.round(window.innerHeight),
    coordinateSpace: 'viewport',
  };
  return {
    ...sampleDom(region, null),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
  };
}

function removeHost() {
  document.getElementById(HOST_ID)?.remove();
}

function showCapturedRegion(region) {
  document.getElementById(CONFIRMATION_HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = CONFIRMATION_HOST_ID;
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483646';
  host.style.pointerEvents = 'none';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .box {
        position: fixed;
        left: ${region.x}px;
        top: ${region.y}px;
        width: ${Math.max(1, region.width)}px;
        height: ${Math.max(1, region.height)}px;
        border: 2px solid #2f7df6;
        background: rgba(47, 125, 246, 0.10);
        box-shadow: 0 0 0 9999px rgba(15, 18, 25, 0.14);
        border-radius: 8px;
      }
      .label {
        position: fixed;
        left: min(calc(${region.x}px + 8px), calc(100vw - 220px));
        top: max(12px, calc(${region.y}px - 44px));
        background: rgba(255,255,255,0.96);
        color: #202022;
        border: 1px solid rgba(0,0,0,0.14);
        border-radius: 14px;
        box-shadow: 0 18px 48px rgba(0,0,0,0.22);
        padding: 9px 12px;
        font: 700 13px/1.35 Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      }
    </style>
    <div class="box"></div>
    <div class="label">Scout captured this region.</div>
  `;

  document.documentElement.appendChild(host);
  window.setTimeout(() => host.remove(), 4500);
}

function startSelection() {
  removeHost();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'auto';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .veil {
        position: fixed;
        inset: 0;
        cursor: crosshair;
        background: rgba(17, 24, 39, 0.22);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      }
      .hint {
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255,255,255,0.96);
        color: #202022;
        border: 1px solid rgba(0,0,0,0.14);
        border-radius: 14px;
        box-shadow: 0 18px 48px rgba(0,0,0,0.22);
        padding: 10px 14px;
        font: 600 14px/1.35 Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      }
      .box {
        position: fixed;
        border: 2px solid #2f7df6;
        background: rgba(47, 125, 246, 0.16);
        box-shadow: 0 0 0 9999px rgba(0,0,0,0.26);
        border-radius: 8px;
        display: none;
      }
    </style>
    <div class="veil">
      <div class="hint">Drag a rectangle. Scout reopens when it is captured. Press Esc to cancel.</div>
      <div class="box"></div>
    </div>
  `;
  document.documentElement.appendChild(host);

  const veil = shadow.querySelector('.veil');
  const box = shadow.querySelector('.box');
  let start = null;
  let current = null;

  function draw(rect) {
    box.style.display = 'block';
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${Math.max(1, rect.width)}px`;
    box.style.height = `${Math.max(1, rect.height)}px`;
  }

  function cleanup() {
    window.removeEventListener('keydown', onKeyDown, true);
    removeHost();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanup();
    }
  }

  veil.addEventListener('pointerdown', (event) => {
    start = { x: event.clientX, y: event.clientY };
    current = start;
    veil.setPointerCapture(event.pointerId);
    draw(normalizedRect(start, current));
  });

  veil.addEventListener('pointermove', (event) => {
    if (!start) return;
    current = { x: event.clientX, y: event.clientY };
    draw(normalizedRect(start, current));
  });

  veil.addEventListener('pointerup', (event) => {
    if (!start) return;
    current = { x: event.clientX, y: event.clientY };
    const region = normalizedRect(start, current);
    if (region.width < 8 || region.height < 8) {
      cleanup();
      return;
    }
    const domContext = sampleDom(region, host);
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    cleanup();
    showCapturedRegion(region);
    chrome.runtime.sendMessage({
      type: 'pd-scout-selection-complete',
      selection: { region, domContext, viewport },
    });
  });

  window.addEventListener('keydown', onKeyDown, true);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'pd-scout-start-selection') {
    startSelection();
    sendResponse({ started: true });
    return false;
  }
  if (message?.type === 'pd-scout-collect-context') {
    sendResponse(collectContext());
    return false;
  }
  return false;
});
