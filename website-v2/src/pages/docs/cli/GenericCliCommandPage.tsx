import { Navigate, useParams } from 'react-router-dom'
import { CommandPage } from '@/components/docs/CommandPage'
import {
  CLI_REFERENCE_ITEMS,
  PORT_DADDY_VERSION,
  cliCommandHref,
  findCliReferenceItemBySlug,
} from '@/data/referenceCatalog'

const FLAG_DESCRIPTIONS: Record<string, string> = {
  '--active': 'Filter output to currently active records.',
  '--agent': 'Target or stamp a specific agent id.',
  '--all': 'Include all available rows instead of the default active subset.',
  '--all-worktrees': 'Include active sessions from every known worktree.',
  '--allowedTools': 'Restrict the spawned backend to the allowed tool list.',
  '--actor': 'Restrict VoiceLog events to one agent identity.',
  '--as': 'Write the tuple or signal as a specific agent identity.',
  '--backend': 'Choose the launch backend for spawned work.',
  '--branch': 'Bind scan or orchestration behavior to a branch name.',
  '--budget': 'Require an explicit budget ceiling before launching agent work.',
  '--channels': 'Include channel discovery and subscription context in advisory output.',
  '--dir': 'Resolve project-scoped behavior from this working directory.',
  '--dry-run': 'Show the operation that would happen without mutating state.',
  '--event': 'Restrict VoiceLog rows to one hook event class.',
  '--exec': 'Run the given command for each matching event.',
  '--expires': 'Set an expiration for the claim or coordination record.',
  '--export': 'Print shell export output for successful claims.',
  '--files': 'Attach file paths to the session or launch request.',
  '--follow': 'Keep reading new VoiceLog events until interrupted.',
  '--force': 'Bypass the normal safety guard for this command.',
  '--harbor': 'Run the operation inside a named harbor permission namespace.',
  '--identity': 'Use this semantic identity for an agent, session, service, or launch.',
  '--interval': 'Set the VoiceLog follow polling interval in milliseconds.',
  '--json': 'Return machine-readable JSON instead of the human display.',
  '--limit': 'Cap the number of returned rows.',
  '--message': 'Use the provided text as the message body.',
  '--mode': 'Select advisory or enforcement behavior.',
  '--model': 'Choose the model used by the selected backend.',
  '--no-daemon': 'Skip daemon installation or startup during setup.',
  '--no-fleetbar': 'Skip FleetBar installation during setup.',
  '--no-health': 'Do not wait for service health after startup.',
  '--no-history': 'Suppress historical messages before listening for new ones.',
  '--no-hook': 'Skip managed git hook installation.',
  '--no-init': 'Skip project initialization during setup.',
  '--no-mcp': 'Skip MCP client installation during setup.',
  '--observed': 'Include observed channel traffic in discovery output.',
  '--once': 'Exit after the first matching message or event.',
  '--owner': 'Stamp a lock with a specific owner.',
  '--path': 'Read VoiceLog events from an explicit local file path.',
  '--port': 'Request or target a specific daemon or service port.',
  '--project': 'Resolve or filter the command to a specific project.',
  '--provider': 'Choose the tunnel provider.',
  '--purpose': 'Attach a human-readable reason to the session or launch.',
  '--quiet': 'Suppress decorative output and print only the essential result.',
  '--range': 'Restrict port selection to the provided numeric range.',
  '--raw-channel': 'Use the channel string literally instead of project scoping it.',
  '--reply': 'Send the tube message as a reply to an existing message id.',
  '--scope': 'Limit channel discovery to the requested scope.',
  '--send': 'Send one tube message and return.',
  '--sender': 'Stamp the message with an explicit sender id.',
  '--session': 'Target a specific session id.',
  '--since': 'Read VoiceLog events after a duration, epoch millisecond, or ISO timestamp.',
  '--staged': 'Check only staged files.',
  '--status': 'Filter rows by lifecycle status.',
  '--stats': 'Summarize spoke, silent, and suppressed VoiceLog outcomes.',
  '--suppressed': 'Show only VoiceLog turns whose candidate context was filtered, dropped, or clipped, with the recorded reason.',
  '--task': 'Describe the intended edit or action for advisor output.',
  '--tier': 'Use a low, mid, or high model ladder entry for the backend.',
  '--timeout': 'Set the wait or launch timeout.',
  '--ttl': 'Set time-to-live for locks, tuples, or transient records.',
  '--tuples': 'Include tuple-space context in advisory output.',
  '--type': 'Stamp the session or note with a typed category.',
  '--unread': 'Restrict inbox output to unread messages.',
  '--wait': 'Wait for a lock or resource instead of failing immediately.',
  '-A': 'Stage all tracked and untracked paths, filtered through Port Daddy ownership checks.',
  cleanup: 'Remove stale port records.',
  clear: 'Delete matching channel state.',
  describe: 'Print a single channel, signal, or resource description.',
  discover: 'Discover declared and observed channels.',
  ensure: 'Create or update the channel declaration.',
  install: 'Install the local integration or guard.',
  iterations: 'Number of benchmark iterations to run.',
  list: 'List records for this command family.',
  needs: 'Publish a dependency or missing-readiness signal.',
  ready: 'Publish a readiness signal.',
  status: 'Print the current status for this command family.',
}

