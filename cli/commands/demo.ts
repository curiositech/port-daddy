/**
 * Demo Command — High-Fidelity Storytelling
 */

import { Command } from 'commander';
import { status as maritimeStatus, ANSI } from '../../lib/maritime.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function handleDemo(subcommand?: string, options: any = {}) {
  switch (subcommand) {
    case 'mayday':
      console.log(`\n${ANSI.bgRed}${ANSI.fgWhite}  CRITICAL ALERT: MEMORY LEAK DETECTED  ${ANSI.reset}`);
      await delay(1000);
      console.log(maritimeStatus('error', 'Agent coder-1 is flatlining...'));
      await delay(800);
      console.log(`${ANSI.fgCyan}SIGNAL:${ANSI.reset} Broadcasting ${ANSI.fgRed}MAYDAY${ANSI.reset} on channel 'security:alerts'`);
      console.log(`$ pd pub security:alerts "FATAL_OOM" --signal mayday`);
      await delay(1500);
      console.log(`\n${ANSI.fgGreen}REACTION:${ANSI.reset} Watcher 'Arbiter' smelled the pheromone.`);
      console.log(`${ANSI.fgGray}Executing: ./scripts/rollback-safely.sh${ANSI.reset}`);
      await delay(1000);
      console.log(maritimeStatus('success', 'Harbor stabilized. Rogue PID purged.'));
      break;

    case 'salvage':
      console.log(`\n${ANSI.fgGray}# Searching for dead agents in 'myapp:api'...${ANSI.reset}`);
      await delay(1200);
      console.log(`${ANSI.fgYellow}ZOMBIE FOUND:${ANSI.reset} agent-alpha-99 (Last seen 45m ago)`);
      console.log(`${ANSI.fgGray}Notes found: "Implementing auth-v2", "JWT logic 90% done"${ANSI.reset}`);
      await delay(1500);
      console.log(`\n${ANSI.fgCyan}ACTION:${ANSI.reset} Claiming context...`);
      console.log(`$ pd salvage claim agent-alpha-99 --as agent-bravo-01`);
      await delay(1000);
      console.log(maritimeStatus('success', 'Context merged. Agent Bravo is now the designated survivor.'));
      break;

    case 'auction':
      console.log(`\n${ANSI.fgCyan}CONCEPT GRAPH:${ANSI.reset} Node 'goal:optimize-db' is active.`);
      await delay(1000);
      console.log(`${ANSI.fgMagenta}PHEROMONES:${ANSI.reset} Agent-1 sprayed 0.4 scent...`);
      await delay(800);
      console.log(`${ANSI.fgMagenta}PHEROMONES:${ANSI.reset} Agent-2 sprayed 0.9 scent (HIGH INTEREST)`);
      await delay(1500);
      console.log(`\n${ANSI.fgYellow}AUCTION WON:${ANSI.reset} Agent-2 is locking the resource.`);
      console.log(`$ pd lock acquire db:optimization --agent agent-2`);
      await delay(1000);
      console.log(maritimeStatus('success', 'Resource locked. Swarm converged.'));
      break;

    default:
      console.log('Usage: pd demo <mayday | salvage | auction>');
      break;
  }
}

export function registerDemoCommand(program: Command) {
  program
    .command('demo <scenario>')
    .description('Run high-fidelity coordination scenarios')
    .action(handleDemo);
}
