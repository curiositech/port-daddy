import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import program from './harborResearchProgram.json'
import { RESEARCH_PAPERS } from './researchPapers'
import { TEXTBOOK } from './whitePapers'

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = resolve(websiteRoot, '..')

/**
 * The /research page renders `harborResearchProgram.json`, a byte-identical
 * mirror of `docs/harbor-research/program.json`, which
 * `scripts/harbor-research/check_research_program.py` derives from the
 * library index, the corpus manifest, and the critique ledger and checks
 * against the repository. This test is the website's half of that contract:
 * if the program changes and the mirror does not, the site build goes red
 * here, and the library-checks workflow goes red on the docs side.
 */
describe('harbor research program mirror', () => {
  test('the site mirror is byte-identical to the source of record', () => {
    const sourcePath = resolve(repoRoot, 'docs/harbor-research/program.json')
    if (!existsSync(sourcePath)) return // website-only checkout (Pages build); the docs-side check covers it
    const source = readFileSync(sourcePath, 'utf8')
    const mirror = readFileSync(resolve(websiteRoot, 'src/data/harborResearchProgram.json'), 'utf8')
    expect(mirror).toBe(source)
  })

  test('every paper in the program has a card on the site, and no card is orphaned', () => {
    const programIds = program.papers.map((paper) => paper.siteId).sort()
    const siteIds = RESEARCH_PAPERS.map((paper) => paper.id).sort()
    expect(siteIds).toEqual(programIds)
    for (const paper of program.papers) {
      const card = RESEARCH_PAPERS.find((candidate) => candidate.id === paper.siteId)
      expect(card?.number, paper.siteId).toBe(String(paper.number))
    }
  })

  test('every site card that cites a prior-art dive cites one the program lists', () => {
    const dives = new Set(program.deepDives.map((dive) => dive.dir))
    for (const paper of RESEARCH_PAPERS) {
      if (!paper.priorArtDive) continue
      const dir = paper.priorArtDive.findingsPath.split('/')[0]
      expect(dives.has(dir), `${paper.id} cites ${dir}`).toBe(true)
      const dive = program.deepDives.find((candidate) => candidate.dir === dir)
      expect(dive?.verdict, `${paper.id} verdict`).toBe(paper.priorArtDive.verdict)
      expect(dive?.paper, `${paper.id} paper number`).toBe(Number(paper.number))
    }
  })

  test('every result tag on a site card is an executed result in the program', () => {
    const results = new Set(program.results.map((result) => result.id))
    for (const paper of RESEARCH_PAPERS) {
      for (const tag of paper.resultTags) {
        expect(results.has(tag), `${paper.id} tags ${tag}`).toBe(true)
      }
    }
  })

  test('every chapter the program cites exists in textbook.json', () => {
    const chapters = new Set(TEXTBOOK.chapters.map((chapter) => chapter.number))
    const cited = [
      ...program.results.flatMap((result) => result.chapters),
      ...program.openProblems.flatMap((problem) => problem.chapters),
      ...program.plannedLifts.flatMap((lift) => lift.chapters),
      ...program.studies.flatMap((study) => study.chapters),
    ]
    for (const chapter of cited) expect(chapters.has(chapter), `chapter ${chapter}`).toBe(true)
  })

  test('the derived sections are populated, not the empty seeds', () => {
    expect(program.results.length).toBeGreaterThanOrEqual(17)
    expect(program.estate.formalArtifacts).toBeGreaterThan(0)
    expect(program.critiqueLedger.total).toBeGreaterThan(0)
    expect(program.openProblems.length).toBeGreaterThanOrEqual(5)
  })
})
