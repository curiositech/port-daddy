const fs = require('fs');
const svg = fs.readFileSync('website-v2/public/pd_logo.svg', 'utf8');
const fills = [...svg.matchAll(/fill="(rgb\([^)]+\))"/g)].map(m => m[1]);
const uniqueFills = [...new Set(fills)];
console.log("Unique fills:", uniqueFills);
