import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

// The 48-skill parked batch, upgraded to the agentic-family standard in the same
// fashion as tests/unit/skill-standard-upgrades.test.js (#649).
// Each entry: [skillId, scriptFile, exportedFn].
const audited = [
  ['api-versioning-strategy', 'api_versioning_strategy_audit', 'auditApiVersioningStrategy'],
  ['astro-islands-architect', 'astro_islands_audit', 'auditAstroIslands'],
  ['background-job-queue-design', 'job_queue_design_audit', 'auditJobQueueDesign'],
  ['cdn-cache-control-headers', 'cdn_cache_headers_audit', 'auditCdnCacheHeaders'],
  ['circuit-breakers-and-retries', 'circuit_breaker_retry_audit', 'auditCircuitBreakerRetry'],
  ['cloudflare-workers-debugging', 'workers_debugging_audit', 'auditWorkersDebugging'],
  ['content-security-policy-headers', 'csp_policy_audit', 'auditCspPolicy'],
  ['d1-and-supabase-migrations', 'migration_plan_audit', 'auditMigrationPlan'],
  ['distributed-tracing-w3c-context', 'trace_propagation_audit', 'auditTracePropagation'],
  ['dockerfile-build-cache-mastery', 'docker_build_audit', 'auditDockerBuildPlan'],
  ['duckdb-analytics', 'duckdb_pipeline_audit', 'auditDuckdbPipeline'],
  ['feature-flag-rollout-strategist', 'flag_rollout_audit', 'auditFlagRollout'],
  ['github-actions-matrix-patterns', 'github_actions_matrix_patterns_audit', 'auditGithubActionsMatrixPatterns'],
  ['go-pprof-profiling', 'go_pprof_profiling_audit', 'auditGoPprofProfiling'],
  ['grafana-dashboard-builder', 'grafana_dashboard_builder_audit', 'auditGrafanaDashboardBuilder'],
  ['graphql-n-plus-one-dataloader', 'graphql_n_plus_one_dataloader_audit', 'auditGraphqlNPlusOneDataloader'],
  ['hono-patterns', 'hono_patterns_audit', 'auditHonoPatterns'],
  ['htmx-progressive-enhancement', 'htmx_progressive_enhancement_audit', 'auditHtmxProgressiveEnhancement'],
  ['idempotency-key-patterns', 'idempotency_key_patterns_audit', 'auditIdempotencyKeyPatterns'],
  ['kafka-consumer-group-design', 'kafka_consumer_group_design_audit', 'auditKafkaConsumerGroupDesign'],
  ['kubernetes-debugging-runbook', 'kubernetes_debugging_runbook_audit', 'auditKubernetesDebuggingRunbook'],
  ['kubernetes-graceful-shutdown', 'kubernetes_graceful_shutdown_audit', 'auditKubernetesGracefulShutdown'],
  ['mcp-server-design', 'mcp_server_design_audit', 'auditMcpServerDesign'],
  ['node-memory-leak-hunting', 'node_memory_leak_hunting_audit', 'auditNodeMemoryLeakHunting'],
  ['oauth2-and-oidc-from-scratch', 'oauth2_and_oidc_from_scratch_audit', 'auditOauth2AndOidcFromScratch'],
  ['opentelemetry-instrumentation', 'opentelemetry_instrumentation_audit', 'auditOpentelemetryInstrumentation'],
  ['outbox-pattern-implementation', 'outbox_pattern_implementation_audit', 'auditOutboxPatternImplementation'],
  ['playwright-e2e-design', 'playwright_e2e_design_audit', 'auditPlaywrightE2eDesign'],
  ['pnpm-workspace-monorepo', 'pnpm_workspace_monorepo_audit', 'auditPnpmWorkspaceMonorepo'],
  ['postgres-connection-pooling', 'postgres_connection_pooling_audit', 'auditPostgresConnectionPooling'],
  ['postgres-explain-analyzer', 'postgres_explain_analyzer_audit', 'auditPostgresExplainAnalyzer'],
  ['postgres-row-level-security', 'postgres_row_level_security_audit', 'auditPostgresRowLevelSecurity'],
  ['python-asyncio-pitfalls', 'python_asyncio_pitfalls_audit', 'auditPythonAsyncioPitfalls'],
  ['rag-retrieval-pattern-design', 'rag_retrieval_pattern_design_audit', 'auditRagRetrievalPatternDesign'],
  ['rate-limiting-strategy', 'rate_limiting_strategy_audit', 'auditRateLimitingStrategy'],
  ['react-server-components-boundary', 'react_server_components_boundary_audit', 'auditReactServerComponentsBoundary'],
  ['redis-patterns-expert', 'redis_patterns_audit', 'auditRedisPatterns'],
  ['server-sent-events-vs-websockets', 'sse_ws_channel_audit', 'auditSseWsChannel'],
  ['structured-logging-design', 'structured_logging_audit', 'auditStructuredLogging'],
  ['tailwind-v4-expert', 'tailwind_v4_audit', 'auditTailwindV4'],
  ['tanstack-query-server-state', 'tanstack_query_audit', 'auditTanstackQuery'],
  ['terraform-module-design', 'terraform_module_audit', 'auditTerraformModule'],
  ['transformers-js-onnx-pipelines', 'transformers_js_onnx_pipelines_audit', 'auditTransformersJsOnnxPipelines'],
  ['typescript-narrowing-expert', 'typescript_narrowing_expert_audit', 'auditTypescriptNarrowingExpert'],
  ['vite-build-optimizer', 'vite_build_optimizer_audit', 'auditViteBuildOptimizer'],
  ['webauthn-passkey-implementation', 'webauthn_passkey_implementation_audit', 'auditWebauthnPasskeyImplementation'],
  ['webhook-receiver-design', 'webhook_receiver_design_audit', 'auditWebhookReceiverDesign'],
  ['zero-downtime-database-migration', 'zero_downtime_database_migration_audit', 'auditZeroDowntimeDatabaseMigration'],
];

