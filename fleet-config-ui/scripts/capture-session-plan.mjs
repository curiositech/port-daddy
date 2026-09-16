/**
 * Sample real browser frames through an already-approved browser runtime tab.
 * This does not launch/control a separate browser or capture an OS window.
 * Import in the browser skill's Node REPL and call with its documented tab.
 * Purpose: retain cadence, acquisition gaps and raw synthetic proof, without
 * pretending that sparse screenshots are native Porthole/full-rate recording.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Encode the acquired-frame timeline as a reproducible FFmpeg concat manifest.
 * @param directory Artifact directory containing sampled-capture.json.
 * @returns Path of the concat manifest, preserving real acquisition intervals.
 */
export async function writeFrameTimeline(directory) {
  const { frames } = JSON.parse(await readFile(resolve(directory, 'sampled-capture.json'), 'utf8'));
  const lines = ['ffconcat version 1.0'];
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (!/^frames\/frame-\d{4}\.jpg$/.test(frame.file)) throw new Error('Unexpected frame path');
    const duration = index + 1 < frames.length
      ? (frames[index + 1].acquiredAt - frame.acquiredAt) / 1000
      : 0.18;
    if (!(duration > 0)) throw new Error('Frame timestamps must increase');
    lines.push(`file '${frame.file}'`, 'option framerate 1000', `duration ${duration.toFixed(3)}`);
  }
  const path = resolve(directory, 'sampled-frames.ffconcat');
  await writeFile(path, lines.join('\n') + '\n');
  return path;
}

/**
 * Record one sequential synthetic interaction run using the documented tab API.
 * @param options Approved tab, fixture origin, artifact directory and source SHA.
 * @returns Acquisition metadata; no browser profile, operator data or audio.
 */
export async function captureSessionPlan({ tab, origin, directory, sourceHead }) {
  const url = new URL(origin);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Use the synthetic loopback fixture only');
  const response = await fetch(`${url.origin}/_session-plan-proof`);
  const proof = response.ok ? await response.json() : null;
  if (proof?.fixture !== 'session-plan-view' || proof.syntheticOnly !== true || proof.readOnly !== true) {
    throw new Error('The source did not identify itself as the synthetic read-only fixture');
  }
  const frames = [];
  const actions = [];
  await mkdir(resolve(directory, 'frames'), { recursive: true });
  const capture = async (phase) => {
    for (let index = 0; index < 6; index++) {
      const startedAt = Date.now();
      const bytes = await tab.screenshot({ fullPage: false });
      const acquiredAt = Date.now();
      const file = `frames/frame-${String(frames.length).padStart(4, '0')}.jpg`;
      await writeFile(resolve(directory, file), bytes);
      frames.push({ file, phase, startedAt, acquiredAt, bytes: bytes.length });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
    }
  };
  const action = (description, extra = {}) => actions.push({ at: Date.now(), action: description, ...extra });
  const route = (session) => `${url.origin}/fleet-ui/?${new URLSearchParams({ surface: 'agents', session, daemon: url.origin })}`;
  await tab.goto(route('session-synthetic-a'));
  await tab.ax.write();
  action('Capture exact synthetic session A before interaction');
  await capture('current-plan');
  action('Keyboard Enter expands newest receipt #9');
  await tab.playwright.locator('#session-note-9 > summary').press('Enter');
  await tab.ax.write();
  await capture('expanded-newest-receipt');
  const link = tab.playwright.getByRole('link', { name: 'Exact session link', exact: true });
  action('Follow source-bound exact session link', { href: await link.getAttribute('href') });
  await link.click();
  await tab.ax.write();
  await capture('source-bound-link-navigation');
  action('Refresh exact session A');
  await tab.playwright.getByRole('button', { name: 'Refresh', exact: true }).click();
  await tab.ax.write();
  await capture('refreshed-exact-session');
  action('Open explicit missing synthetic ID');
  await tab.goto(route('session-synthetic-missing'));
  await tab.ax.write();
  await capture('missing-exact-session');
  action('Refresh missing exact ID, no fallback');
  await tab.playwright.getByRole('button', { name: 'Refresh', exact: true }).click();
  await tab.ax.write();
  await capture('missing-stays-missing');
  action('Open explicit forbidden synthetic ID');
  await tab.goto(route('session-synthetic-denied'));
  await tab.ax.write();
  await capture('denied-exact-session');
  const manifest = {
    label: 'Sampled browser capture — real sequential synthetic UI run, not continuous or native Porthole',
    sourceHead, syntheticOnly: true, requestedMinimumFrameIntervalMs: 180, frames, actions,
  };
  await writeFile(resolve(directory, 'sampled-capture.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFrameTimeline(directory);
  return manifest;
}
