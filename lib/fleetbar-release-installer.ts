import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const RELEASE_REPOSITORY = 'curiositech/port-daddy';
const BUNDLE_IDENTIFIER = 'ai.portdaddy.FleetBar';
const DEVELOPER_TEAM = 'P5H9P59X2M';
const LAUNCH_AGENT_LABEL = 'com.portdaddy.fleetbar';

export interface FleetBarReleaseArtifact {
  version: string;
  architecture: 'arm64' | 'x86_64';
  archiveName: string;
  archiveURL: string;
  checksumURL: string;
}

export interface FleetBarInstallResult {
  version: string;
  appPath: string;
  backupPath?: string;
}

export function fleetBarReleaseArtifact(version: string, architecture: string = process.arch): FleetBarReleaseArtifact {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`FleetBar release version must be an exact X.Y.Z tag (got ${version})`);
  }
  const normalizedArch = architecture === 'arm64'
    ? 'arm64'
    : architecture === 'x64' || architecture === 'x86_64'
      ? 'x86_64'
      : null;
  if (!normalizedArch) {
    throw new Error(`FleetBar does not publish a macOS archive for ${architecture}`);
  }
  const archiveName = `PortDaddy-FleetBar-macOS-${normalizedArch}.zip`;
  const root = `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}`;
  return {
    version,
    architecture: normalizedArch,
    archiveName,
    archiveURL: `${root}/${archiveName}`,
    checksumURL: `${root}/${archiveName}.sha256`,
  };
}

export function parseFleetBarChecksum(text: string, archiveName: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) throw new Error('FleetBar checksum file must contain exactly one entry');
  const match = /^([a-fA-F0-9]{64})\s+(.+)$/.exec(lines[0]);
  if (!match) throw new Error('FleetBar checksum file is malformed');
  if (match[2] !== archiveName) {
    throw new Error(`FleetBar checksum names ${match[2]}, expected ${archiveName}`);
  }
  return match[1].toLowerCase();
}

function run(executable: string, args: string[], accepted = [0]): string {
  const result = spawnSync(executable, args, { encoding: 'utf8' });
  const status = result.status ?? -1;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (!accepted.includes(status)) {
    throw new Error(`${basename(executable)} failed (${status})${output ? `: ${output}` : ''}`);
  }
  return output;
}

function plistValue(appPath: string, key: string): string {
  return run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')]);
}

function verifyFleetBarBundle(appPath: string, version: string): void {
  if (!existsSync(join(appPath, 'Contents', 'MacOS', 'FleetBar'))) {
    throw new Error('downloaded FleetBar.app is incomplete');
  }
  if (plistValue(appPath, 'CFBundleIdentifier') !== BUNDLE_IDENTIFIER) {
    throw new Error('downloaded FleetBar has the wrong bundle identifier');
  }
  if (plistValue(appPath, 'CFBundleShortVersionString') !== version) {
    throw new Error(`downloaded FleetBar does not report version ${version}`);
  }

  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const signature = run('/usr/bin/codesign', ['-dv', '--verbose=4', appPath]);
  if (!signature.includes(`Identifier=${BUNDLE_IDENTIFIER}`) || !signature.includes(`TeamIdentifier=${DEVELOPER_TEAM}`)) {
    throw new Error('downloaded FleetBar is not signed by Curiositech');
  }
  const designated = run('/usr/bin/codesign', ['-dr', '-', appPath]);
  const exactRequirementParts = [
    `identifier "${BUNDLE_IDENTIFIER}"`,
    `certificate leaf[subject.OU] = ${DEVELOPER_TEAM}`,
    'certificate 1[field.1.2.840.113635.100.6.2.6]',
    'certificate leaf[field.1.2.840.113635.100.6.1.13]',
  ];
  if (!exactRequirementParts.every((part) => designated.includes(part))) {
    throw new Error('downloaded FleetBar does not carry the exact production designated requirement');
  }
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
}

