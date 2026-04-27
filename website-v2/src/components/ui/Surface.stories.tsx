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

export const StateMatrix: Story = {
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  render: () => (
    <div className="grid max-w-[72rem] gap-[var(--space-5)] bg-[var(--surface-base)] p-[var(--space-6)] text-[var(--text-primary)]">
      <div className="grid gap-[var(--space-2)]">
        <p className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
          Surface state matrix
        </p>
        <p className="max-w-[var(--measure-copy)] text-[var(--text-secondary)]">
          Covers depth, density, interactive, empty, error, and overflow conditions for card-like surfaces.
        </p>
      </div>

      <div className="grid gap-[var(--space-4)] md:grid-cols-2 xl:grid-cols-3">
        <Surface depth="raised" padding="lg" radius="none">
          <h3 className="mb-[var(--space-2)] font-display text-[length:var(--type-panel-title-nav-size)] font-black">
            Raised
          </h3>
          <p className="text-[var(--text-secondary)]">Default card or panel surface.</p>
        </Surface>
        <Surface depth="flat" padding="lg" radius="none">
          <h3 className="mb-[var(--space-2)] font-display text-[length:var(--type-panel-title-nav-size)] font-black">
            Flat
          </h3>
          <p className="text-[var(--text-secondary)]">Quiet grouping surface for dense layouts.</p>
        </Surface>
        <Surface depth="inset" padding="lg" radius="none">
          <h3 className="mb-[var(--space-2)] font-display text-[length:var(--type-panel-title-nav-size)] font-black">
            Inset
          </h3>
          <p className="text-[var(--text-secondary)]">Input wells, terminal wells, and passive status surfaces.</p>
        </Surface>
        <Surface depth="raised" padding="lg" radius="none" interactive tabIndex={0} role="button">
          <h3 className="mb-[var(--space-2)] font-display text-[length:var(--type-panel-title-nav-size)] font-black">
            Interactive
          </h3>
          <p className="text-[var(--text-secondary)]">Keyboard-focusable surface for command affordances.</p>
        </Surface>
        <Surface depth="raised" padding="lg" radius="none" className="border-2 border-[var(--status-error)]">
          <h3 className="mb-[var(--space-2)] font-display text-[length:var(--type-panel-title-nav-size)] font-black">
            Error
          </h3>
          <p className="text-[var(--text-secondary)]">Failure state uses status tokens instead of local color.</p>
        </Surface>
        <Surface depth="flat" padding="lg" radius="none">
          <p className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            Empty state
          </p>
        </Surface>
      </div>
    </div>
  ),
}
