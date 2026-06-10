import attentionFirstCommandContent from './blog/attention-is-the-first-command.md?raw';
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
import pdTubeMultiContent from './blog/pd-tube-multi-subscriber.md?raw';
import redWhiteIsolationContent from './blog/red-and-white-stay-in-their-lanes.md?raw';
import telemetryContent from './blog/telemetry-is-a-launch-gate.md?raw';
import cliIsForRobotsContent from './blog/the-cli-is-for-the-robots.md?raw';
import aiSubscriptionFleetContent from './blog/your-ai-subscription-powers-the-fleet.md?raw';
import prReviewsItselfContent from './blog/the-pr-that-reviews-itself.md?raw';
import { blogPostMetas, deprecatedBlogPosts, type BlogPostMeta } from './blogMetaData';

export interface BlogPost extends BlogPostMeta {
  content: string;
}

const contentBySlug: Record<string, string> = {
  'attention-is-the-first-command': attentionFirstCommandContent,
  'backend-readiness-is-dependency-truth': backendReadinessContent,
  'bond-pricing-is-a-market': bondPricingContent,
  'control-plane-is-the-product': controlPlaneContent,
  'coordination-guard-claims-into-policy': coordinationGuardContent,
  'evidence-that-survives-machines': evidenceCrossMachineContent,
  'fleet-designer-cold-start': fleetDesignerContent,
  'passkey-identity-across-machines': passkeyIdentityContent,
  'pd-tube-event-reply-loop': pdTubeContent,
  'pd-tube-multi-subscriber': pdTubeMultiContent,
  'recovery-roadmap-map-truth': mapTruthContent,
  'red-and-white-stay-in-their-lanes': redWhiteIsolationContent,
  'running-is-not-current': daemonProvenanceContent,
  'telemetry-is-a-launch-gate': telemetryContent,
  'the-cli-is-for-the-robots': cliIsForRobotsContent,
  'your-ai-subscription-powers-the-fleet': aiSubscriptionFleetContent,
  'the-pr-that-reviews-itself': prReviewsItselfContent,
};

// A post meta with no bundled content is a wiring bug (the .md exists but was
// never imported + added to contentBySlug above). Historically this threw at
// module-load time, which took down the ENTIRE blog — one unwired post blanked
// every page. Instead, drop the offending post and log loudly. The blog stays
// up; the gap is obvious in the console and to anyone auditing the build.
const missingContentSlugs: string[] = [];

export const blogPosts: BlogPost[] = blogPostMetas
  .filter((post) => {
    if (contentBySlug[post.slug]) return true;
    missingContentSlugs.push(post.slug);
    return false;
  })
  .map((post) => ({
    ...post,
    content: contentBySlug[post.slug],
  }));

if (missingContentSlugs.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `[blogData] ${missingContentSlugs.length} blog post(s) are missing bundled content and were hidden: ` +
      `${missingContentSlugs.join(', ')}. Import the .md (?raw) and add it to contentBySlug in src/data/blogData.ts.`,
  );
}

/** Slugs whose meta exists but whose content was never wired in. Exported for build-time guards/tests. */
export const blogPostsMissingContent: readonly string[] = missingContentSlugs;

export { deprecatedBlogPosts };
export type { BlogPostMeta, DeprecatedBlogPost } from './blogMetaData';
