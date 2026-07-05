#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_WORKLOADS = ['olap', 'oltp', 'streaming', 'vector-search'];
const VALID_ENVIRONMENTS = ['exploration', 'production'];
const VALID_CSV_STRATEGIES = ['explicit', 'auto', 'none'];
const VALID_COMPRESSIONS = ['zstd', 'snappy', 'gzip', 'uncompressed', 'none'];
const VALID_PROJECTIONS = ['explicit-columns', 'select-star'];
const VALID_FILTER_PUSHDOWN = ['duckdb-sql', 'pandas-post-load'];
const VALID_CARDINALITY = ['low', 'high', 'none'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a DuckDB pipeline plan against duckdb-analytics' core rules — DuckDB
 * is embedded OLAP (single writer, columnar, push the work into SQL) — and its
 * Quality Gates. Rules operate on structured enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/duckdb-pipeline-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditDuckdbPipeline(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_WORKLOADS.includes(plan.workloadType)) {
    throw new TypeError(`plan.workloadType must be one of: ${VALID_WORKLOADS.join(', ')}`);
  }
  if (!VALID_ENVIRONMENTS.includes(plan.environment)) {
    throw new TypeError(`plan.environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= { critical: 30, high: 15, medium: 8, low: 3 }[severity] ?? 5;
  }

  // --- Gate: DuckDB is for OLAP, not OLTP/streaming/vector search ---
  if (plan.workloadType !== 'olap') {
    const alternatives = {
      oltp: 'Postgres/MySQL/SQLite-WAL — DuckDB is single-writer and locks the file for write transactions',
      streaming: 'an external streaming pipeline feeding batch files — DuckDB is batch-friendly',
      'vector-search': 'pgvector/Lance/Chroma — DuckDB VSS is early',
    };
    fail(
      'wrong-workload-for-duckdb',
      'critical',
      `workloadType is '${plan.workloadType}': DuckDB is an embedded analytical (OLAP) database and the wrong tool for this workload.`,
      `Use ${alternatives[plan.workloadType]}.`
    );
  }

  // --- Gate: single writer per database file ---
  if (typeof plan.concurrentWriters === 'number' && plan.concurrentWriters > 1) {
    fail(
      'multiple-concurrent-writers',
      'critical',
      `concurrentWriters is ${plan.concurrentWriters}: DuckDB is single-writer; concurrent write transactions hang or fail on the file lock.`,
      'Restructure to a single producer per database file (or per output partition); readers can be many.'
    );
  }

  // --- Gate: no read_csv_auto in production ---
  if (plan.readsCsv === true) {
    if (!VALID_CSV_STRATEGIES.includes(plan.csvTypeStrategy)) {
      fail(
        'csv-type-strategy-unspecified',
        'medium',
        `readsCsv is true but csvTypeStrategy is not one of: ${VALID_CSV_STRATEGIES.join(', ')}.`,
        'State whether CSV types are explicit or auto-detected so the production gate can be checked.'
      );
    } else if (plan.environment === 'production' && plan.csvTypeStrategy === 'auto') {
      fail(
        'auto-type-inference-in-production',
        'high',
        "environment is 'production' with csvTypeStrategy 'auto': read_csv_auto silently mistypes columns when the input shape drifts.",
        'Lock types with read_csv(..., columns = {...}) for production pipelines; keep auto-detection for exploration.'
      );
    }
  }

  // --- Gate: project only needed columns ---
  if (plan.columnProjection !== undefined) {
    if (!VALID_PROJECTIONS.includes(plan.columnProjection)) {
      fail(
        'invalid-column-projection',
        'low',
        `columnProjection "${plan.columnProjection}" is not one of: ${VALID_PROJECTIONS.join(', ')}.`,
        'Name the projection style so the SELECT * rule can be checked.'
      );
    } else if (plan.columnProjection === 'select-star') {
      fail(
        'select-star-projection',
        'medium',
        "columnProjection is 'select-star': SELECT * reads every column off disk, throwing away the columnar advantage Parquet exists for.",
        'Project only the columns the query uses so DuckDB can push the projection into the Parquet reader.'
      );
    }
  }

  // --- Gate: filter in DuckDB SQL, not after loading into pandas ---
  if (plan.filterPushdown !== undefined) {
    if (!VALID_FILTER_PUSHDOWN.includes(plan.filterPushdown)) {
      fail(
        'invalid-filter-pushdown',
        'low',
        `filterPushdown "${plan.filterPushdown}" is not one of: ${VALID_FILTER_PUSHDOWN.join(', ')}.`,
        'Name where filtering happens so the pandas-materialization rule can be checked.'
      );
    } else if (plan.filterPushdown === 'pandas-post-load') {
      fail(
        'pandas-materialization-before-filter',
        'high',
        "filterPushdown is 'pandas-post-load': pulling the full dataset into pandas before filtering is the OOM / 30-minute-runtime pattern.",
        "Push the WHERE clause into DuckDB (duckdb.sql(...).df()) so only the result is materialized."
      );
    }
  }

  // --- Gate: production Parquet exports use ZSTD ---
  if (plan.environment === 'production' && plan.writesParquet === true) {
    if (!VALID_COMPRESSIONS.includes(plan.parquetCompression)) {
      fail(
        'parquet-compression-unspecified',
        'low',
        `writesParquet is true but parquetCompression is not one of: ${VALID_COMPRESSIONS.join(', ')}.`,
        'State the compression codec; ZSTD is the right default.'
      );
    } else if (plan.parquetCompression !== 'zstd') {
      fail(
        'non-zstd-parquet-output',
        'low',
        `parquetCompression is '${plan.parquetCompression}': ZSTD gives better compression than snappy at similar speed and is this skill's default for production exports.`,
        'Use COPY ... (FORMAT PARQUET, COMPRESSION ZSTD).'
      );
    }
  }

  // --- Gate: partition columns are low-cardinality ---
  if (plan.partitionColumnCardinality !== undefined) {
    if (!VALID_CARDINALITY.includes(plan.partitionColumnCardinality)) {
      fail(
        'invalid-partition-cardinality',
        'low',
        `partitionColumnCardinality "${plan.partitionColumnCardinality}" is not one of: ${VALID_CARDINALITY.join(', ')}.`,
        'Classify the partition column cardinality so the partitioning rule can be checked.'
      );
    } else if (plan.partitionColumnCardinality === 'high') {
      fail(
        'high-cardinality-partition-column',
        'medium',
        "partitionColumnCardinality is 'high': partitioning by a high-cardinality column produces millions of tiny files and defeats partition pruning.",
        'Partition by query-pattern columns like date; keep high-cardinality columns as ordinary columns.'
      );
    }
  }

  // --- Gate: INSTALL and LOAD are paired for remote reads ---
  if (plan.usesHttpfs === true && plan.extensionLoadPaired !== true) {
    fail(
      'install-without-load',
      'medium',
      "usesHttpfs is true but extensionLoadPaired is not: INSTALL downloads the extension, LOAD activates it — missing LOAD yields 'IO Error: Could not access HTTP' on s3:// URLs.",
      'Run INSTALL httpfs; LOAD httpfs; in that order per session (or use a persistent database where extensions persist).'
    );
  }

  // --- Gate: S3 credentials never in version control ---
  if (plan.s3CredentialsInVersionControl === true) {
    fail(
      's3-credentials-committed',
      'critical',
      's3CredentialsInVersionControl is true: access keys committed with the pipeline SQL/notebooks are leaked credentials.',
      'Use IAM roles, AWS_PROFILE, or environment variables; never commit s3_access_key_id/s3_secret_access_key.'
    );
  }

  // --- Gate: pin the DuckDB version in production ---
  if (plan.environment === 'production' && plan.duckdbVersionPinned !== true) {
    fail(
      'duckdb-version-unpinned',
      'low',
      'duckdbVersionPinned is not true in production: DuckDB upgrades occasionally shift aggregation semantics; unpinned versions make results drift silently.',
      'Pin the DuckDB version and re-test aggregations on upgrade.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still run EXPLAIN on any query over ~5s against representative data before scheduling it.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: duckdb_pipeline_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditDuckdbPipeline(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`duckdb_pipeline_audit: ${e.message}\n`);
    process.exit(1);
  }
}
