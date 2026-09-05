/** Use only the already-selected documented Browser tab; no alternate controller. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFrameTimeline } from '../../../fleet-config-ui/scripts/capture-session-plan.mjs';

export async function captureSalvageHolds({ tab, origin, source }) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Synthetic loopback fixture required');
  const response = await fetch(`${url.origin}/_salvage-hold-proof`);
  const marker = response.ok ? await response.json() : null;
  if (marker?.fixture !== 'salvage-durable-hold-ui' || marker.syntheticOnly !== true || marker.readOnly !== true) {
    throw Error('Not the synthetic read-only proof source');
  }
  const directory = fileURLToPath(new URL('./', import.meta.url));
  await mkdir(resolve(directory, 'frames'), { recursive: true });
  const frames = [], actions = [];
  const sample = async phase => {
    for (let index = 0; index < 6; index++) {
      const startedAt = Date.now();
      const bytes = await tab.screenshot({ fullPage: false });
      const acquiredAt = Date.now();
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw Error('Expected JPEG screenshot bytes; update the format/timeline contract before recording another format');
      }
      const file = `frames/frame-${String(frames.length).padStart(4, '0')}.jpg`;
      await writeFile(resolve(directory, file), bytes);
      frames.push({ file, phase, startedAt, acquiredAt, bytes: bytes.length });
      await new Promise(done => setTimeout(done, 180));
    }
  };
  const action = description => actions.push({ at: Date.now(), action: description });
  action('Open dark synthetic directory with distinct same-role bodies');
  await tab.goto(`${url.origin}/fleet-ui/?surface=agents&theme=dark`);
  await tab.playwright.domSnapshot();
  await sample('dark-dormant');
  action('Select earlier admitted synthetic replacement');
  await tab.playwright.getByRole('button', { name: /Synthetic earlier admission/ }).click();
  await tab.playwright.domSnapshot();
  await sample('dark-earlier-admission');
  action('Select ordinary same-role sibling; exact dismissal remains separate from ambiguous role actions');
  await tab.playwright.getByRole('button', { name: /Synthetic ordinary entry/ }).click();
  await tab.playwright.domSnapshot();
  await sample('dark-ordinary-sibling');
  action('Refresh; selected ordinary body remains exact');
  await tab.playwright.getByRole('button', { name: 'Refresh', exact: true }).click();
  await tab.playwright.domSnapshot();
  await sample('dark-refreshed-ordinary');
  action('Open the same synthetic directory in light theme');
  await tab.goto(`${url.origin}/fleet-ui/?surface=agents&theme=light`);
  await tab.playwright.domSnapshot();
  await sample('light-dormant');
  const manifest = {
    label: 'Sampled browser capture: one real sequential synthetic UI run; not continuous recording or native Porthole',
    source, syntheticOnly: true, requestedMinimumFrameIntervalMs: 180, frames, actions,
  };
  await writeFile(resolve(directory, 'sampled-capture.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFrameTimeline(directory);
  return { frames: frames.length, firstAcquiredAt: frames[0].acquiredAt, lastAcquiredAt: frames.at(-1).acquiredAt, directory };
}
