// the complete contents of tests/unit/purser/notification_payloads.test.js
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

describe('pd-app-watch.sh – notification payloads', () => {
  let scriptContent = '';

  beforeAll(async () => {
    // Resolve the script location relative to this test file.
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const scriptPath = path.resolve(__dirname, '../../../scripts/pd-app-watch.sh');
    scriptContent = await readFile(scriptPath, 'utf8');
  });

  test('emits a console‑failure notification for the latest lane', () => {
    const latestConsolePattern = /notify\s+"Port Daddy apps"\s+"latest lane build FAILED @ \\\$\\{MAIN_SHA:0:10\\} — check \\$BUILD_LOGS"/;
    expect(scriptContent).toMatch(latestConsolePattern);
  });

  test('emits a console‑failure notification for the prod lane', () => {
    const prodConsolePattern = /notify\s+"Port Daddy apps"\s+"prod lane build FAILED @ v\\$TAP_VERSION — check \\$BUILD_LOGS"/;
    expect(scriptContent).toMatch(prodConsolePattern);
  });

  test('emits a distinct FleetBar relaunch‑failure notification for dev‑latest', () => {
    const devFleetPattern = /notify\s+"Port Daddy apps"\s+"FleetBar dev-latest relaunch failed @ \\\$\\{MAIN_SHA:0:10\\} — pd-console OK, check \\$BUILD_LOGS"/;
    expect(scriptContent).toMatch(devFleetPattern);
  });

  test('emits a distinct FleetBar relaunch‑failure notification for prod', () => {
    const prodFleetPattern = /notify\s+"Port Daddy apps"\s+"FleetBar prod relaunch failed @ \\\$\\{MAIN_SHA:0:10\\} — pd-console-prod OK, check \\$BUILD_LOGS"/;
    expect(scriptContent).toMatch(prodFleetPattern);
  });

  test('console‑failure and FleetBar‑failure notifications are separate entries', () => {
    const notificationLines = [...scriptContent.matchAll(/notify\s+"Port Daddy apps"\s+"([^"]+)"/g)].map(m => m[1]);

    const consoleFailure = notificationLines.find(l => /lane build FAILED/.test(l));
    const fleetBarFailure = notificationLines.find(l => /FleetBar/.test(l) && /relaunch failed/.test(l));

    expect(consoleFailure).toBeDefined();
    expect(fleetBarFailure).toBeDefined();
    expect(consoleFailure).not.toBe(fleetBarFailure);
  });
});