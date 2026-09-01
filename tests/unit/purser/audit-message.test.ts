// tests/unit/purser/audit-message.test.ts
import { evaluateGuardFacts, describeGuardBlock, enforce } from '../../../cli/commands/guard.ts';

/**
 * This test validates the *post‑commit* coordination audit message.
 *
 * According to the PR contract, after a successful commit the guard must **not**
 * block the operation. Instead it should emit a notice whose message is exactly:
 *
 *   "Post-commit coordination audit needs remediation"
 *
 * The test also checks that the notice is classified with severity
 * "requirement", which is the expected level for post‑commit remediation
 * notices.
 */
describe('Post‑commit coordination audit message', () => {
  test('should present remediation notice instead of a block', () => {
    // Simulate a guard evaluation that occurs at commit time with a single
    // changed file owned by the committing agent.
    const result = evaluateGuardFacts({
      config: enforce,
      active: true,
      agentId: 'agent-self',
      sessionId: 'session-self',
      files: ['src/a.ts'],
      ownersByFile: {
        'src/a.ts': [{ agentId: 'agent-self', sessionId: 'session-self' }],
      },
      commitsSinceLastNote: 1,
      atCommitTime: true,
    });

    // Describe the block/notice that would be shown to the operator.
    const notice = describeGuardBlock(result, { hook: true, postCommit: true });

    // The guard must not treat this as a hard block.
    expect(notice.severity).toBe('requirement');

    // Exact string required by the contract.
    expect(notice.message).toBe(
      'Post-commit coordination audit needs remediation'
    );
  });
});