export type FeaturedCard = {
  href: string
  audience: string
  title: string
  hook: string
  media:
    | { kind: 'image'; src: string; alt: string; position?: string }
    | { kind: 'video'; src: string; poster?: string }
}

export const featuredStoryCards: FeaturedCard[] = [
  {
    href: '/blog/the-pr-that-reviews-itself',
    audience: 'For builders',
    title: 'How a PR reviews itself',
    hook: 'Six paid critics can arrive on the same diff in the same push.',
    media: {
      kind: 'image',
      src: '/img/generated/pr-reviews-itself/hero.webp',
      alt: 'A kitchen brigade of six reviewers already working on a pull request.',
    },
  },
  {
    href: '/blog/your-ai-subscription-powers-the-fleet',
    audience: 'For operators',
    title: 'Your AI subscription is already fleet capacity',
    hook: 'One cursor stays with you; the parallel work runs in bounded lanes.',
    media: {
      kind: 'image',
      src: '/img/generated/blog-ai-subscription-fleet-hero.jpg',
      alt: 'A single AI subscription badge fanning into many ship-shaped agents.',
    },
  },
  {
    href: '/pd-tube',
    audience: 'For demo day',
    title: 'One local channel, every trigger',
    hook: 'Buttons, hooks, tests, webhooks, and notebooks all dial the same local desk.',
    media: {
      kind: 'image',
      src: '/img/generated/tube-multiplex/multiscreen-fanout.webp',
      alt: 'One local request fanning out across multiple agent screens.',
    },
  },
  {
    href: '/blog/the-macaroon-gate',
    audience: 'For security teams',
    title: 'A credential an agent can narrow, not widen',
    hook: 'The push token becomes a bounded capability instead of a prayer.',
    media: {
      kind: 'image',
      src: '/img/generated/macaroon-gate/leviathan.webp',
      alt: 'A leviathan rising over many small agent-ships in an ungoverned sea.',
      position: 'center 46%',
    },
  },
  {
    href: '/blog/attention-is-the-first-command',
    audience: 'For journalists',
    title: 'The first command is attention',
    hook: 'The story is not more autonomous agents; it is agents that read the room.',
    media: {
      kind: 'image',
      src: '/img/generated/attention-first-command/hero.webp',
      alt: 'A harbor mailroom where agent messages pile up unread.',
    },
  },
  {
    href: '/manifesto',
    audience: 'For investors',
    title: 'Why the harbor comes before the fleet',
    hook: 'Coordination is the infrastructure layer that makes agent labor inspectable.',
    media: {
      kind: 'image',
      src: '/img/manifesto/hero-harbor.webp',
      alt: 'A working harbor where agents dock, coordinate, and ship.',
    },
  },
]
