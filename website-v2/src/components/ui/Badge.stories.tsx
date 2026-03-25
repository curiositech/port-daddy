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
