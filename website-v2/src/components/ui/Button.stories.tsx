import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'
import { Anchor, ArrowRight, Copy, Download, Play, Terminal } from 'lucide-react'

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'ghost', 'code', 'outline'],
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

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'View Docs',
  },
}

export const Code: Story = {
  args: {
    variant: 'code',
    children: 'npm install port-daddy',
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
      <Button variant="ghost">Ghost</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="code">pd claim myapp</Button>
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
      <Button variant="code">
        <Terminal size={16} />
        pd status
      </Button>
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
      <Button variant="ghost" disabled>Ghost</Button>
      <Button variant="outline" disabled>Outline</Button>
      <Button variant="code" disabled>pd claim</Button>
    </div>
  ),
}
