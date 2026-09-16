/**
 * Context-admission skew invariant: a conversational Workers AI call that
 * bypasses `requireContextAdmission` can reproduce the exact Fleet failure
 * this guard exists to prevent: the provider sees an over-window request even
 * though the executor has a deterministic local admission contract. Runtime
 * tests exercise current call paths; this AST inventory makes a newly added
 * naked dispatch fail immediately at review time.
 *
 * The one allowed exception is `embedText` in execute.ts. Embedding accepts a
 * vector input rather than chat messages plus a completion reserve, so the
 * conversational budget cannot be applied honestly. Its source marker is
 * deliberately exact and this test rejects any second exemption.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ADMISSION_SOURCES = ['execute.ts', 'purser.ts', 'xo.ts'] as const;
const EMBEDDING_EXEMPTION =
  'context-admission: exempt (embedding input has a distinct vector contract,';

interface DispatchSite {
  file: string;
  source: ts.SourceFile;
  call: ts.CallExpression;
}

/**
 * Return true only for direct Workers AI invocation forms used by the executor.
 *
 * @param call Candidate TypeScript call expression from an executor source file.
 * @returns Whether the call is a direct Workers AI dispatch shape.
 */
function isWorkersAiDispatch(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text === 'run' && isWorkersAiReceiver(callee.expression);
  }
  if (ts.isElementAccessExpression(callee)) {
    return (
      ts.isStringLiteral(callee.argumentExpression) &&
      callee.argumentExpression.text === 'run' &&
      isWorkersAiReceiver(callee.expression)
    );
  }
  return false;
}

/**
 * Recognise the executor's concrete Workers binding receivers without mistaking
 * `aiCircuit.run(...)` or storage `.run(...)` calls for provider dispatches.
 *
 * @param expression The receiver immediately before `.run`.
 * @returns Whether this receiver has the syntactic shape of a Workers AI binding.
 */
function isWorkersAiReceiver(expression: ts.Expression): boolean {
  // Match the binding surface rather than just today's variable names: a
  // future `otherEnv.AI.run(...)` or `request.ai.run(...)` must enter this
  // inventory too. Exact `ai` excludes the executor's `aiCircuit.run(...)`.
  if (ts.isIdentifier(expression)) return expression.text === 'ai';
  return (
    ts.isPropertyAccessExpression(expression) &&
    (expression.name.text === 'AI' || expression.name.text === 'ai')
  );
}

/**
 * Find the statement in the nearest lexical block that schedules a dispatch.
 *
 * The actual provider call lives in nested callbacks passed to `runCaptured` or
 * the circuit, while the admission gate intentionally sits immediately before
 * the outer scheduling statement. Walking to that statement lets the invariant
 * verify the control boundary rather than a fragile count of nearby strings.
 *
 * @param node Provider call expression to place in its containing block.
 * @returns The containing block and its direct scheduling statement, if found.
 */
function enclosingBlockStatement(
  node: ts.Node,
): { block: ts.Block; statement: ts.Statement } | null {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isStatement(current) && ts.isBlock(current.parent)) {
      return { block: current.parent, statement: current };
    }
  }
  return null;
}

/**
 * Verify the local admission convention: the gate immediately precedes the
 * statement that creates the provider dispatch and budgets `request.messages`.
 *
 * @param statement Direct predecessor of the statement containing AI.run.
 * @param source Parsed source for precise error-oriented expression checks.
 * @returns Whether the predecessor is the required conversational admission gate.
 */
function isImmediateAdmissionGate(statement: ts.Statement, source: ts.SourceFile): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    return false;
  }
  const call = statement.expression;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== 'requireContextAdmission') {
    return false;
  }
  return call.arguments.length >= 3 && call.arguments[1]?.getText(source).replace(/\s+/g, '') === 'request.messages';
}

/**
 * Require the established request shape so an admission for one message set
 * cannot be accidentally treated as permission to dispatch another one.
 *
 * @param call Direct Workers AI call expression.
 * @returns Whether its request argument is the same `request` gated above.
 */
function dispatchUsesGatedRequest(call: ts.CallExpression): boolean {
  return ts.isIdentifier(call.arguments[1]) && call.arguments[1].text === 'request';
}

