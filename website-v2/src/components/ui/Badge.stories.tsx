import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './Badge'
import { Anchor, Cpu, Shield } from 'lucide-react'

const meta: Meta<typeof Badge> = {
  title: 'Design System/Badge',
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['default', 'red', 'teal', 'gold', 'success', 'warning', 'outline'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
}
export default meta

type Story = StoryObj<typeof Badge>

export const Default: Story = { args: { children: 'Default', variant: 'default' } }
export const Red: Story = { args: { children: 'Critical', variant: 'red' } }
export const Teal: Story = { args: { children: 'Active', variant: 'teal' } }
export const Gold: Story = { args: { children: 'Preview', variant: 'gold' } }
export const Success: Story = { args: { children: 'Shipped', variant: 'success' } }
export const Warning: Story = { args: { children: 'Stale', variant: 'warning' } }

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Badge variant="default">Default</Badge>
      <Badge variant="red">Red</Badge>
      <Badge variant="teal">Teal</Badge>
      <Badge variant="gold">Gold</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
}

export const WithIcons: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Badge variant="teal"><Anchor /> Ports</Badge>
      <Badge variant="gold"><Cpu /> Agents</Badge>
      <Badge variant="red"><Shield /> Security</Badge>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Badge size="sm" variant="teal">Small</Badge>
      <Badge size="md" variant="teal">Medium</Badge>
      <Badge size="lg" variant="teal">Large</Badge>
    </div>
  ),
}

export const StateMatrix: Story = {
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  render: () => (
    <div className="grid max-w-[54rem] gap-[var(--space-5)] bg-[var(--surface-base)] p-[var(--space-6)] text-[var(--text-primary)]">
      <div className="grid gap-[var(--space-2)]">
        <p className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
          Badge state matrix
        </p>
        <p className="max-w-[var(--measure-copy)] text-[var(--text-secondary)]">
          Covers neutral, status, warning/error, outline, icon, dense, and long-label states without introducing page-local color values.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <Badge variant="default">Neutral</Badge>
        <Badge variant="success">Live</Badge>
        <Badge variant="warning">Stale</Badge>
        <Badge variant="red">Blocked</Badge>
        <Badge variant="teal">
          <Anchor aria-hidden="true" />
          Ports
        </Badge>
        <Badge variant="gold">
          <Cpu aria-hidden="true" />
          Agents
        </Badge>
        <Badge variant="outline">Compatibility</Badge>
        <Badge size="sm" variant="success">Dense</Badge>
        <Badge size="lg" variant="outline">Long audited system status</Badge>
      </div>
    </div>
  ),
}
