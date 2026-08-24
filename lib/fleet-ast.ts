// lib/fleet-ast.ts — ADR-0026 step 1: source-aware AST + FleetConfig projection
//
// parseFleetSource(source)  →  FleetAst    (positions on every node)
// astToConfig(ast)          →  FleetConfig (lossy projection; same shape as loadFleetConfig)
//
// import type is used for FleetConfig et al. so this module has no runtime
// circular dependency on fleet-engine.ts.

import { parseDocument, LineCounter, isScalar, isMap, isSeq } from 'yaml';
import type { YAMLMap, Scalar } from 'yaml';
import { deriveFleetAgentName } from './agent-names.js';
import type {
  FleetConfig,
  FleetAgent,
  FleetWatcher,
  FleetLimits,
  FleetModelTier,
  FleetRuntimeTarget,
} from './fleet-engine.js';

// ─── SourceRange ──────────────────────────────────────────────────────────────

export interface SourceRange {
  start: { line: number; column: number; offset: number };
  end:   { line: number; column: number; offset: number };
}

// ─── Base Node ────────────────────────────────────────────────────────────────

export interface FleetAstNode<T extends string> {
  kind: T;
  range: SourceRange;
}

// ─── Leaf Nodes ───────────────────────────────────────────────────────────────

export interface StringNode    extends FleetAstNode<'string'>  { value: string; }
export interface EnumNode<T extends string> extends FleetAstNode<'enum'> { value: T; }
export interface BoolNode      extends FleetAstNode<'bool'>    { value: boolean; }
export interface IntNode       extends FleetAstNode<'int'>     { value: number; }

export interface CronNode extends FleetAstNode<'cron'> {
  expression: string;
  approxRunsPerHour?: number;
  parseError?: string;
}

export interface ChannelRefNode extends FleetAstNode<'channelRef'> {
  channel: string;
  declared: boolean;  // populated post-parse: did `channels:` register it?
}

export interface PublishActionNode extends FleetAstNode<'publishAction'> {
  action: 'publish';
  channel: ChannelRefNode;
}

export interface TupleNode extends FleetAstNode<'tuple'> {
  elements: unknown[];
}

export interface RuntimeTargetNode extends FleetAstNode<'runtimeTarget'> {
  backend?: string;
  model?: string;
  modelTier?: string;
}

export interface TriviaNode extends FleetAstNode<'trivia'> {
  text: string;
}

// ─── Composite Nodes ──────────────────────────────────────────────────────────

export interface LimitsNode extends FleetAstNode<'limits'> {
  maxConcurrentSpawns?: IntNode;
  maxSpawnsPerHour?: IntNode;
  budgetUsdPerDay?: IntNode;
}

/** `trust:` block — operator trust policy for the event→spawn gate (ADR-0093). */
export interface TrustNode extends FleetAstNode<'trust'> {
  allowlistedAuthors?: StringNode[];
}

export interface DefaultsNode extends FleetAstNode<'defaults'> {
  backend?: EnumNode<string>;
  model?: StringNode;
  modelTier?: EnumNode<string>;
  worktree?: BoolNode;
}

export type Backend   = string;
export type ModelTier = 'low' | 'mid' | 'high';

export interface AgentNode extends FleetAstNode<'agent'> {
  name:           StringNode;
  /** Explicit false removes the declaration from the executable FleetConfig. */
  enabled?:       BoolNode;
  prompt?:        StringNode;
  trigger?:       ChannelRefNode;
  /** Additive plural trigger list (kind:type grammar or legacy channels). */
  triggers?:      StringNode[];
  /** Additive output target list (kind:type grammar). */
  outputs?:       StringNode[];
  schedule?:      CronNode;
  runOnStart?:    BoolNode;
  triggerTuple?:  TupleNode;
  backend?:       EnumNode<Backend>;
  model?:         StringNode;
  modelTier?:     EnumNode<ModelTier>;
  worktree?:      BoolNode;
  singleton?:     BoolNode;
  respawn?:       BoolNode;
  maxRespawns?:   IntNode;
  onSuccess?:     PublishActionNode;
  onFailure?:     PublishActionNode;
  identity?:      StringNode;
  timeout?:       IntNode;
  allowedTools?:  StringNode;
  /** Opt-in: pull a windags-pattern skill shortlist into this ship's task
   *  text before it spawns (lib/skill-graft.ts). Default false — existing
   *  ships are unaffected unless a pd-fleet.yml author sets this. */
  skillGraft?:    BoolNode;
  fallbacks?:     RuntimeTargetNode[];
  cooldownMs?:    IntNode;
  dedupeWindowMs?: IntNode;
  backoffBaseMs?: IntNode;
  backoffMaxMs?:  IntNode;
  backoffMultiplier?: IntNode;
}