/**
 * Determine whether a direct call is the one allowed vector-embedding boundary.
 *
 * @param site Candidate AI dispatch site.
 * @returns Whether the call has the exact embedding model/input/marker evidence.
 */
function isExplicitEmbeddingExemption(site: DispatchSite): boolean {
  if (site.file !== 'execute.ts') return false;
  const [model, input] = site.call.arguments;
  if (!model?.getText(site.source).includes('EMBED_MODEL') || !input || !ts.isObjectLiteralExpression(input)) {
    return false;
  }
  const hasTextVector = input.properties.some(
    property => ts.isPropertyAssignment(property) && property.name.getText(site.source) === 'text',
  );
  if (!hasTextVector) return false;

  const line = site.source.getLineAndCharacterOfPosition(site.call.getStart(site.source)).line;
  const preceding = site.source.text.split('\n').slice(Math.max(0, line - 3), line).join('\n');
  return (
    preceding.includes(EMBEDDING_EXEMPTION) &&
    preceding.includes('not chat messages plus a requested completion to reserve')
  );
}

/**
 * Format a source site for a failure that tells the next reviewer exactly where
 * the unadmitted provider request entered the executor.
 *
 * @param site Dispatch site to render.
 * @returns File, line, and compact call source.
 */
function describeSite(site: DispatchSite): string {
  const line = site.source.getLineAndCharacterOfPosition(site.call.getStart(site.source)).line + 1;
  return `${site.file}:${line}: ${site.call.getText(site.source).replace(/\s+/g, ' ')}`;
}

/**
 * Parse and inventory every direct Workers AI dispatch in the three
 * conversational executor surfaces under review.
 *
 * @returns The source-backed provider call sites, including the embedding exemption.
 */
function workersAiDispatches(): DispatchSite[] {
  const sites: DispatchSite[] = [];
  for (const file of ADMISSION_SOURCES) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(SRC_DIR, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isWorkersAiDispatch(node)) {
        sites.push({ file, source, call: node });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

describe('context-admission skew', () => {
  it('puts every conversational Workers AI dispatch directly behind the exact admission gate', () => {
    const sites = workersAiDispatches();
    const conversational = sites.filter(site => !isExplicitEmbeddingExemption(site));
    const offenders: string[] = [];

    for (const site of conversational) {
      const enclosing = enclosingBlockStatement(site.call);
      if (!enclosing) {
        offenders.push(`${describeSite(site)} (not scheduled from a lexical block)`);
        continue;
      }
      const index = enclosing.block.statements.indexOf(enclosing.statement);
      const predecessor = index > 0 ? enclosing.block.statements[index - 1] : undefined;
      if (!predecessor || !isImmediateAdmissionGate(predecessor, site.source)) {
        offenders.push(`${describeSite(site)} (missing immediate requireContextAdmission(..., request.messages, ...))`);
        continue;
      }
      if (!dispatchUsesGatedRequest(site.call)) {
        offenders.push(`${describeSite(site)} (dispatch does not pass the admitted request object)`);
      }
    }

    expect(
      conversational.length,
      'The inventory unexpectedly lost the existing MAP, REDUCE, repair, Purser, or XO provider calls.',
    ).toBeGreaterThanOrEqual(6);
    expect(
      offenders,
      'Unadmitted conversational Workers AI dispatch(es): add an immediate ' +
        '`requireContextAdmission(model, request.messages, maxTokens)` before the scheduling statement. ' +
        'Only the exact non-conversational EMBED_MODEL call may carry the embedding exemption.',
    ).toEqual([]);
  });

  it('permits exactly one explicit exemption, the non-conversational embedding boundary', () => {
    const sites = workersAiDispatches();
    const exempt = sites.filter(isExplicitEmbeddingExemption);
    const markers = ADMISSION_SOURCES.flatMap(file =>
      [...readFileSync(join(SRC_DIR, file), 'utf8').matchAll(/context-admission: exempt/g)].map(match => `${file}:${match.index}`),
    );

    expect(markers, 'A context-admission exemption marker must not become a generic bypass.').toHaveLength(1);
    expect(exempt.map(describeSite)).toHaveLength(1);
    expect(exempt[0]?.file).toBe('execute.ts');
    expect(exempt[0]?.call.arguments[0]?.getText(exempt[0].source)).toContain('EMBED_MODEL');
  });
});
