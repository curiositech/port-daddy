const fs = require('fs');
const svg = fs.readFileSync('website-v2/public/pd_logo.svg', 'utf8');
const paths = [...svg.matchAll(/<path[^>]+>/g)].map(m => m[0]);
console.log(`Found ${paths.length} paths`);
const fills = paths.map(p => {
  const match = p.match(/fill="([^"]+)"/);
  return match ? match[1] : 'none';
});
const uniqueFills = [...new Set(fills)];
console.log('Unique fills:', uniqueFills);
// Find the 'pd' paths at the end
console.log('Last 5 fills:', fills.slice(-5));
