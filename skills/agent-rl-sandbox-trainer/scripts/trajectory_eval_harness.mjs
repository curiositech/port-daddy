#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function argsContain(actualArgs, expectedNeedles) {
  const haystack = JSON.stringify(actualArgs ?? {});
  return asArray(expectedNeedles).every((needle) => haystack.includes(String(needle)));
}

function artifactContains(artifact, expectedNeedles) {
  const haystack = [
    artifact.kind,
    artifact.name,
    artifact.path,
    artifact.status,
    artifact.content,
    artifact.stdout,
    artifact.stderr,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .join('\n');
  return asArray(expectedNeedles).every((needle) => haystack.includes(String(needle)));
}

function evidenceMatches(artifacts, expected) {
  return artifacts.some((artifact) => {
    if (expected.kind && artifact.kind !== expected.kind) return false;
    if (expected.exitCode !== undefined && Number(artifact.exitCode) !== Number(expected.exitCode)) return false;
    if (expected.status && artifact.status !== expected.status) return false;
    return artifactContains(artifact, expected.contains);
  });
}

function expectedEvidenceFor(task) {
  const explicit = asArray(task.expectedEvidence);
  if (explicit.length > 0) return explicit;
  if (task.expectedFinalContains) {
    return [{ kind: task.expectedFinalKind || undefined, contains: [task.expectedFinalContains] }];
  }
  return [];
}

function validatedUnhooks(unhooks) {
  return asArray(unhooks).filter((unhook) => {
    if (typeof unhook === 'string') return false;
    return unhook && typeof unhook === 'object' && unhook.name && (unhook.command || unhook.procedure) && unhook.validated === true;
  });
}

function matchExpectedActions(actions, expectedActions, orderRequired) {
  let cursor = -1;
  return expectedActions.map((expected) => {
    const startIndex = orderRequired ? cursor + 1 : 0;
    const matchedIndex = actions.findIndex((action, index) => index >= startIndex && action.tool === expected.tool && argsContain(action.args, expected.argsContains));
    if (orderRequired && matchedIndex >= 0) cursor = matchedIndex;
    return {
      tool: expected.tool,
      matched: matchedIndex >= 0,
      matchedIndex,
      argsContains: asArray(expected.argsContains),
    };
  });
}

export function evaluateTrajectorySuite(suite) {
  if (!suite || typeof suite !== 'object') {
    throw new Error('suite must be an object');
  }
  const tasks = asArray(suite.tasks);
  const trajectories = asArray(suite.trajectories);
  if (tasks.length === 0) {
    throw new Error('suite.tasks must include at least one task');
  }

  const rewardSpec = {
    actionOrderRequired: suite.rewardSpec?.actionOrderRequired !== false,
    defaultPassReward: Number(suite.rewardSpec?.defaultPassReward ?? 1),
    requireValidatedUnhooksForDeployment: suite.rewardSpec?.requireValidatedUnhooksForDeployment !== false,
  };
  const trajectoryByTask = new Map(trajectories.map((trajectory) => [trajectory.taskId, trajectory]));
  const realUnhooks = validatedUnhooks(suite.unhooks);
  const unhooksReady = rewardSpec.requireValidatedUnhooksForDeployment ? realUnhooks.length > 0 : true;
  const rows = tasks.map((task) => {
    const trajectory = trajectoryByTask.get(task.id) || {};
    const actions = asArray(trajectory.actions);
    const artifacts = asArray(trajectory.artifacts);
    const expectedActions = asArray(task.expectedActions);
    const expectedEvidence = expectedEvidenceFor(task);
    const actionResults = matchExpectedActions(actions, expectedActions, rewardSpec.actionOrderRequired);
    const evidenceResults = expectedEvidence.map((expected) => ({
      kind: expected.kind || 'any',
      contains: asArray(expected.contains),
      exitCode: expected.exitCode,
      matched: evidenceMatches(artifacts, expected),
    }));
    const actionMatches = actionResults.filter((result) => result.matched).length;
    const evidenceMatchesCount = evidenceResults.filter((result) => result.matched).length;
    const possible = expectedActions.length + expectedEvidence.length;
    const earned = actionMatches + evidenceMatchesCount;
    const reward = possible === 0 ? 1 : Number((earned / possible).toFixed(3));
    const finalStateText = String(trajectory.finalState ?? '');
    const selfReportOnly =
      evidenceMatchesCount === 0 &&
      expectedEvidence.some((expected) => asArray(expected.contains).some((needle) => finalStateText.includes(String(needle))));

    return {
      taskId: task.id,
      instruction: task.instruction,
      reward,
      pass: reward >= Number(task.passReward ?? rewardSpec.defaultPassReward),
      actionResults,
      evidenceResults,
      selfReportOnly,
      failureModes: asArray(task.failureModes).filter((failure) => !artifactContains({ content: JSON.stringify(artifacts) }, [failure.clearWhenContains || '__never__'])),
    };
  });

  const passed = rows.filter((row) => row.pass).length;
  const failed = tasks.length - passed;
  const evalGatePassed = failed === 0;
  const deployable = evalGatePassed && unhooksReady;
  const trainingRows = rows.map((row) => ({
    taskId: row.taskId,
    reward: row.reward,
    preference: row.pass && !row.selfReportOnly ? 'chosen' : 'rejected',
    note:
      row.pass && !row.selfReportOnly
        ? 'trajectory satisfied expected tool and artifact-backed evidence contract'
        : 'trajectory missed an expected action, artifact-backed evidence, or relied on self-report',
  }));

  return {
    agent: suite.agent || {},
    rewardSpec,
    summary: {
      taskCount: tasks.length,
      passed,
      failed,
      averageReward: Number((rows.reduce((sum, row) => sum + row.reward, 0) / rows.length).toFixed(3)),
      evalGatePassed,
      unhooksReady,
      deployable,
      validatedUnhookCount: realUnhooks.length,
    },
    rows,
    trainingRows,
    validatedUnhooks: realUnhooks,
    suggestedUnhooks: [
      'reset sandbox fixture',
      'revert workspace snapshot',
      'disable adapter and fall back to base model',
      'drop generated trajectories that cannot be replayed deterministically',
    ],
    warnings: [
      ...(evalGatePassed ? [] : ['eval gate failed; do not deploy an adapted agent from this report']),
      ...(unhooksReady ? [] : ['no validated unhooks supplied; do not deploy an adapted agent from this report']),
    ],
  };
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: trajectory_eval_harness.mjs --input suite.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { input } = parseArgs(process.argv.slice(2));
  const suite = JSON.parse(readFileSync(input, 'utf8'));
  process.stdout.write(`${JSON.stringify(evaluateTrajectorySuite(suite), null, 2)}\n`);
}
