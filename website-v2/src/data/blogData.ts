import backendReadinessContent from './blog/backend-readiness-is-dependency-truth.md?raw';
import bondPricingContent from './blog/bond-pricing-is-a-market.md?raw';
import controlPlaneContent from './blog/control-plane-is-the-product.md?raw';
import coordinationGuardContent from './blog/coordination-guard-claims-into-policy.md?raw';
import daemonProvenanceContent from './blog/running-is-not-current.md?raw';
import evidenceCrossMachineContent from './blog/evidence-that-survives-machines.md?raw';
import fleetDesignerContent from './blog/fleet-designer-cold-start.md?raw';
import mapTruthContent from './blog/recovery-roadmap-map-truth.md?raw';
import passkeyIdentityContent from './blog/passkey-identity-across-machines.md?raw';
import pdTubeContent from './blog/pd-tube-event-reply-loop.md?raw';
import telemetryContent from './blog/telemetry-is-a-launch-gate.md?raw';
import { blogPostMetas, deprecatedBlogPosts, type BlogPostMeta } from './blogMetaData';

export interface BlogPost extends BlogPostMeta {
  content: string;
}

const contentBySlug: Record<string, string> = {
  'backend-readiness-is-dependency-truth': backendReadinessContent,
  'bond-pricing-is-a-market': bondPricingContent,
  'control-plane-is-the-product': controlPlaneContent,
  'coordination-guard-claims-into-policy': coordinationGuardContent,
  'evidence-that-survives-machines': evidenceCrossMachineContent,
  'fleet-designer-cold-start': fleetDesignerContent,
  'passkey-identity-across-machines': passkeyIdentityContent,
  'pd-tube-event-reply-loop': pdTubeContent,
  'recovery-roadmap-map-truth': mapTruthContent,
  'running-is-not-current': daemonProvenanceContent,
  'telemetry-is-a-launch-gate': telemetryContent,
};

function contentForSlug(slug: string) {
  const content = contentBySlug[slug];
  if (!content) throw new Error(`Missing blog content for ${slug}`);
  return content;
}

export const blogPosts: BlogPost[] = blogPostMetas.map((post) => ({
  ...post,
  content: contentForSlug(post.slug),
}));

export { deprecatedBlogPosts };
export type { BlogPostMeta, DeprecatedBlogPost } from './blogMetaData';
