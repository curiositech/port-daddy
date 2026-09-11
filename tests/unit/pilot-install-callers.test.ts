import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/** Compile the actual production functions; every external effect stays in an inert VM adapter. */
function caller(file: string, names: string[], result: unknown) {
  const text = readFileSync(join(process.cwd(), file), 'utf8');
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = parsed.statements.filter((node: { name?: { text: string } }) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  expect(selected).toHaveLength(names.length);
  const body = selected.map((node: { getText: (source: unknown) => string }) => node.getText(parsed)).join('\n');
  const compiled = ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const events: string[] = [];
  const lines: string[] = [];
  const forbidden = (name: string) => () => { events.push('FORBIDDEN:' + name); throw new Error('FORBIDDEN:' + name); };
  const context = createContext({
    exports: {},
    console: { log: (...args: unknown[]) => lines.push(args.join(' ')) },
    process: { env: {}, exitCode: 0, exit: forbidden('exit'), cwd: forbidden('cwd'), chdir: forbidden('chdir') },
    require: forbidden('require'), fetch: forbidden('fetch'),
    ui: Object.fromEntries(['info', 'warn', 'success', 'error', 'step'].map(kind => [kind, (line: string) => lines.push(kind + ':' + line)])),
    PROJECT_ROOT: 'SYNTHETIC_PACKAGE', DEFAULT_HOME: 'SYNTHETIC_BASE',
    resolvePilotSourceDir: () => { events.push('resolve-source'); return 'SYNTHETIC_SOURCE'; },
    installPilotAgents: (options: Record<string, unknown>) => {
      events.push('pilot:' + JSON.stringify(options)); return result;
    },
    installFleetBarIfEnabled: async (skip: boolean) => { expect(skip).toBe(true); events.push('fleetbar-skipped'); return true; },
    inferProjectDir: () => null,
    maybeInitProject: async () => { events.push('project-init-adapter'); },
    installProjectHarness: async () => { events.push('harness-adapter'); return true; },
    loadFirstValueRecord: () => { events.push('load-completion'); return {}; },
    saveFirstValueRecord: () => { events.push('save-completion'); },
    HARBOR_AREAS: [], transparentHookInventory: () => [],
    ensureDaemonInstalledAndRunning: forbidden('daemon'), prefetchEmbeddingModel: forbidden('prefetch'),
    handleMcpInstall: forbidden('mcp-from-setup'), installAgentSkillUnion: forbidden('skill-union'), startTool2VecWarmup: forbidden('warmup'),
    existsSync: forbidden('exists'), resolve: forbidden('resolve'),
    buildPlatforms: (base: string) => { expect(base).toBe('SYNTHETIC_BASE'); return []; },
    configurePlatform: forbidden('configure-platform'),
    installSkill: () => { events.push('skill-adapter'); return null; },
    detectShell: () => { events.push('detect-shell'); return 'synthetic'; },
    installShellHook: async () => { events.push('shell-hook-adapter'); return { success: true, path: 'SYNTHETIC_RC' }; },
  });
  runInContext(compiled, context, { timeout: 1000, importModuleDynamically: forbidden('dynamic-import') });
  return { context, events, lines };
}

function outcome(kind: string) {
  return {
    outcome: kind,
    written: ['complete', 'unchanged', 'preview'].includes(kind) ? [{ runtime: 'fixture', path: 'SYNTHETIC_TARGET', changed: kind !== 'unchanged' }] : [],
    cleaned: [],
    errors: ['blocked', 'partial'].includes(kind) ? [{ runtime: 'fixture', path: 'SYNTHETIC_TARGET', error: 'Synthetic refusal' }] : [],
  };
}

describe('actual Pilot caller outcome propagation without global filesystem or process effects', () => {
  test.each(['blocked', 'partial', 'complete', 'unchanged', 'preview'])('setup handles %s without a false completion stamp', async kind => {
    const { context, events, lines } = caller('cli/commands/setup.ts', ['installPilotAgentDefinitions', 'handleSetup'], outcome(kind));
    await context.exports.handleSetup({
      'no-daemon': true, 'no-prefetch': true, 'no-mcp': true, 'no-hooks': true,
      'no-fleetbar': true, 'no-skill': true, 'dry-run': kind === 'preview',
    });
    const failed = ['blocked', 'partial'].includes(kind);
    expect(context.process.exitCode).toBe(failed ? 1 : 0);
    expect(events.some(e => e.startsWith('FORBIDDEN:'))).toBe(false);
    expect(events.filter(e => e.startsWith('pilot:'))).toHaveLength(1);
    expect(events.includes('save-completion')).toBe(!failed);
    expect(lines.includes('success:Setup complete')).toBe(!failed);
    expect(lines.some(l => l.includes('Port Daddy Pilot: ' + kind))).toBe(true);
  });

  test('setup no-agents preserves explicit opt-out without calling the Pilot installer', async () => {
    const { context, events } = caller('cli/commands/setup.ts', ['installPilotAgentDefinitions', 'handleSetup'], outcome('blocked'));
    await context.exports.handleSetup({ 'no-daemon': true, 'no-prefetch': true, 'no-mcp': true,
      'no-hooks': true, 'no-fleetbar': true, 'no-skill': true, 'no-agents': true });
    expect(context.process.exitCode).toBe(0);
    expect(events.some(e => e.startsWith('pilot:'))).toBe(false);
    expect(events.includes('save-completion')).toBe(true);
  });

  test.each(['blocked', 'partial', 'complete', 'unchanged', 'preview', 'missing-source'])('MCP handles %s with honest continuation and exit status', async kind => {
    const result = kind === 'missing-source' ? null : outcome(kind);
    const { context, events, lines } = caller('cli/commands/mcp-install.ts', ['installPilotDefinitions', 'printPilotInstallSummary', 'handleMcpInstall'], result);
    if (kind === 'missing-source') context.resolvePilotSourceDir = () => null;
    await context.exports.handleMcpInstall({ 'dry-run': kind === 'preview' }, 'SYNTHETIC_BASE');
    const failed = ['blocked', 'partial', 'missing-source'].includes(kind);
    expect(context.process.exitCode).toBe(failed ? 1 : 0);
    expect(events.some(e => e.startsWith('FORBIDDEN:'))).toBe(false);
    expect(events.includes('shell-hook-adapter')).toBe(!failed);
    expect(lines.some(l => l.includes('Next steps:'))).toBe(!failed);
    if (kind !== 'missing-source') expect(lines.some(l => l.includes(kind + ':'))).toBe(true);
    if (failed) expect(lines.some(l => l.includes('✓ blocked') || l.includes('✓ partial'))).toBe(false);
  });

  test('MCP no-agents does not invoke source discovery or Pilot installation', async () => {
    const { context, events } = caller('cli/commands/mcp-install.ts', ['installPilotDefinitions', 'printPilotInstallSummary', 'handleMcpInstall'], outcome('blocked'));
    await context.exports.handleMcpInstall({ 'no-agents': true }, 'SYNTHETIC_BASE');
    expect(context.process.exitCode).toBe(0);
    expect(events.some(e => e.startsWith('pilot:') || e === 'resolve-source')).toBe(false);
    expect(events.includes('shell-hook-adapter')).toBe(true);
  });
});
