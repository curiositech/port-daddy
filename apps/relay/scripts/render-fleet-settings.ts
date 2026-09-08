/** Offline rendering fixtures only: no authentication, database or network calls. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderFleetSettings, type FleetSettingsView } from '../src/fleet-settings-page.js';

const destination = process.argv[2];
if (!destination) throw new Error('Supply an owned artifact directory');
mkdirSync(destination, { recursive: true });
/** Purpose: create explicitly synthetic display state without a database.
 * @param scope Fixture key.
 * @param enabled Fixture preference.
 * @param available Fixture read availability.
 * @returns A static renderer input, not a stored control or live receipt.
 */
const control = (scope: string, enabled: boolean, available = true) => ({ scope, enabled, available, revision: 3 });
const notice = 'Offline rendering fixture. No deployed service or real account data.';
const fixtures: Record<string, FleetSettingsView> = {
  account: { admin: false, global: control('global', true), installations: [{ id: 42, name: 'Example organization', control: control('installation:42', true) }], notice },
  stopped: { admin: false, global: control('global', false), installations: [{ id: 42, name: 'Example organization', control: control('installation:42', true) }], notice },
  admin: { admin: true, global: control('global', true), installations: [], notice },
  unavailable: { admin: true, global: control('global', false, false), installations: null, notice },
};
for (const [name, view] of Object.entries(fixtures)) writeFileSync(resolve(destination, `${name}.html`), renderFleetSettings(view).replace(/[\t ]+$/gm, ''));
console.log(`Rendered ${Object.keys(fixtures).length} offline Fleet settings fixtures`);
