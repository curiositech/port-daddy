/**
 * Unit tests for ADR-0037 scheduled backups (lib/backup-schedule.ts).
 *
 * The pure render/cron functions are tested directly; install/uninstall are
 * exercised through their non-darwin (crontab-fallback) branch so the test is
 * hermetic and never touches the real ~/Library/LaunchAgents or shells out to
 * launchctl. The darwin install path (launchctl bootstrap) is covered by the
 * real local round-trip in the PR description, not by a unit test that would
 * mutate the developer's login agents.
 */

import { describe, expect, test } from '@jest/globals';
import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  SCHEDULE_LABEL,
  renderSchedulePlist,
  cronLine,
  plistPath,
} from '../../lib/backup-schedule.js';

const PD = '/opt/homebrew/bin/pd';

describe('renderSchedulePlist', () => {
  test('emits a valid plist invoking `pd backup` at the given time', () => {
    const xml = renderSchedulePlist({ pdBinary: PD, hour: 3, minute: 17 });
    expect(xml).toContain('<?xml');
    expect(xml).toContain(`<string>${SCHEDULE_LABEL}</string>`);
    expect(xml).toContain(`<string>${PD}</string>`);
    expect(xml).toContain('<string>backup</string>');
    expect(xml).toContain('<key>Hour</key>');
    expect(xml).toContain('<integer>3</integer>');
    expect(xml).toContain('<integer>17</integer>');
    // Daily, calendar-driven — not RunAtLoad on a timer.
    expect(xml).toContain('<key>StartCalendarInterval</key>');
  });

  test('bakes extra args (retention/backend) into ProgramArguments', () => {
    const xml = renderSchedulePlist({
      pdBinary: PD,
      extraArgs: ['--retention', 'daily=14,keep=5', '--to', 'file:///backups'],
    });
    expect(xml).toContain('<string>--retention</string>');
    expect(xml).toContain('<string>daily=14,keep=5</string>');
    expect(xml).toContain('<string>--to</string>');
    expect(xml).toContain('<string>file:///backups</string>');
  });

  test('XML-escapes a binary path containing an ampersand', () => {
    const xml = renderSchedulePlist({ pdBinary: '/opt/pd & co/pd' });
    expect(xml).toContain('/opt/pd &amp; co/pd');
    expect(xml).not.toContain('/opt/pd & co/pd');
  });

  test('defaults to 03:17 when no time given', () => {
    const xml = renderSchedulePlist({ pdBinary: PD });
    expect(xml).toContain('<integer>3</integer>');
    expect(xml).toContain('<integer>17</integer>');
  });

  test('pins scheduled backups to the canonical user DB', () => {
    const xml = renderSchedulePlist({ pdBinary: PD });

    expect(xml).toContain('<key>PORT_DADDY_DB</key>');
    expect(xml).toContain(
      `<string>${join(homedir(), '.port-daddy', 'port-registry.db')}</string>`,
    );
  });
});

describe('cronLine', () => {
  test('formats a daily crontab entry', () => {
    expect(cronLine({ pdBinary: PD, hour: 3, minute: 17 })).toBe(`17 3 * * * ${PD} backup`);
  });
  test('includes extra args', () => {
    expect(cronLine({ pdBinary: PD, hour: 4, minute: 0, extraArgs: ['--retention', 'keep=10'] }))
      .toBe(`0 4 * * * ${PD} backup --retention keep=10`);
  });
});

describe('plistPath', () => {
  test('defaults under ~/Library/LaunchAgents', () => {
    expect(plistPath({ pdBinary: PD })).toBe(
      join(homedir(), 'Library', 'LaunchAgents', `${SCHEDULE_LABEL}.plist`),
    );
  });
  test('honors a launchAgentsDir override', () => {
    expect(plistPath({ pdBinary: PD, launchAgentsDir: '/custom/agents' })).toBe(
      `/custom/agents/${SCHEDULE_LABEL}.plist`,
    );
  });
});
