const fs = require('fs');
const path = require('path');

const whitepaper = fs.readFileSync('whitepaper/single-writer-kernel.tex', 'utf-8');

const requiredGrades = [
  '\Built',
  '\BuiltWeak',
  '\Designed',
  '\Vision'
];

requiredGrades.forEach(grade => {
  if (!whitepaper.includes(grade)) {
    console.error(`Missing implementation grade: ${grade}`);
    process.exit(1);
  }
});

console.log('Text references validation passed');