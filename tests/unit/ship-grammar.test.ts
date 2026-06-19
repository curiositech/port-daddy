import {
  buildShip,
  countShipVowels,
  hashShipFleet,
  renderShipSvgFragment,
} from '../../fleet-config-ui/src/ships/ship-grammar.js';

describe('Shipwright ship grammar', () => {
  test('buildShip is deterministic for the same identity', () => {
    const first = buildShip('port-daddy:fleet:spark');
    const second = buildShip('port-daddy:fleet:spark');

    expect(second).toEqual(first);
    expect(first.metrics.L_a).toBe(5);
    expect(first.metrics.V_a).toBe(1);
    expect(first.metrics.C_a).toBe(4);
  });

  test('same agent keeps silhouette while fleet changes livery inputs', () => {
    const portDaddy = buildShip('port-daddy:fleet:spark');
    const expungementGuide = buildShip('expungement-guide:fleet:spark');

    expect(portDaddy.mainframe.w).toBe(expungementGuide.mainframe.w);
    expect(portDaddy.mainframe.d).toBe(expungementGuide.mainframe.d);
    expect(portDaddy.clusters).toHaveLength(expungementGuide.clusters.length);
    expect(portDaddy.metrics.H_f).not.toBe(expungementGuide.metrics.H_f);
  });

  test('y only counts as a vowel after a consonant', () => {
    expect(countShipVowels('sentry')).toBe(2);
    expect(countShipVowels('yak')).toBe(1);
  });

  test('fleet hash includes hyphens so drift does not collapse', () => {
    expect(hashShipFleet('port-daddy')).not.toBe(hashShipFleet('portdaddy'));
  });

  test('invalid identities fail closed', () => {
    expect(() => buildShip('spark')).toThrow(/Expected <fleet>:fleet:<agent>/);
    expect(() => buildShip('port-daddy:fleet:Spark')).toThrow(/Expected <fleet>:fleet:<agent>/);
  });

  test('SVG fallback emits deterministic geometry', () => {
    const plan = buildShip('port-daddy:fleet:hawk');
    const fragment = renderShipSvgFragment(plan, { scale: 2 });

    expect(fragment).toContain('<rect');
    expect(fragment).toContain('<polygon');
    expect(fragment).toContain(plan.metrics.colorPrimary);
  });
});
