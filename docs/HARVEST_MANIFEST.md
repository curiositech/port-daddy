# Port Daddy Divergent Universe Manifest
Scanning .claude/worktrees for unique features...
## Universe: agent-a170fd8c
```
4627b4e feat: Inbox + Changelog SDK methods, pd inbox top-level CLI
bb67a5f fix: Allow zero latency in health check test (fast CI runners)
0bb5715 fix: CI/CD fixes and website UX improvements
 bin/port-daddy-cli.ts  |   9 +-
 cli/commands/inbox.ts  | 164 ++++++++++++++++++++++++++++++++++
 cli/commands/index.ts  |   1 +
 features.manifest.json |  15 +++-
 lib/client.ts          | 234 +++++++++++++++++++++++++++++++++++++++++++++++++
 5 files changed, 418 insertions(+), 5 deletions(-)
```
## Universe: agent-a2bd615f
```
24b6e9c feat: pd spawn + pd watch — AI agent launcher and ambient trigger kernel
ac5c719 feat: sky toggle dark mode switch in nav (portdaddy.dev)
c2cc9f1 fix: resolve 4 integration test failures in cli.test.js
 bin/port-daddy-cli.ts       |  17 ++
 cli/commands/index.ts       |   1 +
 cli/commands/spawn.ts       | 305 +++++++++++++++++++++++++++++++
 completions/port-daddy.bash |  63 +++++++
 completions/port-daddy.fish |  21 ++-
 completions/port-daddy.zsh  |  63 +++++++
 features.manifest.json      |  40 ++++
 lib/client.ts               |  91 ++++++++++
 lib/spawner.ts              | 434 ++++++++++++++++++++++++++++++++++++++++++++
 lib/watch.ts                | 174 ++++++++++++++++++
 routes/index.ts             |   2 +
 routes/spawn.ts             | 142 +++++++++++++++
 12 files changed, 1352 insertions(+), 1 deletion(-)
```
## Universe: agent-a3a9f8fd
```
45c485e Last commit before timeout
f7b611d fix(website-v2): global heading font Space Grotesk, tighter Harbors spacing
f3e768f feat(website-v2): docs overhaul, Examples page, Space Grotesk, hero changelog panel
 .gitignore                                         |   10 +
 LICENSE                                            |   25 +-
 docs/ROADMAP.md                                    |  109 +-
 lib/activity.ts                                    |   35 +-
 lib/agent-inbox.ts                                 |   49 +-
 lib/agents.ts                                      |   15 +-
 lib/messaging.ts                                   |   66 +-
 lib/orchestrator.ts                                |  297 +--
 package-lock.json                                  |   31 +-
 package.json                                       |    3 +-
 pd_logo.svg                                        |   98 +
 pd_logo.svg.bak                                    |   98 +
 pd_logo_darkmode.svg                               |   66 +
 pd_logo_darkmode.svg.bak                           |   66 +
 research/multi-agent-patterns.md                   |    4 +-
 routes/activity.ts                                 |  123 +-
 routes/agents.ts                                   |    3 +-
 server.ts                                          |    7 +
 website-v2/index.html                              |    2 +-
 website-v2/package-lock.json                       | 1343 +++++++++++-
 website-v2/package.json                            |   12 +-
 {website => website-v2/public}/css/shared.css      |    0
 {website => website-v2/public}/js/theme.js         |    0
 website-v2/public/pd_logo.svg                      |   98 +
 website-v2/public/pd_logo_darkmode.svg             |   97 +
 website-v2/src/App.tsx                             |   35 +-
 website-v2/src/components/landing/CTABanner.tsx    |    2 +-
 website-v2/src/components/landing/DemoGallery.tsx  |  240 +--
 website-v2/src/components/landing/Features.tsx     |   84 +-
 website-v2/src/components/landing/HarborViz.tsx    |   12 +-
 .../src/components/landing/HarborsSection.tsx      |  356 ++--
 website-v2/src/components/landing/Hero.tsx         |  538 +++--
 website-v2/src/components/landing/HowItWorks.tsx   |    4 +-
 website-v2/src/components/landing/Nav.tsx          |   36 +-
 website-v2/src/components/ui/CodeBlock.tsx         |  132 +-
 website-v2/src/index.css                           |   28 +-
 website-v2/src/main.tsx                            |   31 +-
 website-v2/src/pages/DocsPage.tsx                  | 1221 +++++------
 website-v2/src/pages/MCPPage.tsx                   |  319 +++
 website-v2/src/pages/TutorialsPage.tsx             |  329 ++-
 website-v2/src/pages/tutorials/Harbors.tsx         |  153 ++
 website-v2/src/pages/tutorials/Watch.tsx           |  122 ++
 website-v2/src/styles/tokens.css                   |   24 +-
 website-v2/vite.config.ts                          |    6 +
 website/README.md                                  |   50 -
 website/_redirects                                 |    5 -
 .../content/ADVERSARIAL_FINDINGS_CODE_LOCATIONS.md |  247 ---
 .../content/ADVERSARIAL_TESTING_DELIVERABLES.md    |  391 ----
 website/content/ADVERSARIAL_TESTING_INDEX.md       |  309 ---
 website/content/ADVERSARIAL_TESTING_README.md      |  324 ---
 website/content/ADVERSARIAL_TESTING_SUMMARY.md     |  211 --
 .../content/ADVERSARIAL_TESTING_VERIFICATION.txt   |  343 ---
 website/content/ADVERSARIAL_TEST_SUITE_GUIDE.md    |  445 ----
 website/content/adversarial-test-report.md         |  405 ----
 website/content/product-appeal-analysis.md         |  343 ---
 website/content/tutorials/01-getting-started.md    |  314 ---
 .../tutorials/02-multi-agent-orchestration.md      |  488 -----
 website/content/tutorials/03-tunnel-magic.md       |  447 ----
 website/content/tutorials/04-monorepo-mastery.md   |  467 -----
 .../tutorials/05-debugging-with-port-daddy.md      |  546 -----
 website/content/tutorials/06-dns-resolver.md       |   64 -
 website/content/tutorials/07-sugar-commands.md     |   57 -
 website/content/tutorials/08-session-phases.md     |   59 -
 website/content/tutorials/09-inbox-messaging.md    |  232 ---
 website/content/tutorials/README.md                |  198 --
 website/content/ux-friction-analysis.md            |  319 ---
 website/docs/api.html                              | 2193 --------------------
 website/docs/index.html                            |  608 ------
 website/images/battleships.png                     |  Bin 945516 -> 0 bytes
 website/images/coordination.png                    |  Bin 340739 -> 0 bytes
 website/images/dashboard-screenshot.png            |  Bin 1227222 -> 0 bytes
 website/images/ethernet-ropes.png                  |  Bin 1917970 -> 0 bytes
 website/images/features/ai-agent-native.png        |  Bin 1208346 -> 0 bytes
 website/images/features/atomic-port.png            |  Bin 1209984 -> 0 bytes
 website/images/features/auto-cleanup.png           |  Bin 1537349 -> 0 bytes
 website/images/features/auto-detection.png         |  Bin 1501643 -> 0 bytes
 website/images/features/distributed-locks.png      |  Bin 1526268 -> 0 bytes
 website/images/features/pub-sub-messaging.png      |  Bin 1433344 -> 0 bytes
 website/images/features/semantic-identities.png    |  Bin 1598352 -> 0 bytes
 website/images/features/service-orchestration.png  |  Bin 1527985 -> 0 bytes
 website/images/features/web-dashboard.png          |  Bin 1447992 -> 0 bytes
 website/images/harbor-master.png                   |  Bin 1510934 -> 0 bytes
 website/images/hero.png                            |  Bin 1351831 -> 0 bytes
 website/images/logos/angular.svg                   |    5 -
 website/images/logos/astro.svg                     |   10 -
 website/images/logos/express.svg                   |    0
 website/images/logos/nextjs.svg                    |    5 -
 website/images/logos/nuxt.svg                      |    9 -
 website/images/logos/react.svg                     |    0
 website/images/logos/remix.svg                     |   11 -
 website/images/logos/svelte.svg                    |    4 -
 website/images/logos/sveltekit.svg                 |    6 -
 website/images/logos/vite.svg                      |   10 -
 website/images/logos/vue.svg                       |    4 -
 website/images/og-image.png                        |  Bin 780692 -> 0 bytes
 website/img/demo-agents.gif                        |  Bin 533103 -> 0 bytes
 website/img/demo-fleet.gif                         |  Bin 1025073 -> 0 bytes
 website/index.html                                 |  431 ----
 website/mcp/index.html                             |  548 -----
 website/tutorials/09-inbox-messaging.html          |  401 ----
 website/tutorials/debugging.html                   |  600 ------
 website/tutorials/dns-resolver.html                |  398 ----
 website/tutorials/getting-started.html             |  316 ---
 website/tutorials/index.html                       |  210 --
 website/tutorials/monorepo-mastery.html            |  650 ------
 website/tutorials/multi-agent-orchestration.html   |  434 ----
 website/tutorials/session-phases.html              |  498 -----
 website/tutorials/sugar-commands.html              |  146 --
 website/tutorials/tunnel-magic.html                |  425 ----
 109 files changed, 4384 insertions(+), 16131 deletions(-)
```
## Universe: agent-a664ef3d
```
22de702 feat: expand tutorial stubs — DNS resolver + session phases full rewrites
ac5c719 feat: sky toggle dark mode switch in nav (portdaddy.dev)
c2cc9f1 fix: resolve 4 integration test failures in cli.test.js
 website/tutorials/dns-resolver.html   | 333 +++++++++++++++++++++---
 website/tutorials/session-phases.html | 458 +++++++++++++++++++++++++++++-----
 2 files changed, 695 insertions(+), 96 deletions(-)
```
## Universe: agent-a6700bc3
```
60b4a1d docs: Inbox + Changelog docs, tutorial lesson 13, inbox examples, website tutorial 09
bb67a5f fix: Allow zero latency in health check test (fast CI runners)
0bb5715 fix: CI/CD fixes and website UX improvements
 README.md                                       |  79 +++
 cli/commands/tutorial.ts                        | 679 ++++++++++++++++++++++++
 docs/sdk.md                                     |  99 ++++
 examples/inbox/README.md                        |  44 ++
 examples/inbox/agent-dm.sh                      |  61 +++
 examples/inbox/inbox-monitor.ts                 |  42 ++
 website/content/tutorials/09-inbox-messaging.md | 232 ++++++++
 website/tutorials/09-inbox-messaging.html       | 396 ++++++++++++++
 website/tutorials/index.html                    |  15 +-
 9 files changed, 1646 insertions(+), 1 deletion(-)
```
## Universe: agent-a7ba4b3b
```
bb67a5f fix: Allow zero latency in health check test (fast CI runners)
0bb5715 fix: CI/CD fixes and website UX improvements
4b388bd feat: Build multipage website with tutorials, MCP docs, and docs hub
 completions/port-daddy.bash | 43 +++++++++++++++++++++++++++++++++++++++++
 completions/port-daddy.fish | 15 ++++++++++++++-
 completions/port-daddy.zsh  | 47 +++++++++++++++++++++++++++++++++++++++++++++
 public/index.html           |  2 ++
 tests/unit/health.test.js   |  2 +-
 5 files changed, 107 insertions(+), 2 deletions(-)
```
## Universe: agent-a89438d5
```
3a18048 feat: API reference page — full endpoint docs with search
ac5c719 feat: sky toggle dark mode switch in nav (portdaddy.dev)
c2cc9f1 fix: resolve 4 integration test failures in cli.test.js
 website/docs/api.html   | 2193 +++++++++++++++++++++++++++++++++++++++++++++++
 website/docs/index.html |  119 ++-
 2 files changed, 2309 insertions(+), 3 deletions(-)
```
