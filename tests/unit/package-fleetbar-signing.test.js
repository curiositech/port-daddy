import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');
const onDarwin = process.platform === 'darwin';
const macTest = onDarwin ? test : test.skip;
const NODE_22_BIN = '/opt/homebrew/opt/node@22/bin';

function makeExecutableCopy(source, target) {
  copyFileSync(source, target);
  chmodSync(target, 0o755);
}

function writeExecutableScript(target, contents) {
  writeFileSync(target, contents);
  chmodSync(target, 0o755);
}

function parseLoggedCommand(line) {
  const separator = line.indexOf('|');
  const command = separator === -1 ? line : line.slice(0, separator);
  const rawArgs = separator === -1 ? '' : line.slice(separator + 1);
  const args = rawArgs.trim() === '' ? [] : rawArgs.trim().split(/\s+/);
  return { command, args, rawArgs };
}

describe('FleetBar release signing coverage', () => {
  let root;
  let fakeBinDir;
  let fakeFleetBarDir;
  let payloadSourceDir;
  let outputDir;
  let releaseBinary;
  let logPath;

  beforeEach(() => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    root = mkdtempSync(join(SCRATCH_ROOT, 'pd-fleetbar-signing-fixture-'));
    fakeBinDir = join(root, 'bin');
    fakeFleetBarDir = join(root, 'apps', 'FleetBar');
    payloadSourceDir = join(root, 'payload-source');
    outputDir = join(root, 'dist');
    releaseBinary = join(root, 'release-bin', 'FleetBar');
    logPath = join(root, 'tool-calls.log');

    mkdirSync(fakeBinDir, { recursive: true });
    mkdirSync(join(fakeFleetBarDir, 'FleetBar', 'Resources'), { recursive: true });
    mkdirSync(join(payloadSourceDir, 'native', 'onnxruntime-node', 'darwin-arm64'), { recursive: true });
    mkdirSync(join(releaseBinary, '..'), { recursive: true });

    writeFileSync(join(fakeFleetBarDir, 'FleetBar-Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>CFBundleVersion</key>
  <string>0</string>
</dict>
</plist>
`);
    writeFileSync(join(fakeFleetBarDir, 'FleetBar', 'Resources', 'FleetBarIcon.icns'), 'icon');
    writeFileSync(
      join(payloadSourceDir, 'port-daddy-manifest.json'),
      JSON.stringify({
        embeddedNativeCore: { status: 'embedded' },
        smoke: { daemon: { arbiter: { enforcerLoaded: true } } },
      }),
    );

    makeExecutableCopy('/bin/ls', releaseBinary);
    makeExecutableCopy('/bin/ls', join(payloadSourceDir, 'pd'));
    makeExecutableCopy('/bin/ls', join(payloadSourceDir, 'port-daddy'));
    makeExecutableCopy(
      '/bin/ls',
      join(payloadSourceDir, 'native', 'onnxruntime-node', 'darwin-arm64', 'libonnxruntime.1.dylib'),
    );
    symlinkSync(
      'libonnxruntime.1.dylib',
      join(payloadSourceDir, 'native', 'onnxruntime-node', 'darwin-arm64', 'libonnxruntime-linked.dylib'),
    );

    writeExecutableScript(join(fakeBinDir, 'swift'), `#!/usr/bin/env bash
set -euo pipefail
printf 'swift|%s\\n' "$*" >> '${logPath}'
exit 42
`);
    writeExecutableScript(join(fakeBinDir, 'codesign'), `#!/usr/bin/env bash
set -euo pipefail
printf 'codesign|%s\\n' "$*" >> '${logPath}'
exit 0
`);
    writeExecutableScript(join(fakeBinDir, 'ditto'), `#!/usr/bin/env bash
set -euo pipefail
printf 'ditto|%s\\n' "$*" >> '${logPath}'
out="\${!#}"
mkdir -p "$(dirname "$out")"
: > "$out"
`);
    writeExecutableScript(join(fakeBinDir, 'xcrun'), `#!/usr/bin/env bash
set -euo pipefail
printf 'xcrun|%s\\n' "$*" >> '${logPath}'
if [[ "$1" == "notarytool" && "$2" == "submit" ]]; then
  printf '%s\\n' '{"id":"submission-123","status":"Invalid"}'
  exit 0
fi
exit 0
`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  macTest('discovers nested Mach-O payloads, signs inside-out, and logs rejected notarization results', () => {
    const scriptPath = join(process.cwd(), 'scripts', 'package-fleetbar.sh');
    const outDir = join(root, 'out');
    const env = {
      ...process.env,
      PATH: `${NODE_22_BIN}:${fakeBinDir}:${process.env.PATH}`,
      PORT_DADDY_FLEETBAR_TEST_MODE: '1',
      PORT_DADDY_FLEETBAR_TEST_FIXTURE_ROOT: root,
      PORT_DADDY_SIGN_IDENTITY: 'Developer ID Application: Test (ABCDE12345)',
      PORT_DADDY_NOTARY_PROFILE: 'pd-notary',
      PORT_DADDY_FLEETBAR_ZIP: 'PortDaddy-FleetBar-test.zip',
      PORT_DADDY_SKIP_NOTARIZE: '0',
    };

    const result = spawnSync('bash', [scriptPath, outDir], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain('Fetching Apple notarization log for request submission-123...');
    expect(result.stderr).toContain('Notarization failed with status: Invalid');
    expect(existsSync(logPath)).toBe(true);

    const lines = readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    const parsed = lines.map(parseLoggedCommand);
    const codesignCalls = parsed.filter((call) => call.command === 'codesign');
    const signCalls = codesignCalls.filter((call) => !call.args.includes('--verify'));
    const verifyCall = codesignCalls.find((call) => call.args.includes('--verify'));
    const xcrunCalls = parsed.filter((call) => call.command === 'xcrun');

    const appBundle = signCalls.at(-1)?.args.at(-1);
    expect(appBundle).toBeDefined();
    expect(appBundle).toContain('FleetBar.app');

    const nestedDylib = join(
      appBundle,
      'Contents',
      'Resources',
      'PortDaddy',
      'native',
      'onnxruntime-node',
      'darwin-arm64',
      'libonnxruntime.1.dylib',
    );
    const payloadPd = join(appBundle, 'Contents', 'Resources', 'PortDaddy', 'pd');
    const payloadPortDaddy = join(appBundle, 'Contents', 'Resources', 'PortDaddy', 'port-daddy');
    const linkedDylib = join(
      appBundle,
      'Contents',
      'Resources',
      'PortDaddy',
      'native',
      'onnxruntime-node',
      'darwin-arm64',
      'libonnxruntime-linked.dylib',
    );
    const fleetbarHost = join(appBundle, 'Contents', 'MacOS', 'FleetBar');
    const portDaddyEntitlements = join(process.cwd(), 'scripts', 'entitlements', 'port-daddy.plist');
    const fleetbarEntitlements = join(process.cwd(), 'scripts', 'entitlements', 'fleetbar.plist');

    expect(signCalls.map((call) => call.args.at(-1))).toEqual([
      nestedDylib,
      payloadPd,
      payloadPortDaddy,
      fleetbarHost,
      appBundle,
    ]);
    expect(signCalls.find((call) => call.args.at(-1) === nestedDylib)?.args).not.toContain('--entitlements');
    expect(signCalls.find((call) => call.args.at(-1) === payloadPd)?.args).not.toContain('--entitlements');
    expect(signCalls.find((call) => call.args.at(-1) === payloadPortDaddy)?.args).toEqual(
      expect.arrayContaining(['--entitlements', portDaddyEntitlements]),
    );
    expect(signCalls.some((call) => call.args.at(-1) === linkedDylib)).toBe(false);
    expect(signCalls.find((call) => call.args.at(-1) === fleetbarHost)?.args).toEqual(
      expect.arrayContaining(['--entitlements', fleetbarEntitlements]),
    );
    expect(signCalls.find((call) => call.args.at(-1) === appBundle)?.args).toEqual(
      expect.arrayContaining(['--entitlements', fleetbarEntitlements]),
    );
    expect(verifyCall?.args).toEqual(
      expect.arrayContaining(['--verify', '--deep', '--strict', '--verbose=2', appBundle]),
    );

    const submitCall = xcrunCalls.find((call) => call.args[0] === 'notarytool' && call.args[1] === 'submit');
    const logCall = xcrunCalls.find((call) => call.args[0] === 'notarytool' && call.args[1] === 'log');
    expect(submitCall?.args).toEqual(expect.arrayContaining(['--output-format', 'json']));
    expect(logCall?.args).toEqual(expect.arrayContaining(['submission-123']));
    expect(signCalls[0].args.at(-1)).toBe(nestedDylib);
    expect(signCalls[signCalls.length - 1].args.at(-1)).toBe(appBundle);
    expect(signCalls.indexOf(signCalls.find((call) => call.args.at(-1) === nestedDylib))).toBeLessThan(
      signCalls.indexOf(signCalls.find((call) => call.args.at(-1) === payloadPd)),
    );
    expect(signCalls.indexOf(signCalls.find((call) => call.args.at(-1) === payloadPd))).toBeLessThan(
      signCalls.indexOf(signCalls.find((call) => call.args.at(-1) === payloadPortDaddy)),
    );
    expect(signCalls.indexOf(signCalls.find((call) => call.args.at(-1) === payloadPortDaddy))).toBeLessThan(
      signCalls.indexOf(signCalls.find((call) => call.args.at(-1) === fleetbarHost)),
    );
    expect(signCalls.indexOf(signCalls.find((call) => call.args.at(-1) === fleetbarHost))).toBeLessThan(
      signCalls.indexOf(signCalls.find((call) => call.args.at(-1) === appBundle)),
    );
  });

  macTest('rejects fixture overrides unless explicit test mode is enabled', () => {
    const scriptPath = join(process.cwd(), 'scripts', 'package-fleetbar.sh');
    const result = spawnSync('bash', [scriptPath, join(root, 'out-without-mode')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${NODE_22_BIN}:${fakeBinDir}:${process.env.PATH}`,
        PORT_DADDY_FLEETBAR_TEST_FIXTURE_ROOT: root,
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires PORT_DADDY_FLEETBAR_TEST_MODE=1');
    expect(existsSync(logPath)).toBe(false);
  });

  macTest('rejects test fixture roots outside the dedicated coding scratch tree', () => {
    const scriptPath = join(process.cwd(), 'scripts', 'package-fleetbar.sh');
    const result = spawnSync('bash', [scriptPath, join(root, 'out-outside-root')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${NODE_22_BIN}:${fakeBinDir}:${process.env.PATH}`,
        PORT_DADDY_FLEETBAR_TEST_MODE: '1',
        PORT_DADDY_FLEETBAR_TEST_FIXTURE_ROOT: homedir(),
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be contained under');
    expect(existsSync(logPath)).toBe(false);
  });
});