export interface WatcherNode extends FleetAstNode<'watcher'> {
  name:       StringNode;
  trigger:    ChannelRefNode;
  exec:       StringNode;
  condition?: StringNode;
  confirm?:   BoolNode;
}

export interface ChannelNode extends FleetAstNode<'channel'> {
  name:             StringNode;
  description?:     StringNode;
  consumers?:       StringNode[];
  externalProducer?: StringNode | BoolNode;
}

export interface FleetAst extends FleetAstNode<'fleet'> {
  name:      StringNode;
  harbor?:   StringNode;
  limits?:   LimitsNode;
  trust?:    TrustNode;
  defaults?: DefaultsNode;
  agents:    Map<string, AgentNode>;
  watchers:  Map<string, WatcherNode>;
  channels:  Map<string, ChannelNode>;
  trivia:    TriviaNode[];
}

// ─── Internal: range helpers ─────────────────────────────────────────────────

const ZERO_RANGE: SourceRange = {
  start: { line: 0, column: 0, offset: 0 },
  end:   { line: 0, column: 0, offset: 0 },
};

type GetRange = (range: [number, number, number] | null | undefined) => SourceRange;

function makeGetRange(lc: LineCounter): GetRange {
  return (range) => {
    if (!range) return ZERO_RANGE;
    const s = lc.linePos(range[0]);
    const e = lc.linePos(range[2]);
    return {
      start: { line: s.line, column: s.col, offset: range[0] },
      end:   { line: e.line, column: e.col, offset: range[2] },
    };
  };
}

function nodeRange(node: unknown): [number, number, number] | null {
  return (node as { range?: [number, number, number] | null })?.range ?? null;
}

// ─── Internal: node extractors ───────────────────────────────────────────────

function extractString(node: unknown, gr: GetRange): StringNode | undefined {
  if (!isScalar(node)) return undefined;
  const s = node as Scalar<unknown>;
  if (s.value === null || s.value === undefined) return undefined;
  return { kind: 'string', range: gr(nodeRange(s)), value: String(s.value) };
}

function extractBool(node: unknown, gr: GetRange): BoolNode | undefined {
  if (!isScalar(node)) return undefined;
  const s = node as Scalar<unknown>;
  if (typeof s.value !== 'boolean') return undefined;
  return { kind: 'bool', range: gr(nodeRange(s)), value: s.value };
}

function extractInt(node: unknown, gr: GetRange): IntNode | undefined {
  if (!isScalar(node)) return undefined;
  const s = node as Scalar<unknown>;
  if (typeof s.value !== 'number' || !Number.isFinite(s.value)) return undefined;
  return { kind: 'int', range: gr(nodeRange(s)), value: s.value };
}

function extractEnum<T extends string>(node: unknown, gr: GetRange): EnumNode<T> | undefined {
  const str = extractString(node, gr);
  if (!str) return undefined;
  return { kind: 'enum', range: str.range, value: str.value as T };
}

function extractChannelRef(node: unknown, gr: GetRange): ChannelRefNode | undefined {
  const str = extractString(node, gr);
  if (!str) return undefined;
  return { kind: 'channelRef', range: str.range, channel: str.value, declared: false };
}

function extractPublishAction(node: unknown, gr: GetRange): PublishActionNode | undefined {
  const str = extractString(node, gr);
  if (!str) return undefined;
  const m = str.value.match(/^publish\s+(.+)$/);
  if (!m) return undefined;
  const ch: ChannelRefNode = {
    kind: 'channelRef', range: str.range,
    channel: m[1].trim(), declared: false,
  };
  return { kind: 'publishAction', range: str.range, action: 'publish', channel: ch };
}

