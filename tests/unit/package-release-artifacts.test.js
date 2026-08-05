import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import childProcess from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  packageReleaseArtifacts,
  releaseArchivePaths,
} from '../../scripts/package-release-artifacts.mjs'

const { spawnSync } = childProcess

const DURABLE_SCRATCH = join(homedir(), 'coding', 'tmp')
mkdirSync(DURABLE_SCRATCH, { recursive: true })

describe('manifest-derived release packaging', () => {
  let root
  let staged
  let manifestPath

  beforeEach(() => {
    root = mkdtempSync(join(DURABLE_SCRATCH, 'pd-package-release-'))
    staged = join(root, 'dist')
    mkdirSync(join(staged, 'bin'), { recursive: true })
    writeFileSync(join(staged, 'pd'), 'binary')
    writeFileSync(join(staged, 'bin', 'hook'), 'hook')
    manifestPath = join(root, 'release-artifacts.json')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test('passes only declared present paths to tar and omits absent optional cargo', () => {
    const manifest = {
      artifacts: [
        { id: 'pd', stagedPath: 'pd', required: true },
        { id: 'hook', stagedPath: 'bin/hook', required: true },
        { id: 'native', stagedPath: 'native', type: 'dir', required: false },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const calls = []
    const result = packageReleaseArtifacts({
      manifestPath,
      stagedDir: staged,
      outPath: join(staged, 'pd-test.tar.gz'),
      run: (command, args, options) => {
        calls.push({ command, args, options })
        return { status: 0 }
      },
    })

    expect(result.paths).toEqual(['pd', 'bin/hook'])
    expect(calls[0].command).toBe('tar')
    expect(calls[0].args.slice(-3)).toEqual(['--', 'pd', 'bin/hook'])
    expect(calls[0].args).not.toContain('native')
    expect(calls[0].options.shell).toBe(false)
  })

  test('creates a readable archive containing exactly the manifest-selected cargo', () => {
    const manifest = {
      artifacts: [
        { id: 'pd', stagedPath: 'pd', required: true },
        { id: 'hook', stagedPath: 'bin/hook', required: true },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const outPath = join(root, 'pd-test.tar.gz')
    packageReleaseArtifacts({ manifestPath, stagedDir: staged, outPath })

    const listed = spawnSync('tar', ['-tzf', outPath], { encoding: 'utf8', shell: false })
    expect(listed.status).toBe(0)
    expect(listed.stdout.trim().split('\n')).toEqual(['pd', 'bin/hook'])
  })

  test('recursively packages declared skill and Pilot resource directories', () => {
    mkdirSync(join(staged, 'skills', 'port-daddy-agent-skill'), { recursive: true })
    mkdirSync(join(staged, 'agents', 'port-daddy-pilot'), { recursive: true })
    writeFileSync(join(staged, 'skills', 'port-daddy-agent-skill', 'SKILL.md'), 'name: port-daddy-agent-skill\n')
    writeFileSync(join(staged, 'agents', 'port-daddy-pilot', 'AGENT.md'), '# Port Daddy Pilot\n')
    const manifest = {
      artifacts: [
        { id: 'skill', stagedPath: 'skills/port-daddy-agent-skill', type: 'dir', required: true },
        { id: 'pilot', stagedPath: 'agents/port-daddy-pilot', type: 'dir', required: true },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const outPath = join(root, 'pd-resources.tar.gz')
    packageReleaseArtifacts({ manifestPath, stagedDir: staged, outPath })

    const listed = spawnSync('tar', ['-tzf', outPath], { encoding: 'utf8', shell: false })
    expect(listed.status).toBe(0)
    expect(listed.stdout).toContain('skills/port-daddy-agent-skill/SKILL.md')
    expect(listed.stdout).toContain('agents/port-daddy-pilot/AGENT.md')
  })

  test('fails before tar for absent required or path-traversing cargo', () => {
    expect(() => releaseArchivePaths({ artifacts: [{ stagedPath: 'missing', required: true }] }, staged))
      .toThrow(/required release artifact is absent/)
    expect(() => releaseArchivePaths({ artifacts: [{ stagedPath: '../secret', required: false }] }, staged))
      .toThrow(/unsafe stagedPath/)
    expect(() => releaseArchivePaths({ artifacts: [{ stagedPath: '.', required: true }] }, staged))
      .toThrow(/unsafe stagedPath/)
    expect(() => releaseArchivePaths({ artifacts: [
      { stagedPath: 'pd', required: true },
      { stagedPath: 'pd', required: true },
    ] }, staged)).toThrow(/duplicate stagedPath/)
  })
})
