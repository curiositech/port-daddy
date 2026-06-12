import { Fragment } from "react";
import {
  BracketLabel,
  DocsNoteCard,
  PanelBody,
  PanelTitle,
  SurfacePanel,
} from "@/components/site/primitives";
import {
  SdkFunctionPanel,
  SdkPageHeader,
  SdkPageLayout,
  SdkPager,
  SdkTypesPanel,
  type SdkFunction,
} from "@/components/site/SdkPageLayout";

const FUNCTIONS: SdkFunction[] = [
  {
    name: "createHarbor()",
    signature: "createHarbor(name: string, options?: HarborOptions): Promise<Harbor>",
    description: (
      <>
        A harbor is a permission boundary you put <em>around</em> work, not on top of it. The
        agents inside the harbor can only do what the harbor lets them do — read, write, run a
        listed binary, talk to a listed origin. Calling <code>createHarbor()</code> stamps that
        boundary, names it, and hands you a token nobody else has.
      </>
    ),
    params: [
      { name: "name", type: "string", required: true, description: "A short, memorable name. Pick the kind you can shout across a room — production-db, analytics-readonly, ci-runner." },
      { name: "options.capabilities", type: "string[]", description: "The verbs the harbor permits. Anything not listed is silently denied. Default is no capabilities (read-only inspection)." },
      { name: "options.allowedIdentities", type: "string[]", description: "Identity glob patterns that may enter — for example [\"myapp:api:*\", \"myapp:admin:*\"]. Anything else gets the door slammed." },
      { name: "options.ttl", type: "number", description: "Lifetime in seconds. Harbors are not buildings; they are tents. Default: 3600 (one hour)." },
    ],
    examples: [
      {
        title: "A read/write harbor with two identity patterns and a one-hour TTL",
        code: "const harbor = await pd.harbors.createHarbor(\"production-db\", {\n  capabilities: [\"read\", \"write\"],\n  allowedIdentities: [\"myapp:api:*\", \"myapp:admin:*\"],\n  ttl: 3600,\n})",
        output: "{\n  \"name\": \"production-db\",\n  \"capabilities\": [\"read\", \"write\"],\n  \"allowedIdentities\": [\"myapp:api:*\", \"myapp:admin:*\"],\n  \"createdAt\": \"2026-03-16T12:00:00Z\",\n  \"expiresAt\": \"2026-03-16T13:00:00Z\",\n  \"token\": \"harbor-token-abc123\"\n}",
      },
      {
        title: "A read-only harbor for a reporting agent — same shape, narrower verbs",
        code: "const harbor = await pd.harbors.createHarbor(\"analytics-readonly\", {\n  capabilities: [\"read\"],\n  allowedIdentities: [\"myapp:analytics:*\"],\n  ttl: 7200,\n})",
      },
    ],
  },
  {
    name: "enterHarbor()",
    signature: "enterHarbor(name: string, token: string): Promise<HarborSession>",
    description: (
      <>
        Take the token from <code>createHarbor()</code>, walk it up to the harbor, present it.
        If the token is valid and your identity matches the allow-list, you get back a session —
        the operations you are now permitted to perform, and the moment they expire.
      </>
    ),
    params: [
      { name: "name", type: "string", required: true, description: "The harbor you want to enter." },
      { name: "token", type: "string", required: true, description: "The harbor card token. Treat it like a key — short-lived, narrowly scoped, never logged in plaintext." },
    ],
    examples: [
      {
        title: "Enter, do work, let any rejection bubble — never swallow a harbor failure",
        code: "try {\n  const session = await pd.harbors.enterHarbor(\"production-db\", harborToken)\n  console.log(`Entered harbor with capabilities: ${session.capabilities.join(\", \")}`)\n  await performDatabaseWork()\n} catch (error) {\n  console.error(\"Failed to enter harbor:\", error.message)\n}",
        output: "{\n  \"harborName\": \"production-db\",\n  \"agentId\": \"agent-001\",\n  \"capabilities\": [\"read\", \"write\"],\n  \"enteredAt\": \"2026-03-16T12:00:00Z\",\n  \"expiresAt\": \"2026-03-16T13:00:00Z\"\n}",
      },
    ],
  },
  {
    name: "issueHarborCard()",
    signature: "issueHarborCard(agentId: string, capabilities: string[], options?: CardOptions): Promise<HarborCard>",
    description: (
      <>
        A harbor card is a junior token. It cannot grant verbs the harbor itself does not permit
        — <code>issueHarborCard()</code> always intersects requested capabilities with the
        harbor&rsquo;s capabilities. Use it to hand a one-task agent the smallest possible
        permission set: read this row, write inside this one folder, hit this endpoint no more than a hundred times.
      </>
    ),
    params: [
      { name: "agentId", type: "string", required: true, description: "Which agent gets the card. Identity-bound; cards are not transferable." },
      { name: "capabilities", type: "string[]", required: true, description: "Verbs to grant. Quietly intersected with the harbor capabilities — you cannot escalate." },
      { name: "options.harborName", type: "string", required: true, description: "The harbor this card unlocks. Cards are scoped, not portable." },
      { name: "options.ttl", type: "number", description: "Card lifetime in seconds. Cards are typically shorter-lived than harbors." },
      { name: "options.restrictions", type: "object", description: "Per-card path globs and operation caps — extra fences inside the existing fence." },
    ],
    examples: [
      {
        title: "A read-only card with a 30-minute TTL — the smallest useful permission slice",
        code: "const card = await pd.harbors.issueHarborCard(\"agent-001\", [\"read\"], {\n  harborName: \"production-db\",\n  ttl: 1800,\n})",
        output: "{\n  \"token\": \"card-token-xyz789\",\n  \"agentId\": \"agent-001\",\n  \"capabilities\": [\"read\"],\n  \"harborName\": \"production-db\",\n  \"issuedAt\": \"2026-03-16T12:00:00Z\",\n  \"expiresAt\": \"2026-03-16T12:30:00Z\"\n}",
      },
      {
        title: "A restricted card — same harbor, but path-globbed and operation-capped",
        code: "const card = await pd.harbors.issueHarborCard(\"agent-002\", [\"read\", \"write\"], {\n  harborName: \"production-db\",\n  ttl: 3600,\n  restrictions: {\n    allowedPaths: [\"/data/public/*\"],\n    deniedPaths: [\"/data/private/*\"],\n    maxOperations: 100,\n  },\n})",
      },
    ],
  },
];

