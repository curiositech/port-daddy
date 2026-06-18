import { evaluateSwarmFit, tallyCouncilVotes } from '../../lib/swarm-coordination.js';

describe('evaluateSwarmFit', () => {
  test('keeps strict sequential work single-agent and adds inspector when verification exists', () => {
    const decision = evaluateSwarmFit({
      reasoningShape: 'depth_first',
      singleAgentBaseline: 0.72,
      fitsInOneContext: true,
      taskValueMultiplier: 4,
      estimatedTokenMultiplier: 3,
      subtaskIndependence: 'none',
      writeContention: 'high',
      verificationAvailable: true,
      heterogeneousAgents: false,
    });

    expect(decision.topology).toBe('single_agent_with_inspector');
    expect(decision.allowed).toBe(true);
    expect(decision.risks).toEqual(expect.arrayContaining([
      expect.stringMatching(/handoff tax/),
      expect.stringMatching(/breakeven/),
    ]));
  });

  test('recommends read-only council for valuable breadth-first work with independent subtasks', () => {
    const decision = evaluateSwarmFit({
      reasoningShape: 'breadth_first',
      singleAgentBaseline: 0.28,
      fitsInOneContext: false,
      taskValueMultiplier: 20,
      estimatedTokenMultiplier: 8,
      subtaskIndependence: 'high',
      writeContention: 'low',
      verificationAvailable: true,
      heterogeneousAgents: true,
    });

    expect(decision.topology).toBe('read_only_council');
    expect(decision.allowed).toBe(true);
    expect(decision.confidence).toBe('high');
  });

  test('keeps writes single-threaded when subtasks are only partially independent', () => {
    const decision = evaluateSwarmFit({
      reasoningShape: 'mixed',
      singleAgentBaseline: 0.32,
      fitsInOneContext: false,
      taskValueMultiplier: 15,
      estimatedTokenMultiplier: 9,
      subtaskIndependence: 'partial',
      writeContention: 'high',
      verificationAvailable: true,
      heterogeneousAgents: true,
    });

    expect(decision.topology).toBe('single_writer_council');
    expect(decision.requirements).toEqual(expect.arrayContaining([
      expect.stringMatching(/single-threaded/),
    ]));
  });

  test('marks parallel writers as lab-only', () => {
    const decision = evaluateSwarmFit({
      reasoningShape: 'breadth_first',
      singleAgentBaseline: 0.2,
      fitsInOneContext: false,
      taskValueMultiplier: 30,
      estimatedTokenMultiplier: 10,
      subtaskIndependence: 'high',
      writeContention: 'medium',
      verificationAvailable: true,
      heterogeneousAgents: true,
      maxConcurrentWriters: 3,
    });

    expect(decision.topology).toBe('lab_only_swarm');
    expect(decision.allowed).toBe(false);
    expect(decision.requirements).toEqual(expect.arrayContaining([
      expect.stringMatching(/collapse to one writer/),
    ]));
  });
});

describe('tallyCouncilVotes', () => {
  test('tallies a majority while preserving failed roles', () => {
    const tally = tallyCouncilVotes([
      { role: 'researcher', status: 'succeeded', vote: 'C' },
      { role: 'engineer', status: 'succeeded', vote: 'A' },
      { role: 'archaeologist', status: 'succeeded', vote: 'C' },
      { role: 'cynic', status: 'succeeded', vote: 'C' },
      { role: 'dreamer', status: 'failed' },
      { role: 'cartographer', status: 'timed_out' },
    ], { quorum: 4 });

    expect(tally.quorumMet).toBe(true);
    expect(tally.leadingVote).toBe('C');
    expect(tally.consensus).toBe('majority');
    expect(tally.missingRoles).toEqual(['dreamer', 'cartographer']);
    expect(tally.risks).toContain('partial council failure must remain visible');
  });

  test('blocks when unanimity is required and dissent exists', () => {
    const tally = tallyCouncilVotes([
      { role: 'archaeologist', status: 'succeeded', vote: 'C' },
      { role: 'engineer', status: 'succeeded', vote: 'A' },
      { role: 'operator', status: 'succeeded', vote: 'C' },
    ], { quorum: 3, requireUnanimity: true });

    expect(tally.consensus).toBe('blocked');
    expect(tally.leadingVote).toBe('C');
    expect(tally.dissenters).toEqual(['engineer']);
  });

  test('does not invent consensus when quorum fails', () => {
    const tally = tallyCouncilVotes([
      { role: 'researcher', status: 'succeeded', vote: 'A' },
      { role: 'engineer', status: 'failed' },
      { role: 'dreamer', status: 'timed_out' },
    ], { quorum: 2 });

    expect(tally.quorumMet).toBe(false);
    expect(tally.consensus).toBe('none');
    expect(tally.leadingVote).toBeNull();
    expect(tally.risks).toContain('quorum not met');
  });
});
