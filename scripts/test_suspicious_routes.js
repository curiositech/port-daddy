/**
 * Deep Repo Script - Targeting suspicious routes
 *
 * Run under tsx so the daemon-port resolver import resolves:
 *   npx tsx scripts/test_suspicious_routes.js
 */
import http from 'http';
import { resolveDaemonUrl } from '../shared/daemon-discovery.js';

const BASE_URL = resolveDaemonUrl();

async function test(path) {
  return new Promise((resolve) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      console.log(`[${path}] Status: ${res.statusCode}`);
      res.on('data', () => {});
      res.on('end', resolve);
    }).on('error', (err) => {
      console.error(`[${path}] Error: ${err.message}`);
      resolve(null);
    });
  });
}

async function run() {
  await test('/status');
  await test('/activity/timeline');
  console.log('Testing /activity/subscribe (terminating quickly)...');
  const req = http.get(`${BASE_URL}/activity/subscribe`, (res) => {
    console.log('[/activity/subscribe] Connected');
    res.on('data', () => {});
    setTimeout(() => {
      req.destroy();
      console.log('[/activity/subscribe] Disconnected');
    }, 1000);
  });
  
  await new Promise(r => setTimeout(r, 2000));
  console.log('Checking status again...');
  await test('/status');
}

run();
