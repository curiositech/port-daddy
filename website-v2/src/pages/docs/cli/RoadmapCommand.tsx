import { CommandPage } from '@/components/docs/CommandPage'

export default function RoadmapCommand() {
  return (
    <CommandPage
      command="pd roadmap"
      description="Show Cartographer's live roadmap projection: curated Next Cuts, immediate ideas, tuple-backed operator feedback, and markdown dogfood harvests. Use ack when a live feedback item has been folded into roadmap truth."
      version="3.11.0"
      syntax="pd roadmap [flags]\npd roadmap ack <feedbackId> [--as <agentId>] [--into <roadmap-slug>]"
      flags={[
        { flag: '--dir <path>, --root <path>, --projectDir <path>', description: 'Read roadmap files for a specific project root instead of the current directory.' },
        { flag: '--feedback-status <status>', description: 'Filter live tuple feedback by open, harvested, wontfix, or all. Defaults to open.' },
        { flag: '--feedback-harbor <harbor>', description: 'Scope tuple feedback to a harbor such as port-daddy:fleet.' },
        { flag: '--feedback-limit <n>', description: 'Limit live feedback rows fetched from the daemon.' },
        { flag: '--as <agentId>', description: 'Harvester identity for ack/harvest. Defaults to operator-cli.' },
        { flag: '--into <roadmap-slug>', description: 'Roadmap or dogfood-feedback slug where the feedback was folded.' },
        { flag: '--no-excerpts', description: 'Hide CURRENT-WORK and Cartographer status excerpts.' },
        { flag: '--json, -j', description: 'Output the raw roadmap projection payload.' },
        { flag: '--quiet, -q', description: 'Print machine-readable section:slug rows for agent prompts.' },
      ]}
      usagePatterns={[
        'Run `pd roadmap --feedback-status open` before deciding the next Cartographer slice.',
        'Use `pd roadmap --json` when an agent needs the same live projection Fleet Control Center consumes.',
        'After promoting tuple feedback into DOGFOOD-FEEDBACK.md or ROADMAP.md, run `pd roadmap ack` so open feedback counts actually change.',
      ]}
      subcommands={[
        { name: 'pd roadmap ack <feedbackId>', description: 'Harvest live feedback through the tuple-backed feedback primitive', href: '/docs/cli/roadmap' },
        { name: 'pd roadmap harvest <feedbackId>', description: 'Alias for ack when Cartographer has folded feedback into roadmap truth', href: '/docs/cli/roadmap' },
      ]}
      examples={[
        {
          description: 'Read the live roadmap projection',
          code: 'pd roadmap --feedback-status open',
          output: `ROADMAP · 3 next cuts · 2 now · 4 live feedback · 5 curated · 0.3h old

NEXT CUTS
  cartographer-roadmap-progress-screen
    Surface roadmap state in the control plane.

LIVE FEEDBACK
  cartographer-live-body-salvage-friction [high/open]
    operator asks whether Cartographer can listen
    surface: CLI · by: agent-dfdc92f3 · id: fb-123456`
        },
        {
          description: 'Feed an agent the machine-readable projection',
          code: 'pd roadmap --quiet --feedback-status open',
          output: `next:cartographer-roadmap-progress-screen
now:tuple-backed-feedback-harvest
live:cartographer-live-body-salvage-friction
feedback:coordination-ticker-as-high-signal-feed`
        },
        {
          description: 'Acknowledge feedback after folding it into roadmap truth',
          code: 'pd roadmap ack fb-123456 --as cartographer --into tuple-backed-feedback-harvest',
          output: 'Harvested feedback fb-123456 into tuple-backed-feedback-harvest'
        },
      ]}
      seeAlso={[
        { name: 'pd salvage', href: '/docs/cli/salvage' },
        { name: 'pd notes', href: '/docs/cli/notes' },
        { name: 'pd fleet', href: '/docs/cli/fleet' },
      ]}
    />
  )
}
