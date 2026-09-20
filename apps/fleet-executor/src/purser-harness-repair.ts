/** Import-only execution repair. Runtime failure is not permission to rewrite tests. */
import { parse } from '@babel/parser';
import type { StackedFile } from './stacked-pr.js';

/** Strip parser positions/formatting; preserve executable semantics for comparison. */
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['start', 'end', 'loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key),
  ).map(([key, child]) => [key, semantic(child)]));
}

/**
 * Mask only top-level module specifiers. Test bodies, helpers, hooks, names,
 * skip/only modifiers, and import binding shape must stay unchanged. This
 * deliberately holds repairs needing broader edits for human review.
 */
function contractShape(file: StackedFile): string {
  const ast = parse(file.contents, {
    sourceType: 'unambiguous',
    plugins: /\.(?:ts|tsx|mts|cts)$/.test(file.path) ? ['typescript'] : [],
  });
  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') statement.source.value = '<module-specifier>';
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declaration of statement.declarations) {
      const init = declaration.init;
      if (init?.type === 'CallExpression' && init.callee.type === 'Identifier' &&
          init.callee.name === 'require' && init.arguments.length === 1 && init.arguments[0].type === 'StringLiteral') {
        init.arguments[0].value = '<module-specifier>';
      }
    }
  }
  return JSON.stringify(semantic(ast.program));
}

/** Fail closed if a generated repair edits anything except module locations. */
export function preservesHarnessContract(before: StackedFile[], after: StackedFile[]): boolean {
  if (before.length !== after.length || new Set(after.map(file => file.path)).size !== before.length) return false;
  try {
    return before.every(original => {
      const repaired = after.find(file => file.path === original.path);
      return repaired !== undefined && contractShape(original) === contractShape(repaired);
    });
  } catch { return false; }
}
