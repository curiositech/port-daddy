/**
 * Unit tests for git shim destructive-verb detection.
 *
 * The shim is a bash script embedded as a string in cli/utils/git-shim.ts.
 * We don't spawn it (that would need a real PATH + real git); we assert
 * the script content references each verb the v2 design promises to cover,
 * and that the version stamp bumped from v1.
 *
 * Why this matters: shim coverage is the structural enforcement of the
 * "Git Hygiene For Shared Trees" rule in skills/port-daddy-cli/SKILL.md.
 * If the script silently loses a verb, the next auto-stash incident
 * is invisible until it has already happened.
 */
import { describe, expect, test } from '@jest/globals';
import { GIT_SHIM_CONTENT, SHIM_VERSION } from '../../cli/utils/git-shim.js';

describe('git shim v2 destructive-verb coverage', () => {
  test('SHIM_VERSION is bumped to 2', () => {
    expect(SHIM_VERSION).toBe('2');
  });

  test('shim header documents v2', () => {
    expect(GIT_SHIM_CONTENT).toContain('Port Daddy git shim v2');
  });

  test('shim intercepts the original v1 verbs', () => {
    // reset --hard
    expect(GIT_SHIM_CONTENT).toContain('verb="reset-hard"');
    // checkout -- paths
    expect(GIT_SHIM_CONTENT).toContain('verb="checkout-paths"');
    // clean -fd / -df / --force
    expect(GIT_SHIM_CONTENT).toContain('verb="clean-force"');
    // add -A
    expect(GIT_SHIM_CONTENT).toContain('verb="add-all"');
  });

  test('shim intercepts stash-push (the 2026-04-28 anti-pattern)', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="stash-push"');
    // bare 'git stash' default-pushes; explicit push/save also caught
    expect(GIT_SHIM_CONTENT).toMatch(/case\s+"\$\{2:-\}"/);
    expect(GIT_SHIM_CONTENT).toContain('push|save|""');
  });

  test('shim leaves restorative stash subcommands alone', () => {
    // pop/apply/drop/list/show/clear/store/create/branch are pass-through.
    // The bash arm `pop|apply|...) ;;` has no body — verify all names listed.
    expect(GIT_SHIM_CONTENT).toContain('pop|apply|drop|list|show|clear|store|create|branch');
  });

  test('shim intercepts cherry-pick except mid-flow controls', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="cherry-pick"');
    expect(GIT_SHIM_CONTENT).toMatch(/--continue\|--abort\|--quit\|--skip/);
  });

  test('shim intercepts rebase except mid-flow controls', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="rebase"');
    // rebase has more flow controls than cherry-pick
    expect(GIT_SHIM_CONTENT).toMatch(
      /--continue\|--abort\|--quit\|--skip\|--edit-todo\|--show-current-patch/,
    );
  });

  test('shim still honors PD_SHIM_OFF emergency bypass', () => {
    expect(GIT_SHIM_CONTENT).toContain('PD_SHIM_OFF');
  });

  test('shim refers operators to pd guard status on refusal', () => {
    expect(GIT_SHIM_CONTENT).toContain('pd guard status');
  });
});
