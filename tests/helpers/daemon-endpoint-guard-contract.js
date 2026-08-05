/**
 * Shared coverage contract for the daemon-endpoint CI guards.
 *
 * Keep the path policy in one place: the bare-port and full-URL guards must
 * inspect the same active product surfaces. `LEGACY_ENDPOINT_DEBT_FILES` is a
 * temporary, exact baseline for violations that predate the widened guard.
 * The port guard also proves every baseline entry still contains the literal,
 * so cleanup commits cannot leave stale exemptions behind.
 */

export const DAEMON_ENDPOINT_ENFORCED_PATH_PREFIXES = Object.freeze([
  'lib/',
  'routes/',
  'cli/',
  'bin/',
  'mcp/',
  'shared/',
  'scripts/',
  'apps/',
  'public/',
  'fleet-config-ui/src/',
  'dashboard/',
  'core/',
  'examples/',
  'website-v2/src/',
]);

export const DAEMON_ENDPOINT_ENFORCED_FILES = new Set([
  'server.ts',
  'install-daemon.ts',
]);

// Exact migration debt present when full active-source coverage was enabled.
// New files never belong here. Remove an entry in the same atomic PR that
// replaces its fixed endpoint with selected-daemon discovery.
export const LEGACY_ENDPOINT_DEBT_FILES = new Set([
  'apps/FleetBar/FleetBar/DaemonLocation.swift',
  'apps/pd-scout-extension/background.js',
  'apps/pd-scout-extension/popup.js',
  'core/pd-timeline-proto/src/main.rs',
  'examples/agent-topologies/topology-pubsub.ts',
  'examples/leader-election/leader-election.ts',
  'examples/p2p-webrtc/webrtc-signaling.ts',
  'examples/test-reporter/test-failure-to-agent.ts',
  'examples/webhook-adapter/local-webhook-to-agent.ts',
  'fleet-config-ui/src/api.ts',
  'public/samples/files/examples/agent-topologies/topology-pubsub.ts',
  'public/samples/files/examples/leader-election/leader-election.ts',
  'public/samples/files/examples/p2p-webrtc/webrtc-signaling.ts',
  'public/samples/files/examples/test-reporter/test-failure-to-agent.ts',
  'public/samples/files/examples/webhook-adapter/local-webhook-to-agent.ts',
  'routes/sitrep.ts',
  'website-v2/src/components/landing/AgentEcosystem.tsx',
  'website-v2/src/components/landing/MaturitySection.tsx',
  'website-v2/src/components/tube/tube-transport.ts',
  'website-v2/src/data/hero-copy.ts',
  'website-v2/src/data/integrations.ts',
  'website-v2/src/data/product.ts',
  'website-v2/src/docs-content/bestPractices.ts',
  'website-v2/src/docs-content/getStarted.ts',
  'website-v2/src/lib/daemon-url.ts',
  'website-v2/src/pages/AgentsPage.tsx',
  'website-v2/src/pages/ScoutPage.tsx',
  'website-v2/src/pages/docs/ApiReference.tsx',
  'website-v2/src/pages/docs/Decisions.tsx',
  'website-v2/src/pages/docs/features/ArbiterFeature.tsx',
  'website-v2/src/pages/docs/features/FleetFeature.tsx',
  'website-v2/src/pages/docs/features/PheromoneFeature.tsx',
  'website-v2/src/pages/pd-tube/Playground.tsx',
  'website-v2/src/pages/pd-tube/demos/EditorLightbulb.tsx',
  'website-v2/src/pages/tutorials/Fleet.tsx',
  'website-v2/src/pages/tutorials/PdTube.tsx',
  'website-v2/src/pages/tutorials/Primitives.tsx',
  'website-v2/src/pages/tutorials/RemoteHarbors.tsx',
  'website-v2/src/pages/tutorials/TimeTravel.tsx',
  'website-v2/src/pages/tutorials/Tunnel.tsx',
]);
