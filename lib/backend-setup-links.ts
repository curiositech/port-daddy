export interface BackendSetupLink {
  label: string;
  url: string;
  description?: string;
  kind?: 'token_template' | 'docs';
}

function tokenTemplateUrl(name: string, permissions: Array<{ key: string; type: 'read' | 'edit' | 'run' }>): string {
  const permissionGroupKeys = encodeURIComponent(JSON.stringify(permissions));
  return `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=${permissionGroupKeys}&name=${encodeURIComponent(name)}`;
}

export const CLOUDFLARE_WORKERS_AI_TOKEN_URL = tokenTemplateUrl('pd-workers-ai', [
  { key: 'workers_ai', type: 'read' },
  { key: 'workers_ai', type: 'edit' },
]);

export const CLOUDFLARE_AI_STACK_TOKEN_URL = tokenTemplateUrl('pd-ai-stack', [
  { key: 'workers_ai', type: 'read' },
  { key: 'workers_ai', type: 'edit' },
  { key: 'ai_gateway', type: 'read' },
  { key: 'ai_gateway', type: 'edit' },
  { key: 'ai_search', type: 'edit' },
  { key: 'ai_search', type: 'run' },
]);

export const CLOUDFLARE_BACKEND_SETUP_LINKS: BackendSetupLink[] = [
  {
    label: 'Create pd-ai-stack token',
    url: CLOUDFLARE_AI_STACK_TOKEN_URL,
    description: 'Workers AI, AI Gateway, and AI Search for the full Port Daddy AI stack.',
    kind: 'token_template',
  },
  {
    label: 'Create Workers AI token',
    url: CLOUDFLARE_WORKERS_AI_TOKEN_URL,
    description: 'Smallest token for Cloudflare model launches.',
    kind: 'token_template',
  },
  {
    label: 'Cloudflare token template docs',
    url: 'https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/',
    description: 'Cloudflare reference for pre-filled API token links.',
    kind: 'docs',
  },
];
