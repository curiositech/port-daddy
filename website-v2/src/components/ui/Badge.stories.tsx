import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './Badge'
import { Activity, AlertTriangle, CheckCircle, Circle, Zap } from 'lucide-react'

const meta = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['teal', 'amber', 'green', 'neutral'],
      description: 'Color variant',
    },
    children: {
      control: 'text',
      description: 'Badge content',
    },
  },
  args: {
    children: 'Badge',
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

// ─── Variants ──────────────────────────────────────────────────

export const Teal: Story = {
  args: {
    variant: 'teal',
    children: 'Active',
  },
}

export const Amber: Story = {
  args: {
    variant: 'amber',
    children: 'Warning',
  },
}

export const Green: Story = {
  args: {
    variant: 'green',
    children: 'Healthy',
  },
}

export const Neutral: Story = {
  args: {
    variant: 'neutral',
    children: 'Inactive',
  },
}

// ─── All Variants Side by Side ─────────────────────────────────

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <Badge variant="teal">Teal</Badge>
      <Badge variant="amber">Amber</Badge>
      <Badge variant="green">Green</Badge>
      <Badge variant="neutral">Neutral</Badge>
    </div>
  ),
}

// ─── With Icons ────────────────────────────────────────────────

export const WithIcon: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <Badge variant="green">
        <CheckCircle size={12} />
        Running
      </Badge>
      <Badge variant="amber">
        <AlertTriangle size={12} />
        Stale
      </Badge>
      <Badge variant="teal">
        <Activity size={12} />
        Heartbeat
      </Badge>
      <Badge variant="neutral">
        <Circle size={12} />
        Idle
      </Badge>
    </div>
  ),
}

// ─── Contextual Usage ──────────────────────────────────────────

export const StatusIndicators: Story = {
  name: 'Status Indicators',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Badge variant="green">
          <Zap size={12} />
          Online
        </Badge>
        <span style={{ fontSize: '0.875rem' }}>Port Daddy Daemon</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Badge variant="teal">v3.5</Badge>
        <span style={{ fontSize: '0.875rem' }}>Current Version</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Badge variant="amber">
          <AlertTriangle size={12} />
          Stale
        </Badge>
        <span style={{ fontSize: '0.875rem' }}>Agent worker-042</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Badge variant="neutral">Stopped</Badge>
        <span style={{ fontSize: '0.875rem' }}>Background Worker</span>
      </div>
    </div>
  ),
}

// ─── Without Icons ─────────────────────────────────────────────

export const TextOnly: Story = {
  name: 'Text Only',
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <Badge variant="teal">Port 3001</Badge>
      <Badge variant="green">Claimed</Badge>
      <Badge variant="amber">Expiring</Badge>
      <Badge variant="neutral">Released</Badge>
    </div>
  ),
}
