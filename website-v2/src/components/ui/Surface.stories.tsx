import type { Meta, StoryObj } from '@storybook/react'
import { Surface } from './Surface'

const meta: Meta<typeof Surface> = {
  title: 'Design System/Surface',
  component: Surface,
  parameters: {
    backgrounds: { default: 'harbor-stone' },
  },
  argTypes: {
    depth: { control: 'select', options: ['raised', 'flat', 'inset', 'floating'] },
    radius: { control: 'select', options: ['none', 'sm', 'md', 'lg', 'xl', '2xl', 'full'] },
    padding: { control: 'select', options: ['none', 'sm', 'md', 'lg', 'xl'] },
    interactive: { control: 'boolean' },
  },
}
export default meta

type Story = StoryObj<typeof Surface>

export const Raised: Story = {
  args: { depth: 'raised', padding: 'lg' },
  render: (args) => (
    <Surface {...args}>
      <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 8 }}>Raised Surface</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Extruded from the page. Use for cards, panels, and content areas.</p>
    </Surface>
  ),
}

export const Inset: Story = {
  args: { depth: 'inset', padding: 'lg' },
  render: (args) => (
    <Surface {...args}>
      <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 8 }}>Inset Surface</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Pressed into the page. Use for input wells, code blocks, and progress tracks.</p>
    </Surface>
  ),
}

export const Interactive: Story = {
  args: { depth: 'raised', padding: 'lg', interactive: true },
  render: (args) => (
    <Surface {...args}>
      <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 8 }}>Interactive Surface</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Hover me — shadow flattens on press.</p>
    </Surface>
  ),
}

export const DepthStack: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      {(['raised', 'flat', 'inset', 'floating'] as const).map((d) => (
        <Surface key={d} depth={d} padding="lg" style={{ width: 200 }}>
          <code style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{d}</code>
        </Surface>
      ))}
    </div>
  ),
}
