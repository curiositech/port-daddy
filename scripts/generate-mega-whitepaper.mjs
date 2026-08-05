#!/usr/bin/env node

/**
 * Generate the body and single bibliography for the collected coordination
 * papers volume.
 *
 * The seven papers remain independently buildable source documents. This
 * generator removes only their standalone chrome (title page, local contents,
 * and local bibliography), recursively inlines their TikZ figures, namespaces
 * labels, and collates citations into one reference list. It deliberately
 * fails on missing citations or imports so the collected volume cannot drift
 * silently from its chapters.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(
  repoRoot,
  process.argv[2] ?? '.cache/whitepaper-build/coordination-papers-mega-volume',
);

const papers = [
  { roman: 'I', prefix: 'ls', title: 'The Legible Swarm', source: 'whitepaper/legible-swarm.tex' },
  { roman: 'II', prefix: 'swk', title: 'The Single-Writer Kernel', source: 'whitepaper/single-writer-kernel.tex' },
  { roman: 'III', prefix: 'stp', title: 'From Spawn to Person', source: 'website-v2/public/whitepaper/spawn-to-person.tex' },
  { roman: 'IV', prefix: 'he', title: 'The Harbor Economy', source: 'website-v2/public/whitepaper/harbor-economy.tex' },
  { roman: 'V', prefix: 'anchor', title: 'The Anchor Protocol', source: 'website-v2/public/whitepaper/anchor-protocol-whitepaper.tex' },
  { roman: 'VI', prefix: 'bonded', title: 'The Bonded Commons', source: 'website-v2/public/whitepaper/agent-transactions-whitepaper.tex' },
  { roman: 'VII', prefix: 'fh', title: 'The Federated Harbor', source: 'website-v2/public/whitepaper/federated-harbor-whitepaper.tex' },
];

function readUtf8(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function inlineInputs(tex, sourceDir, stack = []) {
  return tex.replace(/\\(?:input|include)\{([^}]+)\}/g, (whole, rawRef) => {
    const withExt = extname(rawRef) ? rawRef : `${rawRef}.tex`;
    const imported = resolve(sourceDir, withExt);
    if (stack.includes(imported)) {
      throw new Error(`cyclic TeX import: ${[...stack, imported].join(' -> ')}`);
    }
    let child;
    try {
      child = readUtf8(imported);
    } catch (error) {
      throw new Error(`cannot inline ${rawRef} from ${sourceDir}: ${error.message}`);
    }
    return [
      `% BEGIN INLINED ${rawRef}`,
      inlineInputs(child, dirname(imported), [...stack, imported]),
      `% END INLINED ${rawRef}`,
    ].join('\n');
  });
}

function documentBody(tex, source) {
  const begin = tex.indexOf('\\begin{document}');
  const end = tex.lastIndexOf('\\end{document}');
  if (begin < 0 || end < begin) throw new Error(`${source}: malformed document body`);
  return tex.slice(begin + '\\begin{document}'.length, end);
}

function splitBibliography(body, source) {
  const entries = [];
  const without = body.replace(
    /\\begin\{thebibliography\}\{[^}]*\}([\s\S]*?)\\end\{thebibliography\}/g,
    (_whole, contents) => {
      const starts = [...contents.matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)];
      for (let i = 0; i < starts.length; i += 1) {
        const start = starts[i];
        const bodyStart = start.index + start[0].length;
        const bodyEnd = starts[i + 1]?.index ?? contents.length;
        entries.push({
          key: start[1].trim(),
          body: contents.slice(bodyStart, bodyEnd).trim(),
          source,
        });
      }
      return '\n% Bibliography moved to the collected reference list.\n';
    },
  );
  return { body: without.replace(/\\bibliographystyle\{[^}]+\}/g, ''), entries };
}

function normalizedReference(body) {
  return body
    .replace(/(^|\n)\s*%.*(?=\n|$)/g, ' ')
    .replace(/\\(?:url|path)\{([^}]+)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
    .replace(/[{}~]/g, ' ')
    .replace(/\\[&%_$#]/g, ' ')
    .replace(/[^a-zA-Z0-9./:-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function referenceFingerprint(body) {
  const normalized = normalizedReference(body);
  const doi = normalized.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0];
  return doi ? `doi:${doi.replace(/[.,;]+$/, '')}` : `text:${normalized}`;
}

function compareNormalizedReferences(a, b) {
  const left = normalizedReference(a.body);
  const right = normalizedReference(b.body);
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanStandaloneChrome(body) {
  return body
    .replace(/\\maketitle\s*/g, '')
    .replace(/\\thispagestyle\{empty\}\s*/g, '')
    .replace(/\\tableofcontents\s*/g, '')
    .replace(/\\appendix\s*/g, '\\pdchapterappendix\n')
    .replace(/\n{4,}/g, '\n\n\n');
}

