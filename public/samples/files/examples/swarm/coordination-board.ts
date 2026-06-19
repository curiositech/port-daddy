#!/usr/bin/env npx tsx
/**
 * Port Daddy swarm coordination board.
 *
 * This is a complete, runnable multi-agent pattern in one process. It models
 * four agents coordinating through sessions, channels, tuples, locks, and notes.
 *
 * Run:
 *   npx tsx examples/swarm/coordination-board.ts
 */

import { PortDaddy } from '../../lib/client.js';

type Role = {
  id: string;
  label: string;
  purpose: string;
  files: string[];
};

type ManagedAgent = Role & {
  agentId: string;
  pd: PortDaddy;
  sessionId: string;
  stopHeartbeat: () => void;
};

const harbor = process.env.PD_EXAMPLE_HARBOR ?? `examples-${Date.now().toString(36)}`;
const channel = 'examples:swarm';
const ttlMs = 30 * 60 * 1000;

const roles: Role[] = [
  {
    id: 'scout',
    label: 'Scout',
    purpose: 'Find the smallest reproducible fact',
    files: ['examples/swarm/coordination-board.ts'],
  },
  {
    id: 'builder',
    label: 'Builder',
    purpose: 'Draft the patch plan from the finding',
    files: ['examples/coordination/agent-protocol.ts'],
  },
  {
    id: 'verifier',
    label: 'Verifier',
    purpose: 'Convert the patch plan into test evidence',
    files: ['examples/locks/migration-guard.ts'],
  },
  {
    id: 'integrator',
    label: 'Integrator',
    purpose: 'Decide whether the swarm has converged',
    files: ['examples/README.md'],
  },
];

function log(step: string, message: string): void {
  console.log(`[${step.padEnd(10)}] ${message}`);
}

async function startAgent(role: Role): Promise<ManagedAgent> {
  const agentId = `${harbor}:${role.id}`;
  const pd = new PortDaddy({ agentId, timeout: 10000 });
  const begin = await pd.begin(role.purpose, {
    lifecycle: 'durable',
    identity: `examples:${role.id}:${harbor}`,
    metadata: { example: 'swarm-coordination-board', harbor, intendedFiles: role.files },
  });
  const heartbeat = pd.startHeartbeat(30000);

  try {
    await pd.claimFiles(begin.sessionId, role.files);
  } catch (error) {
    await pd.note(`File claim skipped in demo run: ${error instanceof Error ? error.message : String(error)}`, {
      agentId,
      sessionId: begin.sessionId,
      type: 'example',
    });
  }

  await pd.note(`${role.label} joined ${harbor}`, {
    agentId,
    sessionId: begin.sessionId,
    type: 'example',
  });

  return {
    ...role,
    agentId,
    pd,
    sessionId: begin.sessionId,
    stopHeartbeat: heartbeat.stop,
  };
}

async function writeTuple(agent: ManagedAgent, fields: unknown[]): Promise<void> {
  await agent.pd.tupleOut(fields, {
    harbor,
    writtenBy: agent.agentId,
    ttlMs,
  });
}

async function publish(agent: ManagedAgent, type: string, message: string, data?: Record<string, unknown>): Promise<void> {
  await agent.pd.publish(channel, {
    agent: agent.agentId,
    type,
    message,
    data: { harbor, ...data },
    ts: Date.now(),
  }, { sender: agent.agentId });
}

async function requireTuple(agent: ManagedAgent, pattern: unknown[]): Promise<unknown[]> {
  const result = await agent.pd.tupleRd(pattern, { harbor, limit: 1 });
  if (!result.tuples.length) {
    throw new Error(`${agent.label} expected tuple ${JSON.stringify(pattern)} in harbor ${harbor}`);
  }
  return result.tuples[0].fields;
}

async function runBoard(): Promise<void> {
  const control = new PortDaddy({ agentId: `${harbor}:control`, timeout: 10000 });
  await control.ensureChannel(channel, {
    scope: 'worktree',
    projectDir: process.cwd(),
    aliases: ['swarm:examples'],
    description: 'Runnable example channel for tuple-backed swarm coordination',
    metadata: { example: 'swarm-coordination-board' },
  });

  log('setup', `harbor=${harbor}`);
  log('setup', `channel=${channel}`);

  const agents = await Promise.all(roles.map(startAgent));
  const [scout, builder, verifier, integrator] = agents;

  try {
    await publish(scout, 'status', 'Scout is checking the bug report');
    await writeTuple(scout, [
      'finding',
      'PD-EXAMPLE-17',
      'docs-example-drift',
      {
        summary: 'Examples must show tuple coordination, managed tunnels, and operator tools.',
        confidence: 0.92,
      },
    ]);
    log('scout', 'published finding tuple');

    const finding = await requireTuple(builder, ['finding', 'PD-EXAMPLE-17', '*']);
    await builder.pd.withLock(`${harbor}:implementation`, async () => {
      await publish(builder, 'claim', 'Builder owns the implementation plan while it writes the patch tuple');
      await writeTuple(builder, [
        'patch-plan',
        'PD-EXAMPLE-17',
        'ready-for-tests',
        {
          basedOn: finding[2],
          files: ['examples/README.md', 'examples/swarm/coordination-board.ts'],
          risk: 'examples mutate daemon state, so use short TTLs and clean sessions',
        },
      ]);
    }, { owner: builder.agentId, ttl: 120000 });
    log('builder', 'published patch-plan tuple under lock');

    const patchPlan = await requireTuple(verifier, ['patch-plan', 'PD-EXAMPLE-17', 'ready-for-tests']);
    await verifier.pd.withLock(`${harbor}:validation`, async () => {
      await publish(verifier, 'status', 'Verifier is turning the patch plan into acceptance checks');
      await writeTuple(verifier, [
        'test-evidence',
        'PD-EXAMPLE-17',
        'pass',
        {
          fromPlan: patchPlan[3],
          checks: [
            'example code starts sessions',
            'example code writes and reads tuples',
            'example code records convergence',
          ],
        },
      ]);
    }, { owner: verifier.agentId, ttl: 120000 });
    log('verifier', 'published test-evidence tuple under lock');

    const evidence = await requireTuple(integrator, ['test-evidence', 'PD-EXAMPLE-17', 'pass']);
    await writeTuple(integrator, [
      'decision',
      'PD-EXAMPLE-17',
      'mergeable',
      {
        evidence: evidence[3],
        next: 'copy the pattern into real project automation',
      },
    ]);
    await publish(integrator, 'done', 'Swarm converged on a mergeable example slice');
    await integrator.pd.note('Swarm example converged on a mergeable slice', {
      agentId: integrator.agentId,
      sessionId: integrator.sessionId,
      type: 'decision',
    });
    log('integrator', 'published decision tuple');

    const board = await control.tupleScan(harbor);
    console.log('');
    console.log('Tuple board');
    console.log('-----------');
    for (const tuple of board.tuples) {
      console.log(`#${tuple.id} ${JSON.stringify(tuple.fields)}`);
    }
  } finally {
    await Promise.allSettled(agents.map(async (agent) => {
      agent.stopHeartbeat();
      await agent.pd.done(`${agent.label} completed the ${harbor} example run`, {
        agentId: agent.agentId,
        sessionId: agent.sessionId,
      });
      agent.pd.destroyIpc();
    }));
    control.destroyIpc();
  }
}

runBoard().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