const DIRECT_CAPABLE = new Set([
  'claim',
  'release',
  'find',
  'url',
  'env',
  'ports',
  'session',
  'sessions',
  'note',
  'notes',
  'begin',
  'done',
  'whoami',
  'lock',
  'unlock',
  'locks',
  'with-lock',
  'who-owns',
  'add',
])

function firstCommandVerb(command: string): string {
  return command.replace(/^pd\s+/, '').split(/\s+/)[0] ?? command
}

function describeFlag(flag: string): string {
  return FLAG_DESCRIPTIONS[flag] ?? `${flag} is accepted by this command family; see the handler source for command-specific validation and side effects.`
}

function exampleCommand(command: string): string {
  return command
    .replace(/complete\|abandon\|dismiss/g, 'complete')
    .replace(/heartbeat\|unregister\|inbox\|<id>/g, 'heartbeat')
    .replace(/list\|status\|logs/g, 'status')
    .replace(/panic\|unpanic/g, 'panic')
    .replace(/init\|up\|down\|status\|validate\|run/g, 'status')
    .replace(/create\|enter\|leave\|show\|destroy/g, 'show')
    .replace(/"purpose"/g, '"coordinate CLI reference update"')
    .replace(/"summary"/g, '"CLI reference detail pages are linked"')
    .replace(/"task"/g, '"audit CLI docs coverage"')
    .replace(/<agent>/g, 'agent-1234')
    .replace(/<channel>/g, 'coordination:inconsistency')
    .replace(/<command>/g, 'status')
    .replace(/<content>/g, '"Scope: CLI docs detail coverage"')
    .replace(/<goal>/g, '"ship docs coverage"')
    .replace(/<id>/g, 'myapp:web')
    .replace(/<identity>/g, 'myapp:web')
    .replace(/<message>/g, '"ready"')
    .replace(/<name>/g, 'deploy-window')
    .replace(/<path>/g, 'src/app.ts')
    .replace(/\[dir\]/g, '.')
    .replace(/\[files\.\.\.\]/g, 'src/app.ts')
    .replace(/\[iterations\]/g, '25')
    .replace(/\[path\.\.\.\]/g, 'README.md')
    .replace(/\[pattern\]/g, 'myapp')
    .replace(/\[session-id\]/g, 'session-1234')
    .replace(/\[files\.\]/g, 'src/app.ts')
    .trim()
}

