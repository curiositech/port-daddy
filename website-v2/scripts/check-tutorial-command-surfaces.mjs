import fs from "node:fs";
import path from "node:path";

const tutorialsDir = path.resolve("src/pages/tutorials");
const tutorialFiles = fs
  .readdirSync(tutorialsDir)
  .filter((name) => name.endsWith(".tsx"))
  .sort();

const commandPattern = /\bpd\s+[a-z]/;
const outputHints = [
  /^\[.+\]/,
  /^✓\s+/,
  /^→\s+/,
  /^SUCCESS:/,
  /^ERROR:/,
  /^INFO:/,
  /^WARN:/,
  /^session:/i,
  /^agent[-:]/i,
  /^Recent /,
  /^Port Daddy /,
  /^Watching /,
  /^Waiting /,
  /^Message sent /,
  /^localhost:/,
  /^Claimed /,
  /^CONFLICT:/,
  /^Holder session:/,
  /^AGENT ID\b/,
  /^spawned[-\w]*\b/,
  /^#\s*(Expected|Result|Output|Daemon-visible|Example output)/i,
  /^#\s*→/,
];

function looksLikeOutput(line) {
  return outputHints.some((pattern) => pattern.test(line));
}

function normalizeBlock(block) {
  return block.replace(/\\n/g, "\n");
}

function extractBashBlocks(source) {
  const blocks = [];
  const regex =
    /<CodeBlock[^>]*language="bash"[^>]*>\s*\{`([\s\S]*?)`}\s*<\/CodeBlock>/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

const findings = [];

for (const fileName of tutorialFiles) {
  const filePath = path.join(tutorialsDir, fileName);
  const source = fs.readFileSync(filePath, "utf8");
  const blocks = extractBashBlocks(source);

  blocks.forEach((block, index) => {
    const lines = normalizeBlock(block)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.some((line) => commandPattern.test(line))) {
      return;
    }

    const hasOutput = lines.some((line) => looksLikeOutput(line));
    if (!hasOutput) {
      findings.push(`${fileName} block ${index + 1}`);
    }
  });
}

if (findings.length > 0) {
  console.error("Tutorial bash blocks missing visible output or result:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Tutorial command surfaces look healthy across ${tutorialFiles.length} tutorial files.`,
);