function extractTuple(node: unknown, gr: GetRange): TupleNode | undefined {
  if (!isSeq(node)) return undefined;
  return {
    kind: 'tuple',
    range: gr(nodeRange(node)),
    elements: (node as { toJSON(): unknown[] }).toJSON(),
  };
}

function extractStringList(node: unknown, gr: GetRange): StringNode[] | undefined {
  if (!isSeq(node)) return undefined;
  const items = (node as { items: unknown[] }).items;
  const results: StringNode[] = [];
  for (const item of items) {
    const s = extractString(item, gr);
    if (s && s.value.trim()) results.push(s);
  }
  return results.length > 0 ? results : undefined;
}

function extractRuntimeTargets(node: unknown, gr: GetRange): RuntimeTargetNode[] | undefined {
  if (!isSeq(node)) return undefined;
  const items = (node as { items: unknown[] }).items;
  const results: RuntimeTargetNode[] = [];
  for (const item of items) {
    if (!isMap(item)) continue;
    const m = item as YAMLMap;
    const backend   = extractString(m.get('backend',   true), gr)?.value;
    const model     = extractString(m.get('model',     true), gr)?.value;
    const modelTier = extractString(
      m.get('model_tier', true) ?? m.get('modelTier', true), gr
    )?.value;
    results.push({ kind: 'runtimeTarget', range: gr(nodeRange(m)), backend, model, modelTier });
  }
  return results.length > 0 ? results : undefined;
}

// ─── Internal: map field helpers ─────────────────────────────────────────────

function gNode(m: YAMLMap, key: string): unknown {
  return m.get(key, true) ?? undefined;
}

function gStr(m: YAMLMap, key: string, gr: GetRange): StringNode | undefined {
  return extractString(gNode(m, key), gr);
}

function gBool(m: YAMLMap, key: string, gr: GetRange): BoolNode | undefined {
  return extractBool(gNode(m, key), gr);
}

function gInt(m: YAMLMap, key: string, gr: GetRange): IntNode | undefined {
  return extractInt(gNode(m, key), gr);
}

function gEnum<T extends string>(m: YAMLMap, key: string, gr: GetRange): EnumNode<T> | undefined {
  return extractEnum<T>(gNode(m, key), gr);
}

// ─── Internal: sub-parsers ────────────────────────────────────────────────────

function parseLimits(m: YAMLMap, gr: GetRange): LimitsNode {
  return {
    kind: 'limits', range: gr(nodeRange(m)),
    maxConcurrentSpawns: gInt(m, 'max_concurrent_spawns', gr),
    maxSpawnsPerHour:    gInt(m, 'max_spawns_per_hour',   gr),
    budgetUsdPerDay:     gInt(m, 'budget_usd_per_day',    gr),
  };
}

function parseTrust(m: YAMLMap, gr: GetRange): TrustNode {
  return {
    kind: 'trust', range: gr(nodeRange(m)),
    allowlistedAuthors:
      extractStringList(gNode(m, 'allowlisted_authors'), gr) ??
      extractStringList(gNode(m, 'allowlistedAuthors'), gr),
  };
}

function parseDefaults(m: YAMLMap, gr: GetRange): DefaultsNode {
  return {
    kind: 'defaults', range: gr(nodeRange(m)),
    backend:   gEnum<string>(m, 'backend',  gr),
    model:     gStr(m, 'model',             gr),
    modelTier: gEnum<string>(m, 'model_tier', gr) ?? gEnum<string>(m, 'modelTier', gr),
    worktree:  gBool(m, 'worktree',         gr),
  };
}

