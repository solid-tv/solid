// insertChild/removeChild called directly: the children order, and onRemove,
// for the cases contract-nodes does not cover.
import * as v from 'vitest';
import { ElementNode } from '../src/core/elementNode.ts';

function views(...names: string[]) {
  return names.map((name) => {
    const node = new ElementNode('view');
    node.id = name;
    return node;
  });
}

const ids = (parent: ElementNode) => parent.children.map((c) => c.id);

v.describe('child list', () => {
  v.test('re-inserting a child without an anchor moves it to the end', () => {
    const [parent, a, b, c] = views('parent', 'a', 'b', 'c') as [
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
    ];
    parent.insertChild(a);
    parent.insertChild(b);
    parent.insertChild(c);
    parent.insertChild(a);
    v.expect(ids(parent)).toEqual(['b', 'c', 'a']);
    parent.insertChild(a);
    v.expect(ids(parent)).toEqual(['b', 'c', 'a']);
  });

  v.test('moves forward, backward, to the front, and before itself', () => {
    const [parent, a, b, c, d] = views('parent', 'a', 'b', 'c', 'd') as [
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
    ];
    for (const n of [a, b, c, d]) parent.insertChild(n);

    parent.insertChild(a, d); // forward
    v.expect(ids(parent)).toEqual(['b', 'c', 'a', 'd']);
    parent.insertChild(d, b); // to the front
    v.expect(ids(parent)).toEqual(['d', 'b', 'c', 'a']);
    parent.insertChild(a, b); // backward
    v.expect(ids(parent)).toEqual(['d', 'a', 'b', 'c']);
    parent.insertChild(b, b); // before itself: appended
    v.expect(ids(parent)).toEqual(['d', 'a', 'c', 'b']);
  });

  v.test('moving a child from another parent', () => {
    const [p1, p2, a, b, c] = views('p1', 'p2', 'a', 'b', 'c') as [
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
    ];
    const removed: string[] = [];
    a.onRemove = (n) => {
      removed.push(n.id!);
    };
    p1.insertChild(a);
    p1.insertChild(b);
    p2.insertChild(c);
    p2.insertChild(a, c);
    v.expect(ids(p1)).toEqual(['b']);
    v.expect(ids(p2)).toEqual(['a', 'c']);
    v.expect(a.parent).toBe(p2);
    v.expect(removed).toEqual(['a']);
  });

  v.test('removeChild removes the first, middle or last child once', () => {
    const [parent, a, b, c, d, stranger] = views(
      'parent',
      'a',
      'b',
      'c',
      'd',
      'stranger',
    ) as [
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
      ElementNode,
    ];
    const removed: string[] = [];
    const onRemove = (n: ElementNode) => {
      removed.push(n.id!);
    };
    for (const n of [a, b, c, d]) {
      n.onRemove = onRemove;
      parent.insertChild(n);
    }

    parent.removeChild(b);
    v.expect(ids(parent)).toEqual(['a', 'c', 'd']);
    parent.removeChild(d);
    v.expect(ids(parent)).toEqual(['a', 'c']);
    parent.removeChild(a);
    v.expect(ids(parent)).toEqual(['c']);

    // Not a child (any more): nothing changes and onRemove does not run.
    parent.removeChild(a);
    parent.removeChild(stranger);
    v.expect(ids(parent)).toEqual(['c']);
    v.expect(removed).toEqual(['b', 'd', 'a']);
  });
});
