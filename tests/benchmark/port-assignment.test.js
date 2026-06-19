// Performance benchmarks for Port Daddy
// Run with: node tests/benchmark/port-assignment.test.js

import { performance } from 'perf_hooks';

const API_URL = process.env.PORT_DADDY_URL || 'http://localhost:9876';

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_URL}${path}`, options);
  return res.json();
}

async function benchmarkPortAssignment(iterations = 100) {
  const times = [];

  console.log(`\n📊 Port Assignment Benchmark (${iterations} iterations)`);
  console.log('='.repeat(60));

  for (let i = 0; i < iterations; i++) {
    const projectName = `bench-project-${i}`;

    const start = performance.now();
    await request('POST', '/ports/request', { project: projectName });
    const end = performance.now();

    times.push(end - start);

    // Clean up
    await request('DELETE', '/ports/release', { project: projectName });
  }

  const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const p50 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.5)];
  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
  const p99 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.99)];

  console.log(`Average:  ${avg.toFixed(2)}ms`);
  console.log(`Min:      ${min.toFixed(2)}ms`);
  console.log(`Max:      ${max.toFixed(2)}ms`);
  console.log(`P50:      ${p50.toFixed(2)}ms`);
  console.log(`P95:      ${p95.toFixed(2)}ms`);
  console.log(`P99:      ${p99.toFixed(2)}ms`);

  const targetMet = avg < 10;
  console.log(`\n${targetMet ? '✅' : '❌'} Target: <10ms average (${avg.toFixed(2)}ms)`);

  return { avg, min, max, p50, p95, p99 };
}

async function benchmarkConcurrentAssignments(concurrency = 10) {
  console.log(`\n📊 Concurrent Assignment Benchmark (${concurrency} concurrent)`);
  console.log('='.repeat(60));

  const start = performance.now();

  const promises = Array.from({ length: concurrency }, (_, i) =>
    request('POST', '/ports/request', { project: `concurrent-${i}` })
  );

  await Promise.all(promises);

  const end = performance.now();
  const totalTime = end - start;
  const avgPerRequest = totalTime / concurrency;

  console.log(`Total time:     ${totalTime.toFixed(2)}ms`);
  console.log(`Avg per request: ${avgPerRequest.toFixed(2)}ms`);
  console.log(`Throughput:      ${(1000 / avgPerRequest).toFixed(0)} req/s`);

  // Cleanup
  for (let i = 0; i < concurrency; i++) {
    await request('DELETE', '/ports/release', { project: `concurrent-${i}` });
  }

  return { totalTime, avgPerRequest };
}

async function benchmarkHealthCheck(iterations = 1000) {
  const times = [];

  console.log(`\n📊 Health Check Benchmark (${iterations} iterations)`);
  console.log('='.repeat(60));

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fetch(`${API_URL}/health`);
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  console.log(`Average:  ${avg.toFixed(2)}ms`);
  console.log(`P95:      ${p95.toFixed(2)}ms`);

  const targetMet = avg < 1;
  console.log(`\n${targetMet ? '✅' : '❌'} Target: <1ms average (${avg.toFixed(2)}ms)`);

  return { avg, p95 };
}

async function runAllBenchmarks() {
  console.log('\n🚀 Port Daddy Performance Benchmarks');
  console.log('='.repeat(60));

  try {
    // Check if service is running
    const health = await fetch(`${API_URL}/health`);
    if (!health.ok) {
      throw new Error('Port Daddy service not responding');
    }

    await benchmarkPortAssignment(100);
    await benchmarkConcurrentAssignments(10);
    await benchmarkHealthCheck(1000);

    console.log('\n✅ All benchmarks completed\n');
  } catch (err) {
    console.error('\n❌ Benchmark failed:', err.message);
    console.error('Make sure Port Daddy is running on', API_URL);
    process.exit(1);
  }
}

// Run benchmarks
runAllBenchmarks();
