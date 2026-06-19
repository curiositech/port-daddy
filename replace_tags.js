import fs from 'fs';
import path from 'path';

const files = [
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/ui/Card.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/ui/Mermaid.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/ui/CodeBlock.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/Nav.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/AgentEcosystem.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/MaturitySection.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/HowItWorks.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/DemoGallery.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/HarborsSection.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/HarborViz.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/CTABanner.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/landing/TerminalReplay.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/blueprints/BlueprintsSection.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/layout/Footer.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/viz/LiveOrchestrationGraph.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/components/tutorials/TutorialLayout.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/TutorialsPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/blueprints/TemplatePage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/MCPPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/ExamplesPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/cookbook/CookbookPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/cookbook/RecipePage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/integrations/IntegrationPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/integrations/IntegrationsPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/BlogPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/BlogPostPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/DNSResolver.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/SessionPhases.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Sugar.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Monorepo.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Watch.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Dashboard.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/MultiAgentOrchestration.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Inbox.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Tunnel.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Debugging.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/GettingStarted.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/AlwaysOn.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Pipelines.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Harbors.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/RemoteHarbors.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/Spawn.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/tutorials/TimeTravel.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/DocsPage.tsx',
  '/Users/erichowens/coding/port-daddy/website-v2/src/pages/DashboardPage.tsx'
];

const tags = ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4'];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;
  let modified = false;

  tags.forEach(tag => {
    // Opening tag: <tag followed by space, slash or >
    const openRegex = new RegExp(`<(${tag})(\\s|/|>)`, 'g');
    if (openRegex.test(content)) {
      content = content.replace(openRegex, `<motion.$1$2`);
      modified = true;
    }

    // Closing tag: </tag>
    const closeRegex = new RegExp(`</(${tag})>`, 'g');
    if (closeRegex.test(content)) {
      content = content.replace(closeRegex, `</motion.$1>`);
      modified = true;
    }
  });

  if (modified) {
    if (!content.includes("from 'framer-motion'") && !content.includes('from "framer-motion"')) {
      // Add import at the top
      content = `import { motion } from 'framer-motion';\n` + content;
    }
    fs.writeFileSync(file, content);
    console.log(`Modified: ${file}`);
  }
});
