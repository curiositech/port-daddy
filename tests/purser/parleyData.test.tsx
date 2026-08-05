import { parleyNodes, parleyEdges } from '@/src/data/parleyData';

describe('parleyData', () => {
  it('contains six nodes with required properties', () => {
    expect(parleyNodes).toHaveLength(6);
    parleyNodes.forEach(node => {
      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('roleLabel');
      expect(node).toHaveProperty('title');
      expect(node).toHaveProperty('position');
      expect(node).toHaveProperty('verdict');
      expect(node).toHaveProperty('icon');
      expect(node).toHaveProperty('hue');
      expect(node).toHaveProperty('x');
      expect(node).toHaveProperty('y');
    });
  });

  it('contains six edges with valid source/target', () => {
    expect(parleyEdges).toHaveLength(6);
    parleyEdges.forEach(edge => {
      expect(edge).toHaveProperty('id');
      expect(edge).toHaveProperty('source');
      expect(edge).toHaveProperty('target');
      expect(edge).toHaveProperty('label');
    });
  });
});