import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { TEXTBOOK } from '@/data/whitePapers'
import { chapterPlate, partPlate } from './index'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public')

/**
 * The library outline shows the Book's own plate beside every part and
 * every chapter, and derives the file name from textbook.json. If a part
 * or chapter is added without its plate, the page would render a broken
 * image; this test turns that into a build failure instead.
 */
describe('library outline plates', () => {
  test('every part in textbook.json has a plate file', () => {
    for (const part of TEXTBOOK.parts) {
      expect(existsSync(resolve(publicDir, `.${partPlate(part.numeral)}`)), `part ${part.numeral}`).toBe(true)
    }
  })

  test('every chapter in textbook.json has a plate file', () => {
    for (const chapter of TEXTBOOK.chapters) {
      expect(existsSync(resolve(publicDir, `.${chapterPlate(chapter.prefix)}`)), `chapter ${chapter.prefix}`).toBe(true)
    }
  })
})
