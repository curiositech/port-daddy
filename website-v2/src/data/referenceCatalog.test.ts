import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { ALL_CATEGORIES, MCP_DEFAULT_TOOL_TOTAL, MCP_TOOL_TOTAL } from './mcp'
import { CLI_REFERENCE_GROUPS, SDK_REFERENCE_GROUPS } from './referenceCatalog'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('reference catalog source coverage', () => {
  test('CLI catalog includes recent operator surfaces', () => {
    const names = CLI_REFERENCE_GROUPS.flatMap((group) => group.items.map((item) => item.name))

    expect(names).toContain('pd tube <channel>')
    expect(names).toContain('pd guard <command>')
    expect(names).toContain('pd actor <id>')
    expect(names).toContain('pd wallet <command>')
    expect(names).toContain('pd roadmap')
    expect(names).toContain('pd pheromone <command>')
  })

  test('SDK catalog matches every public PortDaddy instance method', () => {
    const clientSource = readRepoFile('lib/client.ts')
    const classBody = clientSource.slice(clientSource.indexOf('class PortDaddy'))
    const actualMethods = Array.from(
      classBody.matchAll(/^ {2}(async )?([A-Za-z_][A-Za-z0-9_]*)\(/gm),
      (match) => match[2],
    ).filter((name) => name !== 'constructor' && !name.startsWith('_'))

    const catalogMethods = SDK_REFERENCE_GROUPS.flatMap((group) => group.items.map((item) => item.name))
      .filter((name) => name !== 'new PortDaddy(options)')

    expect([...catalogMethods].sort()).toEqual([...actualMethods].sort())
  })

  test('MCP catalog totals match the server-backed tool set', () => {
    const uniqueTools = new Set(ALL_CATEGORIES.flatMap((category) => category.tools))
    const serverSource = readRepoFile('mcp/server.ts')
    const essentialBlock = serverSource.match(/const ESSENTIAL_TOOL_NAMES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? ''
    const essentialTools = Array.from(essentialBlock.matchAll(/'([^']+)'/g), (match) => match[1])

    expect(uniqueTools.size).toBe(MCP_TOOL_TOTAL)
    expect(new Set([...essentialTools, 'pd_discover']).size).toBe(MCP_DEFAULT_TOOL_TOTAL)
  })
})