function namespaceChapterSyntax(body, paper) {
  let next = body;
  const environmentMap = {
    ls: { exercises: 'lsexercises', protocol: 'lsprotocol' },
    stp: { exercises: 'stpexercises', protocol: 'stpprotocol' },
    he: { exercises: 'heexercises', protocol: 'heprotocol' },
  }[paper.prefix] ?? {};
  for (const [from, to] of Object.entries(environmentMap)) {
    next = next
      .replaceAll(`\\begin{${from}}`, `\\begin{${to}}`)
      .replaceAll(`\\end{${from}}`, `\\end{${to}}`);
  }
  if (paper.prefix === 'swk') next = next.replace(/\\exercises\{/g, '\\swkexercises{');
  return next;
}

function namespaceLabels(body, prefix) {
  const commands = 'label|ref|eqref|pageref|autoref|cref|Cref|nameref';
  return body
    .replace(new RegExp(`\\\\(${commands})\\{([^}]+)\\}`, 'g'), (_whole, command, label) => {
      return `\\${command}{${prefix}:${label.trim()}}`;
    })
    // The chapter listings use alg:* key-value labels rather than \label{...}.
    // Keep this deliberately narrow: TikZ also has a visual `label={...}` key.
    .replace(/label=\{(alg:[^}]+)\}/g, (_whole, label) => `label={${prefix}:${label.trim()}}`);
}

function rewriteCitations(body, citationMap, source) {
  return body.replace(/\\cite(\[[^\]]*\])?\{([^}]+)\}/g, (_whole, optional = '', keys) => {
    const rewritten = keys.split(',').map((raw) => {
      const key = raw.trim();
      const mapped = citationMap.get(key);
      if (!mapped) throw new Error(`${source}: citation ${key} has no local bibliography entry`);
      return mapped;
    });
    return `\\cite${optional}{${rewritten.join(',')}}`;
  });
}

function generate() {
const prepared = papers.map((paper) => {
  const sourcePath = resolve(repoRoot, paper.source);
  const rootBody = documentBody(readUtf8(sourcePath), paper.source);
  const inlined = inlineInputs(rootBody, dirname(sourcePath), [sourcePath]);
  const split = splitBibliography(inlined, paper.source);
  return { ...paper, body: split.body, references: split.entries };
});

const canonicalByFingerprint = new Map();
const canonicalReferences = [];

for (const paper of prepared) {
  paper.citationMap = new Map();
  for (const ref of paper.references) {
    const fingerprint = referenceFingerprint(ref.body);
    let canonical = canonicalByFingerprint.get(fingerprint);
    if (!canonical) {
      canonical = { ...ref, key: `mega${String(canonicalReferences.length + 1).padStart(3, '0')}` };
      canonicalByFingerprint.set(fingerprint, canonical);
      canonicalReferences.push(canonical);
    }
    const existing = paper.citationMap.get(ref.key);
    if (existing && existing !== canonical.key) {
      throw new Error(`${paper.source}: bibliography key ${ref.key} maps to two references`);
    }
    paper.citationMap.set(ref.key, canonical.key);
  }
}

const generatedBodies = prepared.map((paper) => {
  let body = cleanStandaloneChrome(paper.body);
  body = namespaceChapterSyntax(body, paper);
  body = namespaceLabels(body, paper.prefix);
  body = rewriteCitations(body, paper.citationMap, paper.source);
  return [
    `% SOURCE: ${paper.source}`,
    `\\pdchapter{${paper.roman}}{${paper.title}}`,
    body.trim(),
  ].join('\n\n');
});

canonicalReferences.sort(compareNormalizedReferences);
const bibliography = [
  '\\begin{thebibliography}{999}',
  ...canonicalReferences.flatMap((ref) => [
    `\\bibitem{${ref.key}}`,
    ref.body,
    '',
  ]),
  '\\end{thebibliography}',
  '',
].join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'mega-volume-body.tex'), `${generatedBodies.join('\n\n\\clearpage\n\n')}\n`, 'utf8');
writeFileSync(resolve(outDir, 'mega-volume-bibliography.tex'), bibliography, 'utf8');
writeFileSync(
  resolve(outDir, 'mega-volume-generation.json'),
  `${JSON.stringify({ chapters: papers.length, references: canonicalReferences.length, sources: papers.map((p) => p.source) }, null, 2)}\n`,
  'utf8',
);

console.log(`generated ${papers.length} chapters and ${canonicalReferences.length} collated references in ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generate();

export { compareNormalizedReferences, inlineInputs, rewriteCitations };
