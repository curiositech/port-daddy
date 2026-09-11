#!/usr/bin/env node
/**
 * check-banned-phrases.mjs — the author's standing rule, mechanized: "held to
 * account" and "load-bearing" (also "load bearing") are never written anywhere
 * in this repository's prose. Both read as reflexive corporate hedge-words the
 * moment a second pair of eyes sees them, and a house style that bans a phrase
 * only in the docs a human happened to reread is not a rule, it is a memory
 * test. This script is the difference: it is dependency-free, case-insensitive,
 * and fails closed on any hit in the phrase list's configured scope.
 *
 * Scope is deliberately narrower than "the whole repo": source-code comments,
 * tests, formal-model files (.pv/.tla/.cfg/.z3/.ec), and CHANGELOG history are
 * excluded on purpose (see scripts/lint/banned-phrases.json's "exclude" list)
 * — a changelog entry recording that a phrase USED to appear, or a formal
 * model's own vocabulary, is not the prose this rule is policing. Everything
 * else the phrase list's "paths" glob reaches — skills, docs, top-level
 * READMEs, the PR template, the website's content modules, and the whitepaper
 * corpora — is in scope, unconditionally. That reach includes a few JSON
 * files whose string values render into prose a reader sees (the harbor
 * research library index, the Book's chapter-order table, the figure
 * register, and the exposition corpus's figure-check sidecars): the scanner
 * treats them as plain text like everything else, so a phrase sitting inside
 * a JSON string value is caught exactly like one sitting inside a paragraph.
 *
 *   node scripts/lint/check-banned-phrases.mjs                  # full scoped sweep
 *   node scripts/lint/check-banned-phrases.mjs docs/adr/0054.md  # explicit files
 *
 * Explicit file arguments still pass through the exclude list (so a fixture
 * living under tests/fixtures/ can exercise the exclusion behaviour directly)
 * but skip the include-glob filter, since a fixture path need not itself match
 * one of the "paths" globs to be worth checking on demand.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join, isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const CONFIG_PATH = join(HERE, 'banned-phrases.json')

export function loadConfig(path = CONFIG_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(raw.phrases) || raw.phrases.length === 0) {
    throw new Error('banned-phrases.json: "phrases" must be a non-empty array')
  }
  return {
    phrases: raw.phrases,
    paths: Array.isArray(raw.paths) ? raw.paths : [],
    exclude: Array.isArray(raw.exclude) ? raw.exclude : [],
  }
}

// Minimal glob → RegExp compiler. Supports the subset this config actually
// uses: `**` (any depth, including zero segments), `*` (anything but `/`),
// and `{a,b,c}` brace alternation. No dependency on the `glob` package on
// purpose — this gate must run with nothing but stdlib Node.
export function globToRegExp(glob) {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero-or-more path segments; bare `**` matches anything.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end === -1) {
        out += '\\{'
      } else {
        const alts = glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        out += `(?:${alts.join('|')})`
        i = end
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  return new RegExp(`^${out}$`)
}

export function matchesAny(relPath, globs) {
  return globs.some((g) => globToRegExp(g).test(relPath))
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

export function resolveTargets(config, explicitFiles) {
  const files = explicitFiles.length > 0 ? explicitFiles : trackedFiles()
  return files.filter((f) => {
    if (matchesAny(f, config.exclude)) return false
    if (explicitFiles.length > 0) return true // explicit files skip the include filter
    return matchesAny(f, config.paths)
  })
}

/** Scan one file's text for every configured phrase, case-insensitively. */
export function findHits(text, phrases) {
  const hits = []
  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]
    const lower = line.toLowerCase()
    for (const phrase of phrases) {
      const needle = phrase.toLowerCase()
      let from = 0
      let idx
      while ((idx = lower.indexOf(needle, from)) !== -1) {
        hits.push({ line: lineNo + 1, phrase })
        from = idx + needle.length
      }
    }
  }
  return hits
}

function main() {
  const explicitFiles = process.argv.slice(2)
  const config = loadConfig()
  const targets = resolveTargets(config, explicitFiles)

  let hitCount = 0
  for (const target of targets) {
    const abs = isAbsolute(target) ? target : join(REPO, target)
    const rel = isAbsolute(target) ? relative(REPO, abs) || target : target
    if (!existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8')
    for (const hit of findHits(text, config.phrases)) {
      console.error(`${rel}:${hit.line}:${hit.phrase}`)
      hitCount++
    }
  }

  if (hitCount > 0) {
    console.error(`\n✗ ${hitCount} banned-phrase hit(s) across ${targets.length} scanned file(s).`)
    process.exit(1)
  }
  console.log(`✓ banned-phrases: 0 hits across ${targets.length} scanned file(s).`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