function sample(skillId) {
  return JSON.parse(readFileSync(join(repo, 'skills', skillId, 'examples', 'sample-input.json'), 'utf8'));
}

describe('skill-batch auditors pass their sample and reject malformed input', () => {
  test.each(audited)('%s/%s.mjs: sample passes, malformed throws', async (skillId, scriptFile, fnName) => {
    const mod = await import(join(repo, 'skills', skillId, 'scripts', `${scriptFile}.mjs`));
    const fn = mod[fnName];
    expect(typeof fn).toBe('function');

    const report = fn(sample(skillId));
    expect(report.pass).toBe(true);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.findings).toHaveLength(0);

    expect(() => fn(null)).toThrow();
    expect(() => fn('not-an-object')).toThrow();
  });
});

describe('transformers-js consumes canonical v2 profiles without promoting declarative output', () => {
  test('accepts the registry row and rejects legacy, drifted, persisted, compared, or self-attested output', async () => {
    const { auditTransformersJsOnnxPipelines } = await import(join(
      repo,
      'skills',
      'transformers-js-onnx-pipelines',
      'scripts',
      'transformers_js_onnx_pipelines_audit.mjs',
    ));
    const canonical = sample('transformers-js-onnx-pipelines');
    const { MODEL_REGISTRY_DATA } = await import('../../lib/model-registry-data.js');
    expect(auditTransformersJsOnnxPipelines(canonical)).toMatchObject({ pass: true, findings: [] });
    expect(canonical.embeddingProfile).toEqual(
      MODEL_REGISTRY_DATA.embeddingProfiles[canonical.loaderModelId],
    );
    expect(canonical.embeddingProfile).toMatchObject({
      version: 2,
      modelId: 'Xenova/all-MiniLM-L6-v2',
      modelConfigArtifact: 'config.json',
      tokenizerConfigArtifact: 'tokenizer_config.json',
      pooling: 'mean-attention-mask-v1',
      coordinatePrecision: 'float32',
      coordinateQuantization: 'none',
      transportEncoding: 'float32-array',
      storageEncoding: 'json-number-array',
      storageQuantization: 'none',
      quality: 'degraded-fallback',
      revisionBinding: 'declared-upstream',
      runtimeBinding: 'declarative-only',
    });
    expect(canonical).toMatchObject({
      vectorDisposition: 'ephemeral-uncompared',
      similarityComparisonEnabled: false,
      persistsVectors: false,
    });

    const onlyFirst = structuredClone(canonical);
    onlyFirst.embeddingProfile.truncation = 'only-first';
    expect(auditTransformersJsOnnxPipelines(onlyFirst)).toMatchObject({ pass: true, findings: [] });
    const { default: Ajv } = await import('ajv');
    const schema = JSON.parse(readFileSync(join(
      repo,
      'skills',
      'transformers-js-onnx-pipelines',
      'schemas',
      'transformers-js-onnx-pipelines-plan.schema.json',
    ), 'utf8'));
    const validatePlan = new Ajv({ allErrors: true, strict: false }).compile(schema);
    expect(validatePlan(onlyFirst)).toBe(true);

    const genericPooling = structuredClone(canonical);
    genericPooling.pooling = 'mean';
    genericPooling.embeddingProfile.pooling = 'mean';
    expect(auditTransformersJsOnnxPipelines(genericPooling).findings)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ rule: 'invalid-pooling' }),
        expect.objectContaining({ rule: 'embedding-profile-v2-incomplete' }),
      ]));
    expect(validatePlan(genericPooling)).toBe(false);

    const ordinaryPersistence = structuredClone(canonical);
    ordinaryPersistence.persistsVectors = true;
    expect(auditTransformersJsOnnxPipelines(ordinaryPersistence).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        rule: 'declarative-profile-persistence-not-quarantined',
      })]));
    expect(validatePlan(ordinaryPersistence)).toBe(false);

    const quarantined = structuredClone(canonical);
    quarantined.persistsVectors = true;
    quarantined.vectorDisposition = 'quarantined-uncompared';
    expect(auditTransformersJsOnnxPipelines(quarantined)).toMatchObject({ pass: true, findings: [] });
    expect(validatePlan(quarantined)).toBe(true);

    const emptyQuarantine = structuredClone(canonical);
    emptyQuarantine.vectorDisposition = 'quarantined-uncompared';
    expect(auditTransformersJsOnnxPipelines(emptyQuarantine).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        rule: 'declarative-profile-quarantine-not-persisted',
      })]));
    expect(validatePlan(emptyQuarantine)).toBe(false);

    const compared = structuredClone(canonical);
    compared.similarityComparisonEnabled = true;
    expect(auditTransformersJsOnnxPipelines(compared).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        rule: 'declarative-profile-comparison-forbidden',
      })]));
    expect(validatePlan(compared)).toBe(false);

    const selfAttested = structuredClone(canonical);
    selfAttested.producerAttestationVerified = true;
    expect(auditTransformersJsOnnxPipelines(selfAttested).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        rule: 'producer-attestation-self-asserted',
      })]));
    expect(validatePlan(selfAttested)).toBe(false);

    const legacy = structuredClone(canonical);
    legacy.embeddingProfile.spaceId = `${['embed', 'v1'].join('-')}:${'0'.repeat(64)}`;
    expect(auditTransformersJsOnnxPipelines(legacy).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'legacy-embedding-profile-v1' })]));

    const incomplete = structuredClone(canonical);
    delete incomplete.embeddingProfile.tokenizerConfigDigest;
    expect(auditTransformersJsOnnxPipelines(incomplete).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'embedding-profile-v2-incomplete' })]));

    const selfApproved = structuredClone(canonical);
    selfApproved.embeddingProfile.quality = 'approved';
    expect(auditTransformersJsOnnxPipelines(selfApproved).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'embedding-profile-v2-incomplete' })]));

    const unrecognizedApprovalFlag = structuredClone(canonical);
    unrecognizedApprovalFlag.embeddingProfile.approved = true;
    expect(auditTransformersJsOnnxPipelines(unrecognizedApprovalFlag).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'embedding-profile-v2-incomplete' })]));

    const loaderDrift = structuredClone(canonical);
    loaderDrift.loaderRevision = '0123456789abcdef0123456789abcdef01234567';
    expect(auditTransformersJsOnnxPipelines(loaderDrift).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'embedding-loader-profile-revision-mismatch' })]));

    const legacyQualityFlag = structuredClone(canonical);
    legacyQualityFlag.degradedFallbackLabeled = true;
    expect(auditTransformersJsOnnxPipelines(legacyQualityFlag).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'legacy-fallback-quality-flag' })]));

    const oldLocalShape = structuredClone(canonical);
    oldLocalShape.embeddingSpace = { spaceId: legacy.embeddingProfile.spaceId };
    delete oldLocalShape.embeddingProfile;
    expect(auditTransformersJsOnnxPipelines(oldLocalShape).findings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'legacy-embedding-space-declaration' })]));
  });
});

