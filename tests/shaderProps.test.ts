// The shader props a border or shadow object writes: on a node that is not
// rendered yet they collect in a plain bag (`node.lng.shader`), so the keys,
// their values and their order can be read back.
import * as v from 'vitest';
import { ElementNode } from '../src/core/elementNode.ts';

const bagOf = (node: ElementNode) =>
  node.lng.shader as unknown as Record<string, unknown>;

v.describe('border and shadow shader props', () => {
  v.test('border: `border` plus one `border-<key>` per key, width as w', () => {
    const node = new ElementNode('view');
    const border = { color: 0xff0000ff, width: 2, gap: 4 };
    node.border = border;
    const bag = bagOf(node);
    v.expect(Object.keys(bag)).toEqual([
      'border',
      'border-color',
      'border-w',
      'border-gap',
    ]);
    v.expect(bag.border).toBe(border);
    v.expect(bag['border-color']).toBe(0xff0000ff);
    v.expect(bag['border-w']).toBe(2);
    v.expect(bag['border-gap']).toBe(4);
  });

  v.test('a border side writes its width or w as the side', () => {
    const node = new ElementNode('view');
    node.borderTop = { width: 3, color: 0x00ff00ff };
    node.borderLeft = { w: 5 } as never;
    const bag = bagOf(node);
    v.expect(Object.keys(bag)).toEqual([
      'border',
      'border-top',
      'border-color',
      'border-left',
    ]);
    v.expect(bag.border).toEqual({ w: 5 });
    v.expect(bag['border-top']).toBe(3);
    v.expect(bag['border-left']).toBe(5);
    v.expect(bag['border-color']).toBe(0x00ff00ff);
  });

  v.test('shadow and effects write the same names', () => {
    const node = new ElementNode('view');
    node.effects = {
      border: { color: 0x0000ffff, width: 1 },
      shadow: { color: 0x000000ff, blur: 8, spread: 2, x: 1, y: 3 },
    };
    v.expect(bagOf(node)).toEqual({
      border: { color: 0x0000ffff, width: 1 },
      'border-color': 0x0000ffff,
      'border-w': 1,
      shadow: { color: 0x000000ff, blur: 8, spread: 2, x: 1, y: 3 },
      'shadow-color': 0x000000ff,
      'shadow-blur': 8,
      'shadow-spread': 2,
      'shadow-x': 1,
      'shadow-y': 3,
    });
  });

  v.test('only own keys are written, inherited ones are not', () => {
    const node = new ElementNode('view');
    const border = Object.create({ color: 0xffffffff }) as { width: number };
    border.width = 6;
    node.border = border;
    v.expect(Object.keys(bagOf(node))).toEqual(['border', 'border-w']);
  });

  v.test(
    'an object changed in place and written again writes its new values',
    () => {
      const node = new ElementNode('view');
      const border = { color: 0xff0000ff, width: 2 };
      node.border = border;
      border.color = 0x00ff00ff;
      border.width = 7;
      node.border = border;
      v.expect(bagOf(node)['border-color']).toBe(0x00ff00ff);
      v.expect(bagOf(node)['border-w']).toBe(7);
    },
  );
});
