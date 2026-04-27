import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'
import { Anchor, ArrowRight, Copy, Download, LoaderCircle, Play, Trash2 } from 'lucide-react'

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'outline', 'danger'],
      description: 'Visual style variant',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Size preset',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    children: {
      control: 'text',
      description: 'Button content',
    },
  },
  args: {
    children: 'Button',
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

// ─── Variants ──────────────────────────────────────────────────

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'Get Started',
  },
}

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Learn More',
  },
}

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'View Architecture',
  },
}

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'View Docs',
  },
}

// ─── Sizes ─────────────────────────────────────────────────────

export const Small: Story = {
  args: {
    size: 'sm',
    children: 'Small',
  },
}

export const Medium: Story = {
  args: {
    size: 'md',
    children: 'Medium',
  },
}

export const Large: Story = {
  args: {
    size: 'lg',
    children: 'Large',
  },
}

// ─── All Sizes Side by Side ────────────────────────────────────

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}

// ─── All Variants Side by Side ─────────────────────────────────

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="outline">Outline</Button>
    </div>
  ),
}

// ─── With Icons ────────────────────────────────────────────────

export const WithLeadingIcon: Story = {
  args: {
    variant: 'primary',
    children: undefined,
  },
  render: (args) => (
    <Button {...args}>
      <Play size={16} />
      Start Session
    </Button>
  ),
}

export const WithTrailingIcon: Story = {
  args: {
    variant: 'primary',
    children: undefined,
  },
  render: (args) => (
    <Button {...args}>
      Get Started
      <ArrowRight size={16} />
    </Button>
  ),
}

export const WithIconVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <Button variant="primary">
        <Download size={16} />
        Install
      </Button>
      <Button variant="ghost">
        <Copy size={16} />
        Copy
      </Button>
      <Button variant="outline">
        <Anchor size={16} />
        Claim Port
      </Button>
      <Button variant="danger">Unsafe</Button>
    </div>
  ),
}

// ─── Disabled ──────────────────────────────────────────────────

export const Disabled: Story = {
  args: {
    disabled: true,
    children: 'Disabled',
  },
}

export const DisabledVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <Button variant="primary" disabled>Primary</Button>
      <Button variant="secondary" disabled>Secondary</Button>
      <Button variant="ghost" disabled>Ghost</Button>
      <Button variant="outline" disabled>Outline</Button>
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
    <div className="grid max-w-[64rem] gap-[var(--space-5)] bg-[var(--surface-base)] p-[var(--space-6)] text-[var(--text-primary)]">
      <div className="grid gap-[var(--space-2)]">
        <p className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
          Button state matrix
        </p>
        <p className="max-w-[var(--measure-copy)] text-[var(--text-secondary)]">
          Covers default, icon, focus-visible, active intent, loading, disabled, destructive, and empty/icon-only states.
        </p>
      </div>

      <div className="grid gap-[var(--space-3)] md:grid-cols-2 xl:grid-cols-4">
        <Button variant="primary">Default</Button>
        <Button variant="secondary">
          <Download size={16} />
          With icon
        </Button>
        <Button
          variant="outline"
          className="outline-2 outline-offset-3 outline-[var(--interactive-focus)]"
        >
          Focus visible
        </Button>
        <Button variant="primary" aria-pressed="true">
          <Play size={16} />
          Active
        </Button>
        <Button variant="secondary" aria-busy="true" disabled>
          <LoaderCircle size={16} aria-hidden="true" className="animate-spin" />
          Loading
        </Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button variant="danger">
          <Trash2 size={16} />
          Destructive
        </Button>
        <Button size="icon" aria-label="Copy command">
          <Copy size={16} />
        </Button>
      </div>
    </div>
  ),
}
