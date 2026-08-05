import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { ALL_CATEGORIES, MCP_DEFAULT_TOOL_TOTAL, MCP_TOOL_TOTAL } from './mcp'
import { CLI_REFERENCE_GROUPS, SDK_REFERENCE_GROUPS, cliCommandHref } from './referenceCatalog'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('reference catalog source coverage', () => {
  test('CLI catalog includes recent operator surfaces', () => {
    const names = CLI_REFERENCE_GROUPS.flatMap((group) => group.items.map((item) => item.name))

    expect(names).toContain('pd add [path...]')
    expect(names).toContain('pd bench [iterations]')
    expect(names).toContain('pd batten verify|imprint')
    expect(names).toContain('pd tube <channel>')
    expect(names).toContain('pd guard <command>')
    expect(names).toContain('pd actor <id>')
    expect(names).toContain('pd wallet <command>')
    expect(names).toContain('pd roadmap')
    expect(names).toContain('pd pheromone <command>')
  })

  test('every CLI catalog row resolves to a detail page', () => {
    const overview = readRepoFile('website-v2/src/pages/docs/CliOverview.tsx')
    const rows = CLI_REFERENCE_GROUPS.flatMap((group) => group.items)

    expect(overview).not.toContain(['listed', 'here'].join(' '))

    for (const command of rows) {
      const href = cliCommandHref(command)
      expect(href).toMatch(/^\/docs\/cli\/[a-z0-9-]+$/)
      expect(href).not.toContain('#')
    }
  })

  test('main CLI dispatch verbs are represented by catalog commands or aliases', () => {
    const cliSource = readRepoFile('bin/port-daddy-cli.ts')
    const mainSwitchStart = cliSource.indexOf('switch (command)')
    const mainSwitchEnd = cliSource.indexOf('default: {', mainSwitchStart)
    const mainSwitch = cliSource.slice(mainSwitchStart, mainSwitchEnd)
    const dispatchVerbs = Array.from(mainSwitch.matchAll(/^ {6}case '([^']+)':/gm), (match) => match[1])

    const catalogVerbs = new Set(
      CLI_REFERENCE_GROUPS.flatMap((group) =>
        group.items.flatMap((item) => [item.name, ...(item.aliases ?? [])]),
      ).map((name) => name.replace(/^pd\s+/, '').split(/\s+/)[0]),
    )

    expect(dispatchVerbs.filter((verb) => !catalogVerbs.has(verb))).toEqual([])
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
