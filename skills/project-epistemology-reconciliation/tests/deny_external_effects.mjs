import childProcess from 'node:child_process'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { syncBuiltinESMExports } from 'node:module'

const blocked = (effect) => () => {
  throw new Error(`OFFLINE_HARNESS_BLOCKED:${effect}`)
}

export function installExternalEffectGuards() {
  globalThis.fetch = blocked('fetch')
  for (const name of ['exec', 'execFile', 'fork', 'spawn']) childProcess[name] = blocked(`child_process.${name}`)
  for (const name of ['execFileSync', 'execSync', 'spawnSync']) childProcess[name] = blocked(`child_process.${name}`)
  for (const module of [http, https]) {
    module.get = blocked('http.get')
    module.request = blocked('http.request')
  }
  net.connect = blocked('net.connect')
  net.createConnection = blocked('net.createConnection')
  tls.connect = blocked('tls.connect')
  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) dns[name] = blocked(`dns.${name}`)
  syncBuiltinESMExports()
  process.env.NO_PROXY = '*'
  process.env.no_proxy = '*'
  process.env.HF_HUB_OFFLINE = '1'
  process.env.TRANSFORMERS_OFFLINE = '1'
}