function parseAgentMap(
  name: string,
  nameScalar: Scalar<unknown> | null,
  m: YAMLMap,
  gr: GetRange,
): AgentNode {
  const r = gr(nodeRange(m));
  const nameRange = nameScalar ? gr(nodeRange(nameScalar)) : r;
  const nodeR = nameScalar ? { start: nameRange.start, end: r.end } : r;
  return {
    kind: 'agent', range: nodeR,
    name:          { kind: 'string', range: nameRange, value: name },
    // `enabled` is an admission boundary, so a present-but-malformed value
    // fails closed to false instead of silently inheriting the enabled default.
    enabled:       m.has('enabled')
      ? (gBool(m, 'enabled', gr) ?? {
          kind: 'bool' as const,
          range: gr(nodeRange(m.get('enabled', true))),
          value: false,
        })
      : undefined,
    prompt:        gStr(m, 'prompt', gr),
    trigger:       extractChannelRef(gNode(m, 'trigger'),   gr),
    triggers:      extractStringList(gNode(m, 'triggers'),  gr),
    outputs:       extractStringList(gNode(m, 'outputs'),   gr),
    schedule:      (() => {
      const n = gNode(m, 'schedule');
      const str = extractString(n, gr);
      return str ? { kind: 'cron' as const, range: str.range, expression: str.value } : undefined;
    })(),
    runOnStart:    gBool(m, 'run_on_start', gr),
    triggerTuple:  extractTuple(gNode(m, 'trigger_tuple'), gr),
    backend:       extractEnum<Backend>(gNode(m, 'backend'), gr),
    model:         gStr(m, 'model', gr),
    modelTier:     extractEnum<ModelTier>(
      gNode(m, 'model_tier') ?? gNode(m, 'modelTier'), gr,
    ),
    worktree:      gBool(m, 'worktree',   gr),
    singleton:     gBool(m, 'singleton',  gr),
    respawn:       gBool(m, 'respawn',    gr),
    maxRespawns:   gInt(m,  'max_respawns', gr),
    onSuccess:     extractPublishAction(gNode(m, 'on_success'), gr),
    onFailure:     extractPublishAction(gNode(m, 'on_failure'), gr),
    identity:      gStr(m, 'identity',    gr),
    timeout:       gInt(m, 'timeout',     gr),
    allowedTools:  gStr(m, 'allowedTools', gr) ?? gStr(m, 'allowed_tools', gr),
    skillGraft:    gBool(m, 'skill_graft', gr) ?? gBool(m, 'skillGraft', gr),
    fallbacks:     extractRuntimeTargets(gNode(m, 'fallbacks'), gr),
    cooldownMs:    gInt(m, 'cooldown_ms',        gr),
    dedupeWindowMs:gInt(m, 'dedupe_window_ms',   gr),
    backoffBaseMs: gInt(m, 'backoff_base_ms',    gr),
    backoffMaxMs:  gInt(m, 'backoff_max_ms',     gr),
    backoffMultiplier: gInt(m, 'backoff_multiplier', gr),
  };
}

function parseWatcherMap(
  name: string,
  nameScalar: Scalar<unknown> | null,
  m: YAMLMap,
  gr: GetRange,
): WatcherNode {
  const r = gr(nodeRange(m));
  const nameRange = nameScalar ? gr(nodeRange(nameScalar)) : r;
  const nodeR = nameScalar ? { start: nameRange.start, end: r.end } : r;
  const trigger = extractChannelRef(gNode(m, 'trigger'), gr)
    ?? { kind: 'channelRef' as const, range: r, channel: '', declared: false };
  const exec = gStr(m, 'exec', gr)
    ?? { kind: 'string' as const, range: r, value: '' };
  return {
    kind: 'watcher', range: nodeR,
    name:      { kind: 'string', range: nameRange, value: name },
    trigger, exec,
    condition: gStr(m, 'condition', gr),
    confirm:   gBool(m, 'confirm',  gr),
  };
}

function parseChannelMap(
  name: string,
  nameScalar: Scalar<unknown> | null,
  m: YAMLMap | null,
  gr: GetRange,
): ChannelNode {
  if (!m) {
    const r = nameScalar ? gr(nodeRange(nameScalar)) : ZERO_RANGE;
    return { kind: 'channel', range: r, name: { kind: 'string', range: r, value: name } };
  }
  const r = gr(nodeRange(m));
  const nameRange = nameScalar ? gr(nodeRange(nameScalar)) : r;
  const nodeR = nameScalar ? { start: nameRange.start, end: r.end } : r;

  let consumers: StringNode[] | undefined;
  const consNode = gNode(m, 'consumers');
  if (isSeq(consNode)) {
    const items = (consNode as { items: unknown[] }).items;
    consumers = items
      .map(item => extractString(item, gr))
      .filter((s): s is StringNode => s !== undefined);
  }

  const epRaw = gNode(m, 'external_producer') ?? gNode(m, 'externalProducer');
  const externalProducer: StringNode | BoolNode | undefined =
    extractBool(epRaw, gr) ?? extractString(epRaw, gr);

  return {
    kind: 'channel', range: nodeR,
    name:             { kind: 'string', range: nameRange, value: name },
    description:      gStr(m, 'description', gr),
    consumers,
    externalProducer,
  };
}

