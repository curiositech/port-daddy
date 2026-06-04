/**
 * Deep Repo Script - Targeting suspicious routes
 */
import http from 'http';

async function test(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:9876${path}`, (res) => {
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
  const req = http.get('http://localhost:9876/activity/subscribe', (res) => {
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
