import type { Meta, StoryObj } from '@storybook/react'
import { CodeBlock, TerminalLine } from './CodeBlock'

const meta = {
  title: 'UI/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  argTypes: {
    language: {
      control: 'text',
      description: 'Language label displayed in the header',
    },
    filename: {
      control: 'text',
      description: 'Filename displayed in the header (overrides language)',
    },
    copyable: {
      control: 'boolean',
      description: 'Show the copy button',
    },
  },
} satisfies Meta<typeof CodeBlock>

export default meta
type Story = StoryObj<typeof meta>

// ─── Languages ─────────────────────────────────────────────────

export const Bash: Story = {
  args: {
    language: 'bash',
    children: `# Claim a port for your service
pd claim myapp:api:main

# Check what's running
pd services

# Release when done
pd release myapp:api:main`,
  },
}

export const TypeScript: Story = {
  args: {
    language: 'typescript',
    children: `import { PortDaddy } from 'port-daddy'

const pd = new PortDaddy()

// Claim a port atomically
const { port } = await pd.claim('myapp:api:main')
console.log(\`Server running on port \${port}\`)

// Release when shutting down
await pd.release('myapp:api:main')`,
  },
}

export const JSON: Story = {
  args: {
    language: 'json',
    children: `{
  "service": "myapp:api:main",
  "port": 3001,
  "claimed_at": "2026-03-17T12:00:00Z",
  "heartbeat": "2026-03-17T12:05:00Z",
  "status": "active"
}`,
  },
}

// ─── With Filename ─────────────────────────────────────────────

export const WithFilename: Story = {
  args: {
    filename: 'server.ts',
    children: `import express from 'express'
import { PortDaddy } from 'port-daddy'

const app = express()
const pd = new PortDaddy()

const { port } = await pd.claim('myapp:api')
app.listen(port, () => {
  console.log(\`Listening on :\${port}\`)
})`,
  },
}

// ─── Copyable vs Non-Copyable ──────────────────────────────────

export const WithCopyButton: Story = {
  args: {
    language: 'bash',
    copyable: true,
    children: 'npm install port-daddy',
  },
}

export const WithoutCopyButton: Story = {
  args: {
    language: 'bash',
    copyable: false,
    children: `$ pd services
PORT   SERVICE           STATUS
3001   myapp:api:main    active
3002   myapp:web:main    active
8080   dashboard         active`,
  },
}

// ─── Terminal Lines ────────────────────────────────────────────

export const TerminalLineStory: Story = {
  name: 'TerminalLine',
  args: {
    children: '',
  },
  render: () => (
    <div style={{
      background: 'var(--code-bg, #1E1B18)', /* fallback: p-ebony-700 */
      padding: '1rem',
      borderRadius: '0.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
    }}>
      <TerminalLine prompt="$" command="pd claim myapp:api:main" />
      <TerminalLine output="Port 3001 claimed for myapp:api:main" />
      <TerminalLine prompt="$" command="pd services" />
      <TerminalLine output="PORT   SERVICE           STATUS" />
      <TerminalLine output="3001   myapp:api:main    active" />
    </div>
  ),
}

// ─── Real-World Example ────────────────────────────────────────

export const MultiAgentWorkflow: Story = {
  name: 'Multi-Agent Workflow',
  args: {
    filename: 'agent-setup.sh',
    children: `#!/bin/bash

# Register as an agent
pd agent register \\
  --agent worker-042 \\
  --identity myapp:api \\
  --purpose "Building authentication module"

# Start a session
pd begin \\
  --agent worker-042 \\
  --purpose "Implement OAuth2 flow"

# Claim files to avoid conflicts
pd session files claim worker-042 \\
  src/auth/oauth.ts \\
  src/auth/tokens.ts

# Do work...

# Add progress notes
pd note "OAuth2 provider integration complete" \\
  --type progress

# End session when done
pd done --agent worker-042`,
  },
}

// ─── Side by Side: Copyable vs Not ─────────────────────────────

export const CopyableComparison: Story = {
  name: 'Copyable vs Non-Copyable',
  args: {
    children: '',
  },
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 600 }}>
      <div>
        <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
          With copy button (interactive command)
        </p>
        <CodeBlock language="bash" copyable={true}>
          {'pd claim myapp:api:main --port 3001'}
        </CodeBlock>
      </div>
      <div>
        <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
          Without copy button (output display)
        </p>
        <CodeBlock language="bash" copyable={false}>
          {`PORT   SERVICE           STATUS    CLAIMED
3001   myapp:api:main    active    2h ago
3002   myapp:web:main    active    1h ago
8080   dashboard         active    30m ago`}
        </CodeBlock>
      </div>
    </div>
  ),
}
