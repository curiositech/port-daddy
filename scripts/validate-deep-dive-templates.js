const fs = require('fs');
const path = require('path');

const TEMPLATE = '# Deep Dive Template\n\n## Paper\n[Title]\n\n## Claim\n[Description]\n\n## Questions\n- [Question 1]\n- [Question 2]\n\n## Reading List\n- [Paper 1]\n- [Paper 2]\n\n## Skills\n- [Skill 1]\n- [Skill 2]\n\n## Findings\n[Stubs]';

const DEEP_DIVE_DIR = path.join(__dirname, '../docs/harbor-research/deep-dives');

fs.readdirSync(DEEP_DIVE_DIR).forEach(dir => {
  const filePath = path.join(DEEP_DIVE_DIR, dir, 'README.md');
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.includes(TEMPLATE)) {
      console.error(`Invalid template in ${dir}`);
    }
  }
});