// ─── parseFleetSource ─────────────────────────────────────────────────────────

export function parseFleetSource(source: string): FleetAst | null {
  if (!source.trim()) return null;

  const lc  = new LineCounter();
  const doc = parseDocument(source, { lineCounter: lc });
  if (doc.errors.length > 0) return null;
  if (!doc.contents || !isMap(doc.contents)) return null;

  const gr   = makeGetRange(lc);
  const root = doc.contents as YAMLMap;

  // Support both `fleet: { ... }` wrapper and bare top-level keys.
  const fleetWrapper = root.get('fleet', true);
  const fleetMap: YAMLMap = (fleetWrapper && isMap(fleetWrapper))
    ? fleetWrapper as YAMLMap
    : root;
  const fleetRange = gr(nodeRange(fleetMap));

  // ── Agents ────────────────────────────────────────────────────────────────
  const agents = new Map<string, AgentNode>();
  const agentsNode = gNode(fleetMap, 'agents');

  if (agentsNode && isMap(agentsNode)) {
    for (const pair of (agentsNode as YAMLMap).items) {
      if (!isScalar(pair.key)) continue;
      const keyScalar = pair.key as Scalar<unknown>;
      const agentName = String(keyScalar.value);
      if (!pair.value || !isMap(pair.value)) continue;
      agents.set(agentName, parseAgentMap(agentName, keyScalar, pair.value as YAMLMap, gr));
    }
  } else if (agentsNode && isSeq(agentsNode)) {
    let idx = 0;
    for (const item of (agentsNode as { items: unknown[] }).items) {
      if (!isMap(item)) { idx++; continue; }
      const m = item as YAMLMap;
      const nameVal     = extractString(gNode(m, 'name'),     gr)?.value?.trim() || undefined;
      const identityVal = extractString(gNode(m, 'identity'), gr)?.value?.trim() || undefined;
      const promptVal   = extractString(gNode(m, 'prompt'),   gr)?.value?.trim() || undefined;
      const backendVal  = extractString(gNode(m, 'backend'),  gr)?.value?.trim() || undefined;
      const agentName   = deriveFleetAgentName({
        name: nameVal, identity: identityVal, prompt: promptVal, backend: backendVal, index: idx,
      });
      const keyScalar = isScalar(gNode(m, 'name')) ? (gNode(m, 'name') as Scalar<unknown>) : null;
      agents.set(agentName, parseAgentMap(agentName, keyScalar, m, gr));
      idx++;
    }
  }

  // ── Watchers ──────────────────────────────────────────────────────────────
  const watchers = new Map<string, WatcherNode>();
  const watchersNode = gNode(fleetMap, 'watchers');
  if (watchersNode && isMap(watchersNode)) {
    for (const pair of (watchersNode as YAMLMap).items) {
      if (!isScalar(pair.key)) continue;
      const keyScalar = pair.key as Scalar<unknown>;
      const wName = String(keyScalar.value);
      if (!pair.value || !isMap(pair.value)) continue;
      watchers.set(wName, parseWatcherMap(wName, keyScalar, pair.value as YAMLMap, gr));
    }
  }

  // ── Channels ──────────────────────────────────────────────────────────────
  const channels = new Map<string, ChannelNode>();
  const channelsNode = gNode(fleetMap, 'channels');
  if (channelsNode && isMap(channelsNode)) {
    for (const pair of (channelsNode as YAMLMap).items) {
      if (!isScalar(pair.key)) continue;
      const keyScalar = pair.key as Scalar<unknown>;
      const cName = String(keyScalar.value);
      const cMap  = isMap(pair.value) ? pair.value as YAMLMap : null;
      channels.set(cName, parseChannelMap(cName, keyScalar, cMap, gr));
    }
  }

  // ── Post-parse: mark declared ChannelRefNodes ─────────────────────────────
  for (const [, agent] of agents) {
    if (agent.trigger && channels.has(agent.trigger.channel)) {
      agent.trigger.declared = true;
    }
    if (agent.onSuccess?.channel && channels.has(agent.onSuccess.channel.channel)) {
      agent.onSuccess.channel.declared = true;
    }
    if (agent.onFailure?.channel && channels.has(agent.onFailure.channel.channel)) {
      agent.onFailure.channel.declared = true;
    }
  }
  for (const [, watcher] of watchers) {
    if (channels.has(watcher.trigger.channel)) {
      watcher.trigger.declared = true;
    }
  }

  // ── Limits / Defaults / Name / Harbor ─────────────────────────────────────
  const limitsRaw   = gNode(fleetMap, 'limits');
  const trustRaw    = gNode(fleetMap, 'trust');
  const defaultsRaw = gNode(fleetMap, 'defaults') ?? (fleetMap !== root ? gNode(root, 'defaults') : undefined);

  const limits   = (limitsRaw   && isMap(limitsRaw))   ? parseLimits(limitsRaw   as YAMLMap, gr) : undefined;
  const trust    = (trustRaw    && isMap(trustRaw))    ? parseTrust(trustRaw     as YAMLMap, gr) : undefined;
  const defaults = (defaultsRaw && isMap(defaultsRaw)) ? parseDefaults(defaultsRaw as YAMLMap, gr) : undefined;

  const name   = extractString(gNode(fleetMap, 'name'),   gr) ?? { kind: 'string' as const, range: ZERO_RANGE, value: '' };
  const harbor = extractString(gNode(fleetMap, 'harbor'), gr);

  return { kind: 'fleet', range: fleetRange, name, harbor, limits, trust, defaults, agents, watchers, channels, trivia: [] };
}