function expectedOutput(command: string, canonicalCommand: string): string {
  const verb = firstCommandVerb(canonicalCommand)
  if (verb === 'tube') return 'Prints recent channel history, then waits for or sends tube messages with ids and thread metadata.'
  if (verb === 'add') return 'Prints which paths were staged, skipped, or blocked by active Port Daddy file ownership.'
  if (verb === 'status' || verb === 'health') return 'Prints daemon reachability, version/provenance, and current runtime health.'
  if (verb === 'setup' || verb === 'init' || verb === 'install') return 'Prints each installation step and the next observable local file, daemon, or MCP client state.'
  if (DIRECT_CAPABLE.has(verb)) return 'Prints the changed record or lookup result; use --json when you need the exact machine-readable shape.'
  return `Runs the ${command} command family and prints the resulting Port Daddy state, ids, or readiness/error details.`
}

function runtimeFor(command: string): string {
  const verb = firstCommandVerb(command)
  if (DIRECT_CAPABLE.has(verb)) return 'Daemon client with direct-mode fallback where supported'
  if (verb === 'mcp') return 'stdio MCP server or MCP installer path'
  if (['start', 'stop', 'restart', 'install', 'uninstall', 'daemon', 'dev'].includes(verb)) return 'daemon lifecycle manager'
  return 'daemon-backed CLI command'
}

export default function GenericCliCommandPage() {
  const { commandSlug } = useParams()
  const command = commandSlug ? findCliReferenceItemBySlug(commandSlug) : undefined

  if (!command) {
    return <Navigate to="/docs/cli" replace />
  }

  const matchedAlias = command.aliasRoutes.find((alias) => alias.slug === commandSlug)
  const displayCommand = matchedAlias?.name ?? command.name
  const canonicalHref = cliCommandHref(command)
  const primaryExample = exampleCommand(displayCommand)
  const related = CLI_REFERENCE_ITEMS
    .filter((item) => item.groupTitle === command.groupTitle && item.name !== command.name)
    .slice(0, 5)
    .map((item) => ({ name: item.name, href: cliCommandHref(item) }))

  return (
    <CommandPage
      command={displayCommand}
      version={PORT_DADDY_VERSION}
      description={matchedAlias ? `${displayCommand} is an alias for ${command.name}. ${command.description}` : command.description}
      syntax={exampleCommand(displayCommand)}
      apiSpec={[
        { label: 'Canonical command', value: command.name },
        { label: 'Reference route', value: matchedAlias?.href ?? canonicalHref },
        { label: 'Reference group', value: command.groupTitle },
        { label: 'Runtime path', value: runtimeFor(command.name) },
        { label: 'Source', value: command.groupSource },
        { label: 'Aliases', value: command.aliasRoutes.length ? command.aliasRoutes.map((alias) => alias.name).join(', ') : 'none' },
        { label: 'Output mode', value: command.flags?.includes('--json') ? 'human display plus --json machine output' : 'human display with command-specific state changes' },
        { label: 'Page type', value: command.generated ? 'generated API spec from the source-backed catalog' : 'hand-authored route with catalog-backed fallback' },
      ]}
      usagePatterns={[
        `${displayCommand} belongs to ${command.groupTitle}. ${command.groupDescription}`,
        `${runtimeFor(command.name)}. Validate live behavior from the daemon and handler source when changing this command.`,
        matchedAlias
          ? `Use ${command.name} in automation when you want the canonical spelling; ${displayCommand} resolves to the same command contract.`
          : `Use this page as the stable public contract for ${command.name}; aliases resolve to the same contract.`,
      ]}
      flags={(command.flags ?? []).map((flag) => ({
        flag,
        description: describeFlag(flag),
      }))}
      examples={[
        {
          description: `Run ${displayCommand} from a coordinated checkout`,
          code: primaryExample,
          output: expectedOutput(displayCommand, command.name),
        },
        {
          description: 'Find this command from the full CLI reference',
          code: `pd help ${firstCommandVerb(command.name)}\nopen /docs/cli/${command.slug}`,
          output: `The help topic and docs route both describe ${command.name}, including aliases, flags, and source provenance.`,
        },
      ]}
      seeAlso={related}
    />
  )
}