const TYPES = `interface Harbor {
  name: string;
  capabilities: string[];
  allowedIdentities: string[];
  createdAt: string;
  expiresAt: string;
  token: string;
}

interface HarborOptions {
  capabilities?: string[];
  allowedIdentities?: string[];
  ttl?: number;
}

interface HarborSession {
  harborName: string;
  agentId: string;
  capabilities: string[];
  enteredAt: string;
  expiresAt: string;
}

interface HarborCard {
  token: string;
  agentId: string;
  capabilities: string[];
  harborName: string;
  issuedAt: string;
  expiresAt: string;
}

interface CardOptions {
  harborName: string;
  ttl?: number;
  restrictions?: {
    allowedPaths?: string[];
    deniedPaths?: string[];
    maxOperations?: number;
  };
}`;

export default function HarborsSdk() {
  return (
    <SdkPageLayout
      header={
        <SdkPageHeader
          eyebrow="SDK · Harbors"
          title="Harbors — capability fences agents work inside."
          summary="A harbor is a small named place an agent can be — with a finite list of verbs, an allow-list of identities, and a stopwatch. Entering one does not give you new powers; it removes powers you already had."
          breadcrumbs={[
            { label: "SDK", href: "/docs/sdk" },
            { label: "Modules", href: "/docs/sdk" },
            { label: "Harbors" },
          ]}
          meta={
            <SurfacePanel padding="compact" tone="paper">
              <BracketLabel className="self-start">In one paragraph</BracketLabel>
              <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
                Programs running on your laptop have always inherited your full keyring — the cryptographic equivalent of giving every party guest your house keys because they showed up with the same Uber driver. Harbors are the guest pass. Each agent gets one verb-list, valid for one short window, and nothing more.
              </PanelBody>
            </SurfacePanel>
          }
        />
      }
      pager={
        <SdkPager
          prev={{ title: "Locks", href: "/docs/sdk/locks", label: "Previous module" }}
          next={{ title: "SDK overview", href: "/docs/sdk", label: "Back to index" }}
        />
      }
    >
      <DocsNoteCard label="What harbors are good for" tone="paper" elevation="raised">
        <div className="grid gap-[var(--panel-gap)] md:grid-cols-3">
          {[
            { h: "Create", b: "Stamp a named boundary with a verb-list, an identity allow-list, and a deadline." },
            { h: "Enter", b: "Trade a token for a session that says exactly what the agent may do, and for how long." },
            { h: "Constrain", b: "Issue further-narrowed cards inside the harbor — never broader than the harbor itself." },
          ].map((item) => (
            <Fragment key={item.h}>
              <div className="space-y-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
                <PanelTitle as="h3" size="nav">{item.h}</PanelTitle>
                <PanelBody size="compact" className="max-w-none">{item.b}</PanelBody>
              </div>
            </Fragment>
          ))}
        </div>
      </DocsNoteCard>

      {FUNCTIONS.map((fn, idx) => (
        <SdkFunctionPanel key={fn.name} fn={fn} index={idx} />
      ))}

      <DocsNoteCard label="Security model" title="Why harbors look like this and not like ACLs." tone="blue" titleSize="card">
        <PanelBody tone="primary" className="max-w-[60ch]">
          Harbors are capability-based, not access-list-based. The distinction matters: an ACL says &ldquo;here is a list of who I trust, and what they may do.&rdquo; A capability says &ldquo;here is a token; whoever holds it may do exactly what the token says, until it expires.&rdquo; Capabilities are how Capsicum, Cloudflare Workers&rsquo; sandbox, and the CHERI instruction extensions think about security. Harbors are the same idea at the agent layer.
        </PanelBody>
        <ul className="grid gap-[var(--space-2)]">
          {[
            ["Least privilege", "Agents only get the verbs they ask for, intersected with what the harbor permits."],
            ["Time-bound", "Every harbor and every card has a TTL. There is no \"just this once\" that lives forever."],
            ["Identity-bound", "allowedIdentities is enforced at entry — an identity that does not match never sees the verb-list."],
            ["Auditable", "Every entry, every refusal, every issued card is logged. The trail is the receipt."],
          ].map(([label, body]) => (
            <li key={label} className="grid gap-[var(--space-2)] border-2 border-[color:var(--brand-primary-foreground-subtle)] p-[var(--space-3)] md:grid-cols-[10rem_minmax(0,1fr)]">
              <BracketLabel tone="primary">{label}</BracketLabel>
              <PanelBody tone="primary" size="compact" className="max-w-none">{body}</PanelBody>
            </li>
          ))}
        </ul>
      </DocsNoteCard>

      <SdkTypesPanel code={TYPES} />
    </SdkPageLayout>
  );
}
