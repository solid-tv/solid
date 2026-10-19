// The shader props a border or shadow object writes: on a node that is not
// attached yet they collect in `_shaderProps` (the raw object under its
// accessor name, then one flattened facade key per key), so the keys, their
// values and their order can be read back. The facade keys are renderer
// 2.1's (`border-width`, not 1.x's `border-w`).
import * as v from 'vitest';
import { RendererCore } from '@solidtv/renderer';
import { ElementNode } from '../src/core/node/ElementNode.ts';
import { NodeType } from '../src/core/nodeTypes.ts';

const core = new RendererCore({ appWidth: 640, appHeight: 360 });
const view = () => new ElementNode(core, NodeType.Element);
const bagOf = (node: ElementNode) => node._shaderProps!;

v.describe('border and shadow shader props', () => {
  v.test('border: `border` plus one `border-<key>` per key', () => {
    const node = view();
    const border = { color: 0xff0000ff, width: 2, gap: 4 };
    node.border = border;
    const bag = bagOf(node);
    v.expect(Object.keys(bag)).toEqual([
      'border',
      'border-color',
      'border-width',
      'border-gap',
    ]);
    v.expect(bag.border).toBe(border);
    v.expect(bag['border-color']).toBe(0xff0000ff);
    v.expect(bag['border-width']).toBe(2);
    v.expect(bag['border-gap']).toBe(4);
  });

  v.test('a border side writes its width or w as the side', () => {
    const node = view();
    node.borderTop = { width: 3, color: 0x00ff00ff };
    node.borderLeft = { w: 5 } as never;
    const bag = bagOf(node);
    // Each raw object under its own accessor name (2.0: 1.x kept one
    // `border` entry, the last side written).
    v.expect(Object.keys(bag)).toEqual([
      'borderTop',
      'border-top',
      'border-color',
      'borderLeft',
      'border-left',
    ]);
    v.expect(bag.borderLeft).toEqual({ w: 5 });
    v.expect(bag['border-top']).toBe(3);
    v.expect(bag['border-left']).toBe(5);
    v.expect(bag['border-color']).toBe(0x00ff00ff);
  });

  v.test('border and shadow write the same names together', () => {
    // 2.0 drops `effects`: the keys are written one by one.
    const node = view();
    node.border = { color: 0x0000ffff, width: 1 };
    node.shadow = { color: 0x000000ff, blur: 8, spread: 2, x: 1, y: 3 };
    v.expect(bagOf(node)).toEqual({
      border: { color: 0x0000ffff, width: 1 },
      'border-color': 0x0000ffff,
      'border-width': 1,
      shadow: { color: 0x000000ff, blur: 8, spread: 2, x: 1, y: 3 },
      'shadow-color': 0x000000ff,
      'shadow-blur': 8,
      'shadow-spread': 2,
      'shadow-x': 1,
      'shadow-y': 3,
    });
  });

  v.test('only own keys are written, inherited ones are not', () => {
    const node = view();
    const border = Object.create({ color: 0xffffffff }) as { width: number };
    border.width = 6;
    node.border = border;
    v.expect(Object.keys(bagOf(node))).toEqual(['border', 'border-width']);
  });

  v.test(
    'an object changed in place and written again keeps the values it was parsed with',
    () => {
      // An object is parsed once per identity (2.0, as 1.8; 1.x re-read it):
      // write a new object to change the values.
      const node = view();
      const border = { color: 0xff0000ff, width: 2 };
      node.border = border;
      border.color = 0x00ff00ff;
      border.width = 7;
      node.border = border;
      v.expect(bagOf(node)['border-color']).toBe(0xff0000ff);
      v.expect(bagOf(node)['border-width']).toBe(2);
      node.border = { color: 0x00ff00ff, width: 7 };
      v.expect(bagOf(node)['border-color']).toBe(0x00ff00ff);
      v.expect(bagOf(node)['border-width']).toBe(7);
    },
  );
});
