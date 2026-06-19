/**
 * CLI Benchmarking Command
 *
 * Measures Port Daddy daemon performance: latency, throughput, and concurrent stability.
 */

import { performance } from 'node:perf_hooks';
import { pdFetch, getDaemonUrl } from '../utils/fetch.js';
import { ANSI } from '../../lib/maritime.js';
import { printCompactHeader, WHEEL, ANCHOR } from '../../lib/banner.js';
import * as ui from '../utils/ui.js';

interface BenchResults {
  avg: number;
  min: number;
  max: number;
  p95: number;
  count: number;
}

function calculateStats(times: number[]): BenchResults {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    avg: sum / times.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    count: times.length
  };
}

async function benchmarkPorts(iterations: number): Promise<BenchResults> {
  const times: number[] = [];
  const daemonUrl = getDaemonUrl();

  for (let i = 0; i < iterations; i++) {
    const id = `bench-${Math.random().toString(36).slice(2, 8)}`;
    const start = performance.now();
    
    // Request port
    await pdFetch(`${daemonUrl}/ports/request`, {
      method: 'POST',
      body: JSON.stringify({ identity: id })
    });
    
    const end = performance.now();
    times.push(end - start);

    // Release (not timed)
    await pdFetch(`${daemonUrl}/ports/release`, {
      method: 'DELETE',
      body: JSON.stringify({ identity: id })
    });
  }

  return calculateStats(times);
}

async function benchmarkHealth(iterations: number): Promise<BenchResults> {
  const times: number[] = [];
  const daemonUrl = getDaemonUrl();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await pdFetch(`${daemonUrl}/health`);
    const end = performance.now();
    times.push(end - start);
  }

  return calculateStats(times);
}

export async function handleBench(args: string[]): Promise<void> {
  const iterations = parseInt(args[0]) || 50;
  
  printCompactHeader('PERFORMANCE BENCHMARK');
  console.log(`  ${ANCHOR} Target: ${getDaemonUrl()}`);
  console.log(`  ${WHEEL} Running ${iterations} iterations per test...`);
  console.log('');

  try {
    // 1. Health Latency
    process.stdout.write(`  ${ANSI.fgCyan}Checking Health Latency...${ANSI.reset} `);
    const healthStats = await benchmarkHealth(iterations);
    console.log(`${ANSI.fgGreen}${healthStats.avg.toFixed(2)}ms${ANSI.reset} (p95: ${healthStats.p95.toFixed(2)}ms)`);

    // 2. Port Assignment Latency
    process.stdout.write(`  ${ANSI.fgCyan}Checking Port Assignment...${ANSI.reset} `);
    const portStats = await benchmarkPorts(iterations);
    console.log(`${ANSI.fgGreen}${portStats.avg.toFixed(2)}ms${ANSI.reset} (p95: ${portStats.p95.toFixed(2)}ms)`);

    console.log('');
    ui.success('Benchmarks completed. System is purring.');
    console.log('');
  } catch (err: any) {
    console.error(`\n  ${ANSI.fgRed}Benchmark failed:${ANSI.reset} ${err.message}`);
    process.exit(1);
  }
}
