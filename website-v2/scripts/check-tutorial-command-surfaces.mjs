import fs from "node:fs";
import path from "node:path";

const roots = [path.resolve("src")];
const repoDocs = path.resolve("..", "docs", "tutorials");
if (fs.existsSync(repoDocs)) roots.push(repoDocs);

const sourceExtensions = new Set([".tsx", ".ts", ".md", ".mdx"]);
const commandPattern = /\bpd\s+[a-z]/;
const fencedTerminalPattern =
  /<!--\s*terminal\s*-->\s*```[\w-]*\n([\s\S]*?)```/g;

const jsxBlockPatterns = [
  {
    kind: "CodeBlock children",
    pattern:
      /<CodeBlock\b([^>]*)>\s*\{`([\s\S]*?)`}\s*<\/CodeBlock>/g,
    codeIndex: 2,
    propsIndex: 1,
  },
  {
    kind: "DocsCodeBlock code",
    pattern: /<DocsCodeBlock\b([\s\S]*?)\bcode=\{`([\s\S]*?)`}(.*?)\/>/g,
    codeIndex: 2,
    propsIndex: 1,
    tailIndex: 3,
  },
  {
    kind: "CommandTerminal code",
    pattern: /<CommandTerminal\b([\s\S]*?)\bcode=\{`([\s\S]*?)`}(.*?)\/>/g,
    codeIndex: 2,
    propsIndex: 1,
    tailIndex: 3,
  },
  {
    kind: "CommandBlock command",
    pattern: /<CommandBlock\b([\s\S]*?)\bcommand=\{`([\s\S]*?)`}(.*?)\/>/g,
    codeIndex: 2,
    propsIndex: 1,
    tailIndex: 3,
  },
];

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".git"
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeBlock(block) {
  return block.replace(/\\n/g, "\n").replace(/\\`/g, "`").trim();
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function hasOutputProp(source) {
  return /\boutput=\{?(?:`[\s\S]*?`|"[^"]+"|'[^']+')/.test(source);
}

function isTerminalLanguage(props) {
  const language = props.match(/\blanguage=(?:\{?["']?)([\w-]+)/)?.[1];
  return !language || ["bash", "cli", "shell", "sh"].includes(language);
}

function isInstallInstruction(text) {
  const commands = Array.from(text.matchAll(/\bpd\s+[a-z][\w-]*(?:\s+[a-z][\w-]*)?/g)).map(
    (match) => match[0],
  );

  if (commands.length === 0) return false;

  return commands.every((line) =>
    /^(?:pd\s+setup\b|pd\s+mcp\s+install\b|pd\s+install\b|port-daddy\s+install\b)/.test(
      line,
    ),
  );
}

function isPromptText(text) {
  return /You are agent\b|Emit pd note\b|Leave pd note\b|If the task reaches\b/.test(
    text,
  );
}

function isCommandLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const withoutPrompt = trimmed.replace(/^\$\s*/, "");
  return /^(?:pd|port-daddy|npm|npx|pnpm|yarn|brew|pip|python|node|tsx|git|cd|cat|cp|curl|printf|open|asciinema|agg|vhs|PORT=|PD_URL=|\.\/|export\b)\b/.test(
    withoutPrompt,
  );
}

function isContinuationLine(line) {
  return /^\s*(?:--|\||&&|\\|\})/.test(line);
}

function isCommentLine(line) {
  return /^\s*#/.test(line);
}

function hasVisibleOutput(text) {
  const lines = normalizeBlock(text).split("\n");
  let sawCommand = false;

  for (const line of lines) {
    if (commandPattern.test(line) || isCommandLine(line)) {
      sawCommand = true;
      continue;
    }
    if (!sawCommand) continue;
    if (!line.trim() || isCommentLine(line) || isContinuationLine(line)) continue;
    return true;
  }

  return false;
}

function addFinding(findings, file, line, kind, text) {
  if (!commandPattern.test(text)) return;
  if (normalizeBlock(text).trimStart().startsWith("#!")) return;
  if (isInstallInstruction(text) || isPromptText(text)) return;
  if (hasVisibleOutput(text)) return;

  findings.push(
    `${path.relative(process.cwd(), file)}:${line} (${kind}) has pd command input without real visible output`,
  );
}

const findings = [];
const files = roots.flatMap(walk).sort();

function assertSourceIncludes(relativePath, needle, message) {
  const file = path.resolve(relativePath);
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(needle)) {
    findings.push(`${relativePath}: ${message}`);
  }
}

assertSourceIncludes(
  "src/docs-content/types.ts",
  "exempt: 'install'",
  "command content blocks must model install exemptions explicitly",
);
assertSourceIncludes(
  "src/pages/docs/DocsSectionPage.tsx",
  "output={block.output}",
  "docs command blocks must render captured output",
);
assertSourceIncludes(
  "src/data/examples.ts",
  "output: string",
  "example commands must require captured output",
);
assertSourceIncludes(
  "src/pages/ExampleDetailPage.tsx",
  "output={command.output}",
  "example command views must render captured output",
);
assertSourceIncludes(
  "src/pages/AgentsPage.tsx",
  "terminalOutputFor(",
  "agent terminal examples must route through the shared output fixture helper",
);

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");

  if (file.endsWith(".md") || file.endsWith(".mdx")) {
    let match;
    while ((match = fencedTerminalPattern.exec(source)) !== null) {
      addFinding(findings, file, lineNumber(source, match.index), "terminal fence", match[1]);
    }
  }

  for (const spec of jsxBlockPatterns) {
    let match;
    while ((match = spec.pattern.exec(source)) !== null) {
      const props = [match[spec.propsIndex] ?? "", match[spec.tailIndex] ?? ""].join(" ");
      if (!isTerminalLanguage(props)) continue;
      if (hasOutputProp(props)) continue;
      addFinding(
        findings,
        file,
        lineNumber(source, match.index),
        spec.kind,
        match[spec.codeIndex],
      );
    }
  }
}

if (findings.length > 0) {
  console.error("Terminal command surfaces missing real Port Daddy output:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Terminal command surfaces include output or install exemptions across ${files.length} files.`);
