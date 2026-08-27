/**
 * Tutorial data consistency tests.
 *
 * These catch the class of bugs introduced in c1fbbc9:
 *   - tutorials.ts reordered but individual pages kept stale number/total
 *   - TutorialProgress.tsx duplicated tutorials.ts with no enforcement
 *   - Orphaned tutorial files not listed in tutorials.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, basename } from 'path'
import { TUTORIALS } from './tutorials'

const TUTORIALS_DIR = resolve(__dirname, '../pages/tutorials')

const FILE_TO_SLUG: Record<string, string> = {
  'GettingStarted.tsx': 'getting-started',
  'SemanticIdentities.tsx': 'semantic-identities',
  'MultiAgentOrchestration.tsx': 'multi-agent',
  'Monorepo.tsx': 'monorepo',
  'Debugging.tsx': 'debugging',
  'Tunnel.tsx': 'tunnel',
  'DNSResolver.tsx': 'dns',
  'SessionPhases.tsx': 'session-phases',
  'Inbox.tsx': 'inbox',
  'Sugar.tsx': 'sugar',
  'AlwaysOn.tsx': 'always-on',
  'Spawn.tsx': 'pd-spawn',
  'Harbors.tsx': 'harbors',
  'TimeTravel.tsx': 'time-travel',
  'Pipelines.tsx': 'pipelines',
  'Watch.tsx': 'watch',
  'RemoteHarbors.tsx': 'remote-harbors',
  'Fleet.tsx': 'fleet',
  'Pheromone.tsx': 'pheromone',
  'Primitives.tsx': 'primitives',
  'PdTube.tsx': 'pd-tube',
  'DoctrineCycle.tsx': 'doctrine-cycle',
}

function tutorialForFile(file: string) {
  const slug = FILE_TO_SLUG[basename(file)]
  return slug ? TUTORIALS.find(t => t.slug === slug) : undefined
}

// Extract number={N} and total={N} from a tutorial TSX file
function extractProps(filePath: string): { number: number | null; total: number | null } {
  const src = readFileSync(filePath, 'utf-8')
  const numMatch = src.match(/number=\{(\d+)\}/)
  const totalMatch = src.match(/total=\{(\d+)\}/)
  return {
    number: numMatch ? parseInt(numMatch[1], 10) : null,
    total: totalMatch ? parseInt(totalMatch[1], 10) : null,
  }
}

// Get all .tsx tutorial page files (excluding index.ts)
function getTutorialFiles(): string[] {
  return readdirSync(TUTORIALS_DIR)
    .filter(f => f.endsWith('.tsx'))
    .map(f => resolve(TUTORIALS_DIR, f))
}

describe('tutorials.ts data integrity', () => {
  it('has no duplicate slugs', () => {
    const slugs = TUTORIALS.map(t => t.slug)
    expect(slugs).toEqual([...new Set(slugs)])
  })

  it('has no duplicate numbers', () => {
    const numbers = TUTORIALS.map(t => t.number)
    expect(numbers).toEqual([...new Set(numbers)])
  })

  it('numbers are sequential starting from 01', () => {
    TUTORIALS.forEach((t, i) => {
      const expected = String(i + 1).padStart(2, '0')
      expect(t.number).toBe(expected)
    })
  })

  it('all hrefs start with /tutorials/', () => {
    TUTORIALS.forEach(t => {
      expect(t.href).toMatch(/^\/tutorials\//)
    })
  })

  it('slug matches href path', () => {
    TUTORIALS.forEach(t => {
      expect(t.href).toBe(`/tutorials/${t.slug}`)
    })
  })
})

describe('TutorialProgress.tsx stays in sync with tutorials.ts', () => {
  const progressSource = readFileSync(
    resolve(__dirname, '../components/tutorials/TutorialProgress.tsx'),
    'utf-8'
  )

  it('derives its roadmap from tutorials.ts instead of duplicating tutorial rows', () => {
    expect(progressSource).toContain("TUTORIALS as CANONICAL_TUTORIALS")
    expect(progressSource).toContain('CANONICAL_TUTORIALS.map')
    expect(progressSource).not.toMatch(/const TUTORIALS:\s*Tutorial\[\]\s*=\s*\[/)
  })
})

describe('tutorials index brand voice', () => {
  const pageSource = readFileSync(
    resolve(__dirname, '../pages/TutorialsPage.tsx'),
    'utf-8'
  )

  it('uses the current control-plane positioning instead of retired academy metaphors', () => {
    expect(pageSource).toContain('Operator training')
    expect(pageSource).toContain('Learn the control plane like an operator.')
    expect(pageSource).toContain('Product-truth curriculum')
    expect(pageSource).toContain('engineers evaluating real coding-agent infrastructure')
    expect(pageSource).not.toContain('Academy of Coordination')
    expect(pageSource).not.toContain('Master the')
    expect(pageSource).not.toContain('Swarm Logic')
    expect(pageSource).not.toContain("import { Surface }")
    expect(pageSource).not.toContain('Anchor')
    expect(pageSource).not.toContain('shadow-inset')
  })

  it('keeps visible tutorial catalogue copy in one brand language', () => {
    const visibleCopy = TUTORIALS
      .flatMap(tutorial => [tutorial.title, tutorial.description, ...tutorial.tags])
      .join(' ')
    const normalizedCopy = visibleCopy.toLowerCase()

    expect(normalizedCopy).toContain('agent')
    expect(normalizedCopy).toContain('harbor')
    expect(normalizedCopy).toContain('control plane')
    expect(visibleCopy).not.toMatch(/\b[Ss]warm\b/)
    expect(visibleCopy).not.toContain('Pheromone Trails')
    expect(visibleCopy).not.toContain('Harbor Tokens')
    expect(visibleCopy).not.toContain('Multiplayer Localhost')
    expect(visibleCopy).not.toContain('Spawn + Watch Pattern')
  })

  it('renders every canonical tutorial slug without maintaining a separate icon map', () => {
    const src = readFileSync(
      resolve(__dirname, '../pages/TutorialsPage.tsx'),
      'utf-8'
    )

    expect(src).toContain('TUTORIALS_DATA.map')
    expect(src).not.toContain('const ICON_MAP')
  })
})

describe('individual tutorial pages have correct number and total', () => {
  const totalExpected = TUTORIALS.length

  // Build slug -> expected number map
  const slugToNumber = new Map<string, number>()
  TUTORIALS.forEach((t, i) => {
    slugToNumber.set(t.slug, i + 1)
  })

  const tutorialFiles = getTutorialFiles()

  it('every tutorial file has total={N} matching tutorials.ts length', () => {
    const failures: string[] = []
    for (const file of tutorialFiles) {
      const { total } = extractProps(file)
      if (total !== null && total !== totalExpected) {
        failures.push(`${basename(file)}: total={${total}}, expected total={${totalExpected}}`)
      }
    }
    expect(failures).toEqual([])
  })

  for (const [fileName, slug] of Object.entries(FILE_TO_SLUG)) {
    it(`${fileName} number matches tutorials.ts canonical ordering`, () => {
      const filePath = resolve(TUTORIALS_DIR, fileName)
      const { number } = extractProps(filePath)
      expect(number).not.toBeNull()

      const expectedNumber = slugToNumber.get(slug)
      expect(expectedNumber).toBeDefined()
      expect(number).toBe(expectedNumber)
    })
  }
})

describe('prev/next navigation chain is consistent', () => {
  // Extract prev and next props from each tutorial TSX file
  function extractNavLinks(filePath: string): {
    prev: { title: string; href: string } | null
    next: { title: string; href: string } | null
  } {
    const src = readFileSync(filePath, 'utf-8')
    const prevMatch = src.match(/prev=\{\{\s*title:\s*'([^']+)',\s*href:\s*'([^']+)'\s*\}\}/)
    const nextMatch = src.match(/next=\{\{\s*title:\s*'([^']+)',\s*href:\s*'([^']+)'\s*\}\}/)
    return {
      prev: prevMatch ? { title: prevMatch[1], href: prevMatch[2] } : null,
      next: nextMatch ? { title: nextMatch[1], href: nextMatch[2] } : null,
    }
  }

  const tutorialFiles = getTutorialFiles()
  const knownHrefs = new Set(TUTORIALS.map(t => t.href))

  it('all prev/next hrefs point to tutorials that exist in tutorials.ts', () => {
    const broken: string[] = []
    for (const file of tutorialFiles) {
      const { prev, next } = extractNavLinks(file)
      if (prev && !knownHrefs.has(prev.href)) {
        broken.push(`${basename(file)} prev -> ${prev.href} (not in tutorials.ts)`)
      }
      if (next && !knownHrefs.has(next.href)) {
        broken.push(`${basename(file)} next -> ${next.href} (not in tutorials.ts)`)
      }
    }
    expect(broken).toEqual([])
  })

  it('prev/next links are symmetric — if A.next=B then B.prev=A', () => {
    // Build href -> nav map
    const navMap = new Map<string, { prev: string | null; next: string | null; file: string }>()
    for (const file of tutorialFiles) {
      const { prev, next } = extractNavLinks(file)
      const tutorial = tutorialForFile(file)
      if (tutorial) {
        navMap.set(tutorial.href, {
          prev: prev?.href ?? null,
          next: next?.href ?? null,
          file: basename(file),
        })
      }
    }

    const asymmetric: string[] = []
    for (const [href, nav] of navMap) {
      if (nav.next) {
        const target = navMap.get(nav.next)
        if (target && target.prev !== href) {
          asymmetric.push(
            `${nav.file}.next=${nav.next}, but ${target.file}.prev=${target.prev ?? 'null'} (expected ${href})`
          )
        }
      }
    }
    expect(asymmetric).toEqual([])
  })

  it('no forward chain loops — following next links from tutorial 01 never revisits a page', () => {
    // Build href -> next href map from tutorial files
    const nextMap = new Map<string, string>()
    for (const file of tutorialFiles) {
      const { next } = extractNavLinks(file)
      const tutorial = tutorialForFile(file)
      if (tutorial && next) {
        nextMap.set(tutorial.href, next.href)
      }
    }

    // Walk from tutorial 01
    const visited = new Set<string>()
    let current: string | undefined = TUTORIALS[0]?.href
    const loops: string[] = []

    while (current) {
      if (visited.has(current)) {
        loops.push(`Loop detected: revisited ${current}`)
        break
      }
      visited.add(current)
      current = nextMap.get(current)
    }
    expect(loops).toEqual([])
  })

  it('every total={N} prop is present and equals tutorials.ts length', () => {
    const missing: string[] = []
    for (const file of tutorialFiles) {
      const { total } = extractProps(file)
      if (total === null) {
        missing.push(`${basename(file)}: missing total= prop`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('number prop type consistency', () => {
  // Tunnel.tsx uses number="05" (string prop) while all others use number={N} (numeric).
  // String props cause type mismatches in TutorialLayout if it expects a number.
  it('all tutorial files use numeric number={N} props, not string number="N"', () => {
    const stringNumberFiles: string[] = []
    for (const file of getTutorialFiles()) {
      const src = readFileSync(file, 'utf-8')
      // Match number="..." (string prop) as opposed to number={...} (expression)
      if (/\bnumber="[^"]*"/.test(src)) {
        stringNumberFiles.push(basename(file))
      }
    }
    expect(stringNumberFiles).toEqual([])
  })
})

describe('TutorialProgress title consistency', () => {
  it('TutorialProgress does not hardcode titles that can drift from tutorials.ts', () => {
    const progressSource = readFileSync(
      resolve(__dirname, '../components/tutorials/TutorialProgress.tsx'),
      'utf-8'
    )
    for (const tutorial of TUTORIALS) {
      expect(progressSource).not.toContain(`title: '${tutorial.title}'`)
    }
  })
})

describe('no orphaned tutorial files', () => {
  it('every exported tutorial component routes to a tutorials.ts entry', () => {
    const indexSrc = readFileSync(resolve(TUTORIALS_DIR, 'index.ts'), 'utf-8')
    const exportedComponents = [...indexSrc.matchAll(/export \{ (\w+) \}/g)].map(m => m[1])

    // For each exported component, read its file and check its route exists in tutorials.ts
    const orphaned: string[] = []
    for (const component of exportedComponents) {
      const filePath = resolve(TUTORIALS_DIR, `${component}.tsx`)
      let src: string
      try {
        src = readFileSync(filePath, 'utf-8')
      } catch {
        continue // File doesn't exist; separate issue
      }

      // Check if this component's content references any known tutorial href
      const referencesKnownTutorial = TUTORIALS.some(t =>
        src.includes(`title="${t.title}"`) || src.includes(`title='${t.title}'`)
      )

      // Also check if any tutorials.ts slug maps to this filename
      const nameLower = component.toLowerCase()
      const hasMatchingSlug = TUTORIALS.some(t => {
        // Normalize: "DNSResolver" -> "dnsresolver", slug "dns"
        // "GettingStarted" -> "gettingstarted", slug "getting-started"
        // "Spawn" -> "spawn", slug "pd-spawn" (slug contains filename)
        const slugNormalized = t.slug.replace(/-/g, '')
        return (
          nameLower === slugNormalized ||
          nameLower.includes(slugNormalized) ||
          slugNormalized.includes(nameLower)
        )
      })

      if (!referencesKnownTutorial && !hasMatchingSlug) {
        orphaned.push(component)
      }
    }

    expect(orphaned).toEqual([])
  })
})
