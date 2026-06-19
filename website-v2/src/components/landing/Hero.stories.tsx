import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { Hero } from './Hero'

// Hero is the top-of-page composition — SectionIntro hero size,
// primary/ghost CTA pair, and a synchronized light/dark capture on
// the right rail. The stories below render the live component so a
// regression in tokens, typography, or layout shows up here first.

const meta = {
  title: 'Landing/Hero',
  component: Hero,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="bg-[var(--surface-base)]">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof Hero>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// Narrow viewport check — the Hero collapses to a single column
// below the 1100px breakpoint. Long titles + tag pills stress
// the wrap behavior.
export const NarrowViewport: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  render: () => (
    <div className="max-w-[420px]">
      <Hero />
    </div>
  ),
}

// Container constraint — used to verify the Hero doesn't blow out
// of unusual layout shells.
export const ConstrainedShell: Story = {
  render: () => (
    <div className="mx-auto max-w-[960px] border-2 border-[var(--border-strong)]">
      <Hero />
    </div>
  ),
}
