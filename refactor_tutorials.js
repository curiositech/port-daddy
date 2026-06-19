import fs from 'fs';
import path from 'path';

const tutorialsDir = 'website-v2/src/pages/tutorials/';
const files = fs.readdirSync(tutorialsDir).filter(f => f.endsWith('.tsx') && f !== 'index.ts');

const tagReplacements = [
  { tag: 'p', fontClass: 'font-sans' },
  { tag: 'h1', fontClass: 'font-display' },
  { tag: 'h2', fontClass: 'font-display' },
  { tag: 'h3', fontClass: 'font-display' },
  { tag: 'ul' },
  { tag: 'li', fontClass: 'font-sans' },
  { tag: 'ol' },
  { tag: 'strong', fontClass: 'font-sans' },
  { tag: 'code', fontClass: 'font-mono' },
  { tag: 'span', fontClass: 'font-sans' },
  { tag: 'button', fontClass: 'font-sans' },
  { tag: 'a', fontClass: 'font-sans' },
  { tag: 'img' },
  { tag: 'pre', fontClass: 'font-mono' },
  { tag: 'section' },
  { tag: 'div' }
];

files.forEach(file => {
  const filePath = path.join(tutorialsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Temporarily extract CodeBlocks to avoid touching them
  const codeBlocks = [];
  content = content.replace(/<CodeBlock[\s\S]*?\/>/g, (match) => {
    const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
    codeBlocks.push(match);
    return placeholder;
  });

  // 2. Perform replacements on the rest
  tagReplacements.forEach(({ tag, fontClass }) => {
    // Replace closing tags
    const closeRegex = new RegExp(`</${tag}>`, 'g');
    content = content.replace(closeRegex, `</motion.${tag}>`);

    // Replace opening tags with attributes
    const openAttrRegex = new RegExp(`<${tag} `, 'g');
    content = content.replace(openAttrRegex, `<motion.${tag} `);

    // Replace naked opening tags
    const openNakedRegex = new RegExp(`<${tag}>`, 'g');
    if (fontClass) {
      content = content.replace(openNakedRegex, `<motion.${tag} className="${fontClass}">`);
    } else {
      content = content.replace(openNakedRegex, `<motion.${tag}>`);
    }
  });

  // 3. Ensure font classes for motion elements that have other attributes but no className
  tagReplacements.forEach(({ tag, fontClass }) => {
    if (fontClass) {
      const motionRegex = new RegExp(`<motion\.${tag}(?![^>]*className=)(?=[^>]*\\s)`, 'g');
      content = content.replace(motionRegex, `<motion.${tag} className="${fontClass}" `);
    }
  });

  // 4. Update versions
  content = content.replace(/v3\.[0-9]\.[0-9]/g, 'v3.7.0');

  // 5. Ensure motion import is at the TOP (if used)
  const lines = content.split('\n');
  const hasTopLevelMotionImport = lines.some(line => line.startsWith("import { motion } from 'framer-motion'"));
  const hasMotionElements = content.includes('motion.');

  if (hasMotionElements && !hasTopLevelMotionImport) {
    let insertIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('import')) {
            insertIndex = i + 1;
        } else if (lines[i].trim() !== '' && !lines[i].startsWith('//')) {
            break;
        }
    }
    lines.splice(insertIndex, 0, "import { motion } from 'framer-motion'");
    content = lines.join('\n');
  }

  // 6. Re-insert CodeBlocks
  codeBlocks.forEach((block, i) => {
    content = content.replace(`__CODEBLOCK_${i}__`, block);
  });

  // Cleanup: if we accidentally added motion. to motion. (happens if we run twice)
  content = content.replace(/motion\.motion\./g, 'motion.');
  content = content.replace(/<\/motion\.motion\./g, '</motion.');

  fs.writeFileSync(filePath, content);
  console.log(`Refactored ${file}`);
});
