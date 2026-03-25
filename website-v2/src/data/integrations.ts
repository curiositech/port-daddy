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
    setupCode: `pd mcp install\n# Claude Code now has Port Daddy tools available.`
  }
];
