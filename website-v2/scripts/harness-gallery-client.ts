import { PortholePlayer } from '../src/lib/porthole/player';

interface GalleryScene {
  id: string;
  label: string;
  station: string;
  locus: string;
  seed: string;
  intervention: string;
  proof: string;
  authority: string;
  format: string;
  hash: string;
}

interface GalleryData {
  scenes: GalleryScene[];
  casts: Record<string, string>;
  integrationJoin: Array<{
    contract: string;
    shape: string;
    state: string;
    boundary: string;
  }>;
  paneArchive: {
    schema: string;
    sourceCast: string;
    sourceCastSha256: string;
    paneCount: number;
  };
}

function joinStateLabel(state: string, shape: string): string {
  return state === 'join-only'
    ? `join-only · no cast witness · ${shape}`
    : `${state} · ${shape}`;
}

const encoded = document.querySelector<HTMLScriptElement>('#gallery-data')?.textContent;
if (!encoded) throw new Error('Harness gallery data is missing');
const gallery = JSON.parse(encoded) as GalleryData;
const tabs = document.querySelector<HTMLElement>('#scene-tabs')!;
const playerRoot = document.querySelector<HTMLElement>('#player-root')!;
const themeButton = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
const integrationSlots = document.querySelector<HTMLElement>('#integration-slots')!;
const paneInspector = document.querySelector<HTMLElement>('#parley-pane-inspector')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let active = 0;
let player: PortholePlayer | null = null;
let castUrl: string | null = null;
let activationGeneration = 0;

function text(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  themeButton.setAttribute('aria-label', `Use ${theme === 'dark' ? 'light' : 'dark'} theme`);
}

async function activate(index: number): Promise<void> {
  const generation = ++activationGeneration;
  active = (index + gallery.scenes.length) % gallery.scenes.length;
  const scene = gallery.scenes[active];
  for (const [buttonIndex, button] of [...tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')].entries()) {
    const selected = buttonIndex === active;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }

  text('scene-number', String(active + 1).padStart(2, '0'));
  text('scene-title', scene.label);
  text('scene-station', scene.station);
  text('scene-locus', scene.locus);
  text('scene-seed', scene.seed);
  text('scene-intervention', scene.intervention);
  text('scene-proof', scene.proof);
  text('scene-authority', scene.authority);
  text('scene-format', scene.format);
  text('scene-hash', scene.hash.slice(0, 12));
  paneInspector.hidden = scene.id !== 'parley-source';
  if (!paneInspector.hidden) {
    for (const history of paneInspector.querySelectorAll<HTMLElement>('.pane-history pre')) {
      history.scrollTop = history.scrollHeight;
    }
  }

  player?.destroy();
  if (castUrl) URL.revokeObjectURL(castUrl);
  playerRoot.replaceChildren();
  const nextCastUrl = URL.createObjectURL(new Blob([gallery.casts[scene.id]], { type: 'application/x-asciicast' }));
  const nextPlayer = new PortholePlayer(playerRoot, { reducedMotion, autoplay: false });
  castUrl = nextCastUrl;
  player = nextPlayer;
  try {
    await nextPlayer.load(nextCastUrl);
    if (generation !== activationGeneration || player !== nextPlayer) {
      nextPlayer.destroy();
      URL.revokeObjectURL(nextCastUrl);
      return;
    }
    if (!reducedMotion) nextPlayer.restart();
    const title = playerRoot.querySelector<HTMLElement>('.ph-title b');
    if (title) title.textContent = `pd · ${scene.station}`;
  } catch (error) {
    nextPlayer.destroy();
    URL.revokeObjectURL(nextCastUrl);
    if (generation !== activationGeneration || player !== nextPlayer) return;
    player = null;
    castUrl = null;
    const failure = document.createElement('p');
    failure.className = 'player-error';
    failure.role = 'alert';
    failure.textContent = `Replay unavailable: ${error instanceof Error ? error.message : 'cast load failed'}`;
    playerRoot.replaceChildren(failure);
  }
}

for (const [index, scene] of gallery.scenes.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.role = 'tab';
  button.id = `scene-tab-${scene.id}`;
  button.setAttribute('aria-controls', 'player-root');
  button.setAttribute('aria-selected', String(index === 0));
  button.tabIndex = index === 0 ? 0 : -1;
  button.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span><strong>${scene.station}</strong><small>${scene.format}</small>`;
  button.addEventListener('click', () => void activate(index));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? gallery.scenes.length - 1
        : active + (event.key === 'ArrowRight' ? 1 : -1);
    void activate(target).then(() => tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')[active]?.focus());
  });
  tabs.appendChild(button);
}

themeButton.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
for (const button of paneInspector.querySelectorAll<HTMLButtonElement>('[data-pane-latest]')) {
  button.addEventListener('click', () => {
    const paneId = button.dataset.paneLatest;
    const history = paneId ? document.getElementById(`pane-history-${paneId}`) : null;
    if (history) history.scrollTop = history.scrollHeight;
  });
}
setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
for (const entry of gallery.integrationJoin) {
  const slot = document.createElement('article');
  slot.className = 'integration-slot';
  const title = document.createElement('strong');
  title.textContent = entry.contract;
  const state = document.createElement('span');
  state.textContent = joinStateLabel(entry.state, entry.shape);
  const boundary = document.createElement('p');
  boundary.textContent = entry.boundary;
  slot.append(title, state, boundary);
  integrationSlots.append(slot);
}
void activate(0);