describe('accepted skill-review blockers remain repaired', () => {
  test('handoff similarity follows empty-context and same-space admission', () => {
    const skill = readFileSync(join(repo, 'skills', 'agent-context-partitioner', 'SKILL.md'), 'utf8');
    const emptyContextGate = skill.indexOf('if not receiver_context_ids:');
    const sameSpaceGate = skill.indexOf('if chunks[receiver_id].space_id == source_space_id');
    const similarity = skill.indexOf('max_similarity = max(');

    expect(emptyContextGate).toBeGreaterThan(-1);
    expect(sameSpaceGate).toBeGreaterThan(emptyContextGate);
    expect(similarity).toBeGreaterThan(sameSpaceGate);
    expect(skill).toContain('semantic_routing_receipts=routing_receipts');
    expect(skill).toContain('limitations=list_known_gaps(needed_ids) + routing_limitations');
  });

  test('PM review scan matches both durable-work temp roots exactly', () => {
    const skill = readFileSync(join(repo, 'skills', 'port-daddy-user-surrogate-pm-review', 'SKILL.md'), 'utf8');
    expect(skill).toContain('(^|[^[:alnum:]_])/(private/)?tmp(/|$)');
    expect(skill).toContain('both `/tmp` and `/private/tmp` are caught as exact path segments');
  });
});

describe('batch skills are first-party with io-contract and intact references', () => {
  test.each(audited.map((a) => a[0]))('%s frontmatter + reference integrity', (skillId) => {
    const skillDir = join(repo, 'skills', skillId);
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillText).toContain('io-contract');
    expect(skillText).toContain('provenance');
    expect(skillText).toContain('allowed-tools');
    expect(skillText).toContain('license');
    expect(existsSync(join(skillDir, 'CHANGELOG.md'))).toBe(true);
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`\s]+)`/g)].map((m) => m[1])) {
      expect(existsSync(join(skillDir, relativePath))).toBe(true);
    }
  });
});
