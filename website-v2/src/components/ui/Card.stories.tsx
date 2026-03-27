import type { Meta, StoryObj } from '@storybook/react'
import { Card, CardHeader, CardContent, CardFooter } from './Card'
import { Button } from './Button'
import { Badge } from './Badge'
import { Anchor, Server, Shield } from 'lucide-react'

const meta = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'glass', 'elevated', 'inset'],
      description: 'Visual style variant (maps to Surface depth)',
    },
    interactive: {
      control: 'boolean',
      description: 'Whether the card responds to hover with depth changes',
    },
  },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

// ─── Variants ──────────────────────────────────────────────────

export const Default: Story = {
  args: {
    variant: 'default',
  },
  render: (args) => (
    <Card {...args} style={{ maxWidth: 400 }}>
      <CardHeader>
        <h3 style={{ margin: 0 }}>Default Card</h3>
      </CardHeader>
      <CardContent>
        <p>The standard neumorphic raised card with soft shadows.</p>
      </CardContent>
    </Card>
  ),
}

export const Glass: Story = {
  args: {
    variant: 'glass',
  },
  render: (args) => (
    <div style={{ padding: '2rem', background: 'linear-gradient(135deg, var(--surface-base), var(--surface-overlay))' }}>
      <Card {...args} style={{ maxWidth: 400 }}>
        <CardHeader>
          <h3 style={{ margin: 0 }}>Glass Card</h3>
        </CardHeader>
        <CardContent>
          <p>Glassmorphism variant with backdrop blur. Best on gradient backgrounds.</p>
        </CardContent>
      </Card>
    </div>
  ),
}

export const Elevated: Story = {
  args: {
    variant: 'elevated',
  },
  render: (args) => (
    <Card {...args} style={{ maxWidth: 400 }}>
      <CardHeader>
        <h3 style={{ margin: 0 }}>Elevated Card</h3>
      </CardHeader>
      <CardContent>
        <p>Elevated variant — same depth as default, for emphasis.</p>
      </CardContent>
    </Card>
  ),
}

export const Interactive: Story = {
  args: {
    variant: 'default',
    interactive: true,
  },
  render: (args) => (
    <Card {...args} style={{ maxWidth: 400 }}>
      <CardHeader>
        <h3 style={{ margin: 0 }}>Interactive Card</h3>
      </CardHeader>
      <CardContent>
        <p>Hover to see the neumorphic depth change — shadow compresses on hover.</p>
      </CardContent>
    </Card>
  ),
}

// ─── All Variants Side by Side ─────────────────────────────────

export const AllVariants: Story = {
  render: () => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '1.5rem',
      padding: '2rem',
      background: 'linear-gradient(135deg, var(--surface-base), var(--surface-raised))',
    }}>
      {(['default', 'glass', 'elevated'] as const).map((variant) => (
        <Card key={variant} variant={variant}>
          <CardHeader>
            <h3 style={{ margin: 0, textTransform: 'capitalize' }}>{variant}</h3>
          </CardHeader>
          <CardContent>
            <p>The {variant} card variant.</p>
          </CardContent>
        </Card>
      ))}
    </div>
  ),
}

// ─── With Header, Content, and Footer ──────────────────────────

export const FullComposition: Story = {
  render: () => (
    <Card variant="default" style={{ maxWidth: 400 }}>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Port Assignment</h3>
          <Badge variant="success">Active</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.875rem' }}>Service</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>myapp:api:main</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.875rem' }}>Port</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>3001</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.875rem' }}>Claimed</span>
            <span style={{ fontSize: '0.875rem' }}>2 hours ago</span>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button size="sm" variant="outline">Release</Button>
          <Button size="sm" variant="ghost">View Logs</Button>
        </div>
      </CardFooter>
    </Card>
  ),
}

// ─── Card with Badge ───────────────────────────────────────────

export const WithBadge: Story = {
  render: () => (
    <Card variant="default" style={{ maxWidth: 400 }}>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Anchor size={20} />
          <h3 style={{ margin: 0 }}>Port Management</h3>
          <Badge variant="teal">v3.5</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p>Atomic port assignment with zero race conditions. SQLite-backed for persistence across restarts.</p>
      </CardContent>
    </Card>
  ),
}

// ─── Feature Cards Grid ────────────────────────────────────────

export const FeatureCardsGrid: Story = {
  render: () => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '1.5rem',
      maxWidth: 900,
    }}>
      <Card variant="default" interactive>
        <CardContent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Anchor size={24} style={{ color: 'var(--brand-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '1.125rem' }}>Port Claiming</h3>
            <p style={{ fontSize: '0.875rem' }}>Atomic port assignment with collision detection.</p>
          </div>
        </CardContent>
      </Card>

      <Card variant="default" interactive>
        <CardContent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Server size={24} style={{ color: 'var(--brand-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '1.125rem' }}>Agent Registry</h3>
            <p style={{ fontSize: '0.875rem' }}>Track active agents with heartbeats and salvage.</p>
          </div>
        </CardContent>
      </Card>

      <Card variant="default" interactive>
        <CardContent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Shield size={24} style={{ color: 'var(--brand-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '1.125rem' }}>Distributed Locks</h3>
            <p style={{ fontSize: '0.875rem' }}>Mutual exclusion for shared resources.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  ),
}
