/**
 * Unit tests for git shim destructive-verb detection.
 *
 * The shim is a bash script embedded as a string in cli/utils/git-shim.ts.
 * We don't spawn it (that would need a real PATH + real git); we assert
 * the script content references each verb the v2 design promises to cover,
 * and that the version stamp bumped from v1.
 *
 * Why this matters: shim coverage is the structural enforcement of the
 * claim-aware git staging rule in
 * skills/port-daddy-agent-skill/references/cli-reference.md.
 * If the script silently loses a verb, the next auto-stash incident
 * is invisible until it has already happened.
 */
import { describe, expect, test } from '@jest/globals';
import { GIT_SHIM_CONTENT, SHIM_VERSION } from '../../cli/utils/git-shim.js';

describe('git shim v4 destructive-verb coverage', () => {
  test('SHIM_VERSION is bumped to 4', () => {
    expect(SHIM_VERSION).toBe('4');
  });

  test('shim header documents v4', () => {
    expect(GIT_SHIM_CONTENT).toContain('Port Daddy git shim v4');
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

  test('v5 (ADR-0119): shim has NO PD_SHIM_OFF emergency bypass', () => {
    // The env-var escape was removed — there is no agent-mintable stand-down.
    // See tests/unit/git-shim-no-escape.test.js for the runtime red-team proof.
    expect(GIT_SHIM_CONTENT).not.toContain('PD_SHIM_OFF');
  });

  test('shim refers operators to pd guard status on refusal', () => {
    expect(GIT_SHIM_CONTENT).toContain('pd guard status');
  });

  // v4 — guardrails never advertise their bypass (ADR-0053 Phase 0b).
  // The agent-facing refusal message points only at the corrective action,
  // never naming an escape. An agent takes whatever exit the error hands it.
  test('v4: refusal copy points to the corrective action, not the bypass', () => {
    expect(GIT_SHIM_CONTENT).toContain("coordinate first — 'pd begin'");
    // The agent-facing "bypass once with PD_SHIM_OFF=1 git" line is gone.
    expect(GIT_SHIM_CONTENT).not.toContain('bypass once with PD_SHIM_OFF');
  });

  test('v5 (ADR-0119): no PD_SHIM_OFF stand-down remains in the shim', () => {
    // ADR-0119 supersedes the ADR-0053 "keep the override, hide it" posture:
    // a bypass documented to the controlled party is not a control, so the
    // env-gated stand-down is removed entirely. Neither the `${PD_SHIM_OFF:-}`
    // read nor any env-gated early exit survives.
    expect(GIT_SHIM_CONTENT).not.toContain('PD_SHIM_OFF:-');
    expect(GIT_SHIM_CONTENT).not.toContain('PD_SHIM_OFF');
  });

  // -------------------------------------------------------------------------
  // v3 — public-history destructive verbs
  // -------------------------------------------------------------------------

  test('v3: shim intercepts plain --force / -f (refused on any branch)', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="push-force"');
    // plain --force / -f are detected separately from --force-with-lease so
    // the latter can be allowed on feature branches
    expect(GIT_SHIM_CONTENT).toContain('saw_plain_force');
  });

  test('v3: --force-with-lease is allowed on feature branches, refused on protected', () => {
    // The shim sets verb="push-force-lease-protected" only when
    // --force-with-lease combines with a protected branch target.
    // Without that combination, --force-with-lease falls through.
    expect(GIT_SHIM_CONTENT).toContain('verb="push-force-lease-protected"');
    expect(GIT_SHIM_CONTENT).toContain('saw_lease_force');
    expect(GIT_SHIM_CONTENT).toContain('--force-with-lease');
    // The "feature branch allowed" path is documented in the source comment
    expect(GIT_SHIM_CONTENT).toMatch(/--force-with-lease on a feature branch falls through/);
  });

  test('v3: shim intercepts push --mirror / --all / --prune (mass deletion)', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="push-mass"');
    expect(GIT_SHIM_CONTENT).toMatch(/--mirror\|--all\|--prune/);
  });

  test('v3: shim intercepts direct push to protected branches', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="push-protected"');
    // protected branches recognized literally + as refs/heads
    expect(GIT_SHIM_CONTENT).toContain('main|master|refs/heads/main|refs/heads/master');
    expect(GIT_SHIM_CONTENT).toContain('release/*|refs/heads/release/*');
  });

  test('v3: shim refuses filter-branch and filter-repo outright', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="history-rewrite"');
    expect(GIT_SHIM_CONTENT).toMatch(/filter-branch\|filter-repo/);
  });

  test('v3: shim intercepts update-ref on protected branches only', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="update-ref-protected"');
    expect(GIT_SHIM_CONTENT).toContain('refs/heads/main|refs/heads/master');
  });

  test('v3: shim intercepts branch -D on protected branches', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="branch-delete-protected"');
    // -D and --delete both trigger the saw_force_delete flag
    expect(GIT_SHIM_CONTENT).toMatch(/-D\|--delete/);
  });

  test('v5 (ADR-0119): no PD_SHIM_OFF bypass path exists to audit', () => {
    // The bypass is gone, so there is no `PD_SHIM_OFF=1` branch to log.
    expect(GIT_SHIM_CONTENT).not.toContain('PD_SHIM_OFF=1');
  });
});