function launchAgentPlist(appPath: string): string {
  const escaped = appPath
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const logPath = join(homedir(), '.port-daddy', 'fleetbar-prod.log')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>
<key>ProgramArguments</key><array><string>${escaped}/Contents/MacOS/FleetBar</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${logPath}</string>
<key>StandardErrorPath</key><string>${logPath}</string>
<key>ProcessType</key><string>Interactive</string>
</dict></plist>
`;
}

function currentUid(): number {
  if (typeof process.getuid !== 'function') throw new Error('FleetBar install requires a local macOS user session');
  return process.getuid();
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Installs the exact signed FleetBar release that matches the running daemon.
 *
 * The archive is pinned to a version tag, checked against its named SHA-256
 * entry, validated with codesign and Gatekeeper, then swapped into the user's
 * Applications directory with an on-disk rollback bundle.
 */
export async function installFleetBarRelease(version: string): Promise<FleetBarInstallResult> {
  if (process.platform !== 'darwin') throw new Error('FleetBar is available only on macOS');
  const artifact = fleetBarReleaseArtifact(version);
  const [archive, checksumBytes] = await Promise.all([
    download(artifact.archiveURL),
    download(artifact.checksumURL),
  ]);
  const expected = parseFleetBarChecksum(checksumBytes.toString('utf8'), artifact.archiveName);
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error('FleetBar archive checksum mismatch; nothing was installed');

  const installRoot = join(homedir(), 'Applications', 'Port Daddy');
  const appPath = join(installRoot, 'FleetBar.app');
  const launchAgentPath = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(dirname(launchAgentPath), { recursive: true });
  mkdirSync(join(homedir(), '.port-daddy'), { recursive: true });
  const staging = mkdtempSync(join(installRoot, '.fleetbar-update-'));
  const archivePath = join(staging, artifact.archiveName);
  const expanded = join(staging, 'expanded');
  mkdirSync(expanded);

  let backupPath: string | undefined;
  let oldMoved = false;
  try {
    writeFileSync(archivePath, archive, { mode: 0o600 });
    run('/usr/bin/ditto', ['-x', '-k', archivePath, expanded]);
    const candidate = join(expanded, 'FleetBar.app');
    verifyFleetBarBundle(candidate, version);

    // Stop launchd before moving the bundle so it cannot race the replacement.
    const uid = currentUid();
    run('/bin/launchctl', ['bootout', `gui/${uid}`, launchAgentPath], [0, 3, 5, 113]);
    if (existsSync(appPath)) {
      const oldVersion = (() => {
        try { return plistValue(appPath, 'CFBundleShortVersionString'); } catch { return 'unknown'; }
      })();
      const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
      backupPath = `${appPath}.backup-${oldVersion}-${stamp}`;
      renameSync(appPath, backupPath);
      oldMoved = true;
    }

    try {
      renameSync(candidate, appPath);
      chmodSync(join(appPath, 'Contents', 'MacOS', 'FleetBar'), 0o755);
      writeFileSync(launchAgentPath, launchAgentPlist(appPath), { mode: 0o600 });
      run('/bin/launchctl', ['bootstrap', `gui/${uid}`, launchAgentPath]);
      run('/bin/launchctl', ['kickstart', '-k', `gui/${uid}/${LAUNCH_AGENT_LABEL}`]);
    } catch (error) {
      rmSync(appPath, { recursive: true, force: true });
      if (oldMoved && backupPath && existsSync(backupPath)) renameSync(backupPath, appPath);
      try {
        writeFileSync(launchAgentPath, launchAgentPlist(appPath), { mode: 0o600 });
        run('/bin/launchctl', ['bootstrap', `gui/${uid}`, launchAgentPath], [0, 5]);
      } catch {
        // Preserve the original install error. The rollback bundle remains on disk.
      }
      throw error;
    }

    return { version, appPath, backupPath };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function packageVersion(projectRoot: string): string {
  const parsed = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
    throw new Error('package.json does not contain an exact FleetBar release version');
  }
  return parsed.version;
}