// ─── Worktree inference (mirrors fleet-engine.ts) ────────────────────────────

const EDIT_TOOL_PATTERN = /\b(?:Write|Edit|MultiEdit|NotebookEdit|Bash)\b/;

function resolveWorktree(agent: AgentNode, defs?: DefaultsNode): boolean {
  if (agent.worktree !== undefined) return agent.worktree.value;
  if (defs?.worktree !== undefined) return defs.worktree.value;
  const allowed = (agent.allowedTools?.value ?? '').trim();
  if (!allowed) return Boolean(agent.backend?.value) && agent.backend?.value !== 'custom';
  return EDIT_TOOL_PATTERN.test(allowed);
}

// ─── astToConfig ──────────────────────────────────────────────────────────────

const MODEL_TIERS = new Set<string>(['low', 'mid', 'high']);

function normMs(n?: IntNode): number | undefined {
  const v = n?.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function normBudget(n?: IntNode): number | undefined {
  const v = n?.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function normBackoffMultiplier(n?: IntNode): number | undefined {
  const v = n?.value;
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? v : undefined;
}

function toModelTier(s?: string): FleetModelTier | undefined {
  const norm = s?.toLowerCase().trim();
  return norm && MODEL_TIERS.has(norm) ? (norm as FleetModelTier) : undefined;
}

export function astToConfig(ast: FleetAst): FleetConfig {
  const defs = ast.defaults;

  const agents: FleetAgent[] = [];
  for (const [name, a] of ast.agents) {
    // Disabled declarations remain available in the source-aware AST for
    // inspection/editing, but never cross into the executable runtime config.
    if (a.enabled?.value === false) continue;

    const agentBackendVal = a.backend?.value?.trim() || undefined;
    const defsBackendVal  = defs?.backend?.value?.trim() || undefined;
    const sameBackend     = !agentBackendVal || !defsBackendVal || agentBackendVal === defsBackendVal;

    const backend   = agentBackendVal || defsBackendVal || '';
    const model     = a.model?.value?.trim() || (sameBackend ? defs?.model?.value?.trim() : undefined) || undefined;
    const tierRaw   = a.modelTier?.value?.trim() || (sameBackend ? defs?.modelTier?.value?.trim() : undefined);
    const modelTier = toModelTier(tierRaw);

    const fallbacks = (() => {
      if (!a.fallbacks) return undefined;
      const out = a.fallbacks
        .map(rt => ({
          backend:   rt.backend?.trim() || undefined,
          model:     rt.model?.trim()   || undefined,
          modelTier: toModelTier(rt.modelTier?.trim()),
        } as FleetRuntimeTarget))
        .filter(rt => rt.backend || rt.model || rt.modelTier);
      return out.length > 0 ? out : undefined;
    })();

    // Additive plural triggers/outputs. Fold a singular `trigger:` in as
    // the first element so both shapes coexist; dedupe to avoid a singular
    // trigger that is also listed in `triggers:` firing twice.
    const triggerList = (() => {
      const explicit = a.triggers?.map((s) => s.value.trim()).filter(Boolean) ?? [];
      const singular = a.trigger?.channel?.trim();
      const combined = singular ? [singular, ...explicit] : explicit;
      const deduped = [...new Set(combined)];
      return deduped.length > 0 ? deduped : undefined;
    })();
    const outputList = (() => {
      const explicit = a.outputs?.map((s) => s.value.trim()).filter(Boolean) ?? [];
      return explicit.length > 0 ? explicit : undefined;
    })();

    agents.push({
      name,
      schedule:       a.schedule?.expression,
      runOnStart:     a.runOnStart?.value ?? false,
      trigger:        a.trigger?.channel,
      triggers:       triggerList,
      outputs:        outputList,
      triggerTuple:   a.triggerTuple?.elements,
      backend,
      model,
      modelTier,
      prompt:         a.prompt?.value.trim() ?? '',
      worktree:       resolveWorktree(a, defs),
      singleton:      a.singleton?.value ?? false,
      respawn:        a.respawn?.value ?? false,
      maxRespawns:    a.maxRespawns?.value ?? 3,
      onSuccess:      a.onSuccess  ? `publish ${a.onSuccess.channel.channel}`  : undefined,
      onFailure:      a.onFailure  ? `publish ${a.onFailure.channel.channel}`  : undefined,
      identity:       a.identity?.value,
      timeout:        a.timeout?.value,
      allowedTools:   a.allowedTools?.value,
      skillGraft:     a.skillGraft?.value ?? false,
      fallbacks,
      cooldownMs:     normMs(a.cooldownMs),
      dedupeWindowMs: normMs(a.dedupeWindowMs),
      backoffBaseMs:  normMs(a.backoffBaseMs),
      backoffMaxMs:   normMs(a.backoffMaxMs),
      backoffMultiplier: normBackoffMultiplier(a.backoffMultiplier),
    });
  }

  const watchers: FleetWatcher[] = [];
  for (const [name, w] of ast.watchers) {
    watchers.push({
      name,
      trigger:   w.trigger.channel,
      exec:      w.exec.value,
      condition: w.condition?.value,
      confirm:   w.confirm?.value ?? false,
    });
  }

  const channels: FleetConfig['channels'] = {};
  for (const [name, ch] of ast.channels) {
    channels[name] = {
      description:     ch.description?.value ?? '',
      consumers:       ch.consumers?.map(c => c.value),
      externalProducer: ch.externalProducer?.value as string | boolean | undefined,
    };
  }

  let limits: FleetLimits | undefined;
  if (ast.limits) {
    limits = {
      maxConcurrentSpawns: ast.limits.maxConcurrentSpawns?.value,
      maxSpawnsPerHour:    ast.limits.maxSpawnsPerHour?.value,
      budgetUsdPerDay:     normBudget(ast.limits.budgetUsdPerDay),
    };
  }

  let trust: FleetConfig['trust'];
  if (ast.trust?.allowlistedAuthors?.length) {
    trust = { allowlistedAuthors: ast.trust.allowlistedAuthors.map(a => a.value) };
  }

  return {
    name:    ast.name.value,
    harbor:  ast.harbor?.value,
    limits,
    trust,
    agents,
    watchers,
    channels,
  };
}
