/**
 * Tests for `lib/discourse-lineage.ts` — the argument graph over a typed tube
 * conversation (RCP-14 argumentative lineage). Pure functions; no daemon.
 */

import { describe, test, expect } from '@jest/globals';
import {
  buildLineage,
  summarizeThread,
  lineageEdges,
  renderLineageTree,
} from '../../lib/discourse-lineage.js';
import type { TubeMessage } from '../../lib/tube.js';

/** Minimal TubeMessage factory — fills the required fields, spreads the rest. */
function msg(partial: Partial<TubeMessage> & { id: number }): TubeMessage {
  return {
    sender: 'a',
    createdAt: partial.id, // deterministic, monotone with id
    body: `body ${partial.id}`,
    envelope: true,
    raw: null,
    ...partial,
  };
}

describe('buildLineage', () => {
  test('wires parent/child edges and depth from inReplyTo', () => {
    const g = buildLineage([
      msg({ id: 1, body: 'root claim' }),
      msg({ id: 2, inReplyTo: 1, relationship: 'supports' }),
      msg({ id: 3, inReplyTo: 2, relationship: 'extends' }),
    ]);
    expect(g.roots).toEqual([1]);
    expect(g.nodes.get(1)!.childIds).toEqual([2]);
    expect(g.nodes.get(2)!.parentId).toBe(1);
    expect(g.nodes.get(1)!.depth).toBe(0);
    expect(g.nodes.get(2)!.depth).toBe(1);
    expect(g.nodes.get(3)!.depth).toBe(2);
  });

  test('is order-independent: a child before its parent still links', () => {
    const g = buildLineage([
      msg({ id: 5, inReplyTo: 4, relationship: 'contradicts' }),
      msg({ id: 4, body: 'the claim' }),
    ]);
    expect(g.roots).toEqual([4]);
    expect(g.nodes.get(4)!.childIds).toEqual([5]);
    expect(g.nodes.get(5)!.depth).toBe(1);
  });

  test('an inReplyTo pointing outside the set is dangling, and the node is a root', () => {
    const g = buildLineage([msg({ id: 9, inReplyTo: 2, relationship: 'narrows' })]);
    expect(g.roots).toEqual([9]);
    expect(g.nodes.get(9)!.parentId).toBeUndefined();
    expect(g.nodes.get(9)!.danglingParentId).toBe(2);
  });

  test('sets conversationId when all messages share one, leaves it unset when mixed', () => {
    const shared = buildLineage([
      msg({ id: 1, conversationId: 'cv' }),
      msg({ id: 2, inReplyTo: 1, conversationId: 'cv' }),
    ]);
    expect(shared.conversationId).toBe('cv');

    const mixed = buildLineage([
      msg({ id: 1, conversationId: 'cv' }),
      msg({ id: 2, conversationId: 'other' }),
    ]);
    expect(mixed.conversationId).toBeUndefined();
  });

  test('multiple roots form a forest', () => {
    const g = buildLineage([msg({ id: 1 }), msg({ id: 2 }), msg({ id: 3, inReplyTo: 1 })]);
    expect(g.roots).toEqual([1, 2]);
  });

  test('empty input yields an empty graph', () => {
    const g = buildLineage([]);
    expect(g.nodes.size).toBe(0);
    expect(g.roots).toEqual([]);
  });
});

describe('lineageEdges', () => {
  test('returns only typed child→parent edges', () => {
    const g = buildLineage([
      msg({ id: 1 }),
      msg({ id: 2, inReplyTo: 1, relationship: 'supports', sender: 'b' }),
      msg({ id: 3, inReplyTo: 1 }), // reply with NO relationship → not an edge
    ]);
    expect(lineageEdges(g)).toEqual([
      { from: 2, to: 1, sender: 'b', relationship: 'supports' },
    ]);
  });
});

describe('summarizeThread', () => {
  test('tallies relationships, performatives, participants and depth', () => {
    const g = buildLineage([
      msg({ id: 1, sender: 'alice', performative: 'propose', body: 'do X' }),
      msg({ id: 2, sender: 'bob', inReplyTo: 1, relationship: 'supports', performative: 'inform' }),
      msg({ id: 3, sender: 'carol', inReplyTo: 1, relationship: 'contradicts' }),
    ]);
    const d = summarizeThread(g);
    expect(d.total).toBe(3);
    expect(d.participants).toEqual(['alice', 'bob', 'carol']);
    expect(d.maxDepth).toBe(1);
    expect(d.byRelationship.supports).toBe(1);
    expect(d.byRelationship.contradicts).toBe(1);
    expect(d.byRelationship.extends).toBe(0);
    expect(d.byPerformative).toEqual({ propose: 1, inform: 1 });
    expect(d.typed).toBe(true);
  });

  test('flags contradictions; a later synthesizes on the same target resolves it', () => {
    const unresolved = summarizeThread(buildLineage([
      msg({ id: 1, body: 'claim' }),
      msg({ id: 2, inReplyTo: 1, relationship: 'contradicts', sender: 'b' }),
    ]));
    expect(unresolved.contradictions).toHaveLength(1);
    expect(unresolved.unresolvedContradictions).toHaveLength(1);

    const resolved = summarizeThread(buildLineage([
      msg({ id: 1, body: 'claim' }),
      msg({ id: 2, inReplyTo: 1, relationship: 'contradicts', sender: 'b' }),
      msg({ id: 3, inReplyTo: 1, relationship: 'synthesizes', sender: 'c' }),
    ]));
    expect(resolved.contradictions).toHaveLength(1);
    expect(resolved.unresolvedContradictions).toHaveLength(0);
  });

  test('an untyped thread reports typed=false', () => {
    const d = summarizeThread(buildLineage([msg({ id: 1 }), msg({ id: 2, inReplyTo: 1 })]));
    expect(d.typed).toBe(false);
    expect(d.contradictions).toEqual([]);
  });
});

describe('renderLineageTree', () => {
  test('indents by depth and shows the typed move', () => {
    const tree = renderLineageTree(buildLineage([
      msg({ id: 1, sender: 'alice', performative: 'propose', body: 'do X' }),
      msg({ id: 2, sender: 'bob', inReplyTo: 1, relationship: 'contradicts', body: 'no because Y' }),
    ]));
    const lines = tree.split('\n');
    expect(lines[0]).toBe('#1 alice [act=propose]: do X');
    expect(lines[1]).toBe('  #2 bob [contradicts]: no because Y');
  });

  test('marks a dangling parent', () => {
    const tree = renderLineageTree(buildLineage([msg({ id: 9, inReplyTo: 2, body: 'orphan' })]));
    expect(tree).toContain('↩(2, outside window)');
  });
});
