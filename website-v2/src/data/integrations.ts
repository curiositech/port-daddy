export interface Integration {
  id: string;
  name: string;
  description: string;
  logo: string;
  status: 'official' | 'community' | 'preview';
  details: string[];
  setupCode: string;
  category: 'LLM' | 'Framework' | 'IDE' | 'Infrastructure';
}

export const INTEGRATIONS: Integration[] = [
  {
    id: 'claude-mcp',
    name: 'Claude MCP Server',
    description: 'Native Model Context Protocol integration for Claude Code agents. Provides structured tools for port claiming, session management, and agent coordination.',
    logo: 'anthropic',
    status: 'official',
    category: 'LLM',
    details: [
      'Deep MCP (Model Context Protocol) integration for token-efficient coordination.',
      'Progressive disclosure: Claude only sees essential tools until pd_discover() is called.',
      'Session management: begin_session, end_session_full, whoami, and add_note tools built in.'
    ],
    setupCode: `pd mcp install\n# Claude Code now has Port Daddy tools and the Pilot persona available.`
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'MCP integration for Cursor IDE. Port Daddy tools appear natively in Cursor\'s AI assistant for seamless port and session management.',
    logo: 'cursor',
    status: 'official',
    category: 'IDE',
    details: [
      'MCP integration surfaces Port Daddy tools directly in Cursor\'s AI panel.',
      'Automatic session creation when Cursor opens a project with a .portdaddy config.',
      'File claims sync with Cursor\'s active editor tabs to prevent multi-agent collisions.'
    ],
    setupCode: `pd mcp install --editor cursor\n# Restart Cursor to activate Port Daddy tools.`
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'MCP integration for Windsurf IDE. Enables AI flows to coordinate ports, sessions, and locks through Port Daddy\'s structured tools.',
    logo: 'windsurf',
    status: 'official',
    category: 'IDE',
    details: [
      'MCP integration provides Port Daddy tools inside Windsurf\'s Cascade AI flows.',
      'Automatic port assignment when Windsurf launches dev servers.',
      'Session notes from Windsurf flows appear in the shared timeline for cross-agent visibility.'
    ],
    setupCode: `pd mcp install --editor windsurf\n# Restart Windsurf to activate Port Daddy tools.`
  },
  {
    id: 'langchain',
    name: 'LangChain',
    description: 'Python SDK wrapper for LangChain agents. Gives chains and agents access to port claiming, sessions, and pub/sub coordination.',
    logo: 'langchain',
    status: 'community',
    category: 'Framework',
    details: [
      'Thin Python wrapper around the Port Daddy HTTP API for LangChain tool integration.',
      'LangChain Tool classes for claim, release, begin, done, note, and pub/sub operations.',
      'Automatic session lifecycle tied to chain execution -- begin on start, done on completion.'
    ],
    setupCode: `import os\n\n# Daemon publishes endpoint to ~/.port-daddy/daemon.port\ndaemon_port_file = os.path.expanduser('~/.port-daddy/daemon.port')\nif os.path.exists(daemon_port_file):\n    with open(daemon_port_file) as f:\n        daemon_port = f.read().strip()\n    base_url = f'http://localhost:{daemon_port}'\nelse:\n    # Check environment or raise informative error\n    base_url = os.getenv('PORT_DADDY_URL')\n    if not base_url:\n        raise RuntimeError('Daemon not running. Start it with pd setup or check FleetBar Control Center for status.')\n\nfrom portdaddy_langchain import PortDaddyToolkit\ntools = PortDaddyToolkit(base_url=base_url)`
  },
  {
    id: 'crewai',
    name: 'CrewAI',
    description: 'Session-per-crew-member integration for CrewAI. Each crew member gets an isolated session with file claims and coordinated notes.',
    logo: 'crewai',
    status: 'community',
    category: 'Framework',
    details: [
      'Each CrewAI agent automatically gets a dedicated Port Daddy session on task start.',
      'File claims prevent crew members from editing the same files simultaneously.',
      'Crew task handoffs trigger pub/sub messages so downstream agents react immediately.'
    ],
    setupCode: `pip install portdaddy-crewai\n\nfrom portdaddy_crewai import PortDaddyCrew\ncrew = PortDaddyCrew(project="myapp", agents=["researcher", "coder", "reviewer"])`
  },
  {
    id: 'aider',
    name: 'Aider',
    description: 'CLI integration for Aider. pd begin wraps Aider sessions with automatic port assignment, notes, and salvage on crash.',
    logo: 'aider',
    status: 'community',
    category: 'Infrastructure',
    details: [
      'pd spawn --backend aider launches Aider with a Port Daddy session pre-configured.',
      'Session notes capture Aider\'s edit history for cross-agent context.',
      'Automatic salvage: if Aider crashes, its session context enters the resurrection queue.'
    ],
    setupCode: `pd spawn --backend aider --identity myapp:coder -- "Fix the login bug"\n# Or wrap manually:\npd begin "Fix the login bug" --identity myapp:coder --lifecycle durable && aider && pd done`
  },
  {
    id: 'continue-dev',
    name: 'Continue.dev',
    description: 'IDE extension integration for Continue.dev. File claims prevent collisions when multiple Continue agents edit the same codebase.',
    logo: 'continue',
    status: 'preview',
    category: 'IDE',
    details: [
      'File claims from Continue.dev sessions sync to Port Daddy to prevent multi-agent edit collisions.',
      'Session notes from Continue conversations appear in the shared project timeline.',
      'Port Daddy context is available as a Continue.dev context provider for agent awareness.'
    ],
    setupCode: `pd mcp-install --continue\n\n# Restart Continue.dev to activate Port Daddy integration.`
  }
];
