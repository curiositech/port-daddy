import { describe, expect, test } from '@jest/globals';
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FleetControlView } from '../../fleet-config-ui/src/shipwright/FleetControlView.tsx';
import { FocusView } from '../../fleet-config-ui/src/shipwright/FocusView.tsx';
import { HarborView } from '../../fleet-config-ui/src/shipwright/HarborView.tsx';
import { SimulationView } from '../../fleet-config-ui/src/shipwright/SimulationView.tsx';
import {
  labelForSubview,
  normalizeShipwrightSubview,
  shipIdentityForAgent,
  shipIdentityForSurvey,
} from '../../fleet-config-ui/src/shipwright/helpers.ts';
import {
  fixtureProposal,
  fixtureSimulation,
  fixtureSurveys,
} from '../../fleet-config-ui/src/shipwright/fixtures.ts';
import type {
  ProjectSurvey,
  ShipwrightDataResult,
  ShipwrightProposal,
  SimulationState,
} from '../../fleet-config-ui/src/shipwright/types.ts';

type HostElement = ReactElement<Record<string, unknown>, string>;
type ComponentElement = ReactElement<Record<string, unknown>, (props: Record<string, unknown>) => ReactNode>;

const surveysResult: ShipwrightDataResult<ProjectSurvey[]> = {
  data: fixtureSurveys,
  fixture: true,
  source: 'fixture',
};

const proposalResult: ShipwrightDataResult<ShipwrightProposal> = {
  data: fixtureProposal,
  fixture: true,
  source: 'fixture',
};

const simulationResult: ShipwrightDataResult<SimulationState> = {
  data: fixtureSimulation,
  fixture: true,
  source: 'fixture',
};

const hookBackedComponents = new Set(['AgentCardThumbnail', 'AgentShip', 'AgentShipStrip']);

function expandComponent(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>, unknown>;
  if (typeof element.type !== 'function') return node;
  const typeName = element.type.name;
  if (hookBackedComponents.has(typeName)) return null;
  return expandComponent((element as ComponentElement).type(element.props));
}

function textOf(node: ReactNode): string {
  const expanded = expandComponent(node);
  if (expanded == null || typeof expanded === 'boolean') return '';
  if (typeof expanded === 'string' || typeof expanded === 'number') return String(expanded);
  if (Array.isArray(expanded)) return expanded.map(textOf).join(' ');
  if (!isValidElement(expanded)) return '';
  return textOf((expanded as ReactElement<{ children?: ReactNode }>).props.children);
}

function hostElements(
  node: ReactNode,
  predicate: (element: HostElement) => boolean,
): HostElement[] {
  const expanded = expandComponent(node);
  if (expanded == null || typeof expanded === 'boolean' || typeof expanded === 'string' || typeof expanded === 'number') {
    return [];
  }
  if (Array.isArray(expanded)) return expanded.flatMap((child) => hostElements(child, predicate));
  if (!isValidElement(expanded)) return [];

  const element = expanded as ReactElement<{ children?: ReactNode }, unknown>;
  const matched = typeof element.type === 'string' && predicate(element as HostElement) ? [element as HostElement] : [];
  return matched.concat(hostElements(element.props.children, predicate));
}

describe('Shipwright view components', () => {
  test('normalizes URL subview names and ship identities deterministically', () => {
    expect(normalizeShipwrightSubview('simulation')).toBe('simulation');
    expect(normalizeShipwrightSubview('ship-debug')).toBe('harbor');
    expect(normalizeShipwrightSubview(null)).toBe('harbor');
    expect(labelForSubview('control')).toBe('FleetControl');
    expect(shipIdentityForSurvey(fixtureSurveys[0])).toBe('port-daddy:fleet:harbor');
    expect(shipIdentityForAgent('Port Daddy', fixtureProposal.fleet.agents[0])).toBe('port-daddy:fleet:qa-sentinel');
  });

  test('Harbor view renders hard-card survey tiles and focus action', () => {
    let focusedProject: string | null = null;
    const tree = createElement(HarborView, {
      surveys: surveysResult,
      onFocusProject: (survey: ProjectSurvey) => {
        focusedProject = survey.project;
      },
    });

    const text = textOf(tree);
    expect(text).toContain('Surveyed projects');
    expect(text).toContain('port-daddy');
    expect(text).toMatch(/120\s+commits/);
    expect(text).toContain('Fixture data');

    const hardCards = hostElements(tree, (element) => {
      const style = element.props.style as Record<string, unknown> | undefined;
      return style?.boxShadow === '5px 5px 0 #000' && style?.borderRadius === 0;
    });
    expect(hardCards).toHaveLength(fixtureSurveys.length);

    const buttons = hostElements(tree, (element) => element.type === 'button');
    expect(buttons[0].props.type).toBe('button');
    (buttons[0].props.onClick as () => void)();
    expect(focusedProject).toBe('port-daddy');
  });

  test('Focus, Simulation, and FleetControl views render proposal evidence', () => {
    const focusText = textOf(createElement(FocusView, {
      survey: fixtureSurveys[0],
      proposal: proposalResult,
    }));
    expect(focusText).toContain('Bounded search result');
    expect(focusText).toContain('qa-sentinel');
    expect(focusText).toContain('$5.00');

    const simulationText = textOf(createElement(SimulationView, {
      proposal: proposalResult,
      simulation: simulationResult,
    }));
    expect(simulationText).toContain('TIMELINE');
    expect(simulationText).toContain('file.write');
    expect(simulationText).toContain('docs/shipwright/INTEGRATION-PLAN.md');

    const controlText = textOf(createElement(FleetControlView, {
      proposal: proposalResult,
      simulation: simulationResult,
    }));
    expect(controlText).toContain('DRY-RUN VERDICT');
    expect(controlText).toContain('Clean rehearsal');
    expect(controlText).toContain('$1.00');
  });
});
