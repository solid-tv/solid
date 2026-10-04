// Compiled style plans (src/core/stylePlan.ts) and the shader-prop writes
// built on them (design 3.3): what is cached, by what, and what a node
// writes to its shader when a state changes.
import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import {
  compileBlock,
  compileStyle,
  shaderParse,
} from '../src/core/stylePlan.ts';
import { renderer } from './setup.js';

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;
const GREEN = 0x00ff00ff;

v.beforeEach(() => {
  v.vi.spyOn(console, 'warn').mockImplementation(() => {});
});
v.afterEach(() => {
  v.vi.restoreAllMocks();
});

/** Render one view with `style` under the root; returns it and a dispose. */
function mount(style: lng.NodeStyles) {
  const node = new lng.ElementNode('view');
  node.style = style;
  const dispose = renderer.render(() => node);
  return { node, dispose };
}

/** The props of a node's shader (the DOM renderer keeps them as given). */
const shaderProps = (node: lng.ElementNode) =>
  (node.lng as unknown as { shader: { props: Record<string, unknown> } }).shader
    .props;

/**
 * Turn `keys` of `obj` into accessors that count writes, keeping the
 * values. Returns the counts, by key.
 */
function countWrites(obj: Record<string, unknown>, keys: string[]) {
  const counts: Record<string, number> = {};
  for (const key of keys) {
    let value = obj[key];
    counts[key] = 0;
    Object.defineProperty(obj, key, {
      enumerable: true,
      configurable: true,
      get: () => value,
      set: (v: unknown) => {
        counts[key]!++;
        value = v;
      },
    });
  }
  return counts;
}

v.describe('compileBlock', () => {
  v.it('lists the own keys in order with their values, once per object', () => {
    const block = { color: BLUE, transition: { scale: true }, scale: 1.2 };
    const plan = compileBlock(block);
    v.expect(plan.keys).toEqual(['color', 'transition', 'scale']);
    v.expect(plan.values).toEqual([BLUE, block.transition, 1.2]);
    v.expect(plan.index.scale).toBe(2);
    v.expect(plan.index.alpha).toBeUndefined();
    v.expect(plan.getters).toEqual([false, false, false]);
    v.expect(compileBlock(block)).toBe(plan);
  });

  v.it(
    'marks a getter, so its value is read from the block on each apply',
    () => {
      let reads = 0;
      const block = {
        get color() {
          reads++;
          return RED;
        },
        alpha: 1,
      };
      const plan = compileBlock(block);
      v.expect(plan.keys).toEqual(['color', 'alpha']);
      v.expect(plan.getters).toEqual([true, false]);
      v.expect(plan.block).toBe(block);
      // Not read at compile: the apply reads it, once.
      v.expect(reads).toBe(0);
    },
  );

  v.it('pre-parses border and shadow objects into shader keys', () => {
    const border = { width: 4, color: BLUE };
    compileBlock({ border, scale: 1.1 });
    v.expect(shaderParse('border', border).keys).toEqual([
      'border',
      'border-w',
      'border-color',
    ]);
  });
});

v.describe('compileStyle', () => {
  v.it("gives each $state block's plan, cached by the style object", () => {
    const style: lng.NodeStyles = {
      color: RED,
      $focus: { color: BLUE },
      $active: { alpha: 0.5 },
    };
    const plan = compileStyle(style);
    v.expect(Object.keys(plan)).toEqual(['$focus', '$active']);
    v.expect(plan.$focus!.keys).toEqual(['color']);
    v.expect(plan.$focus!.values).toEqual([BLUE]);
    v.expect(plan.$focus).toBe(compileBlock(style.$focus!));
    v.expect(compileStyle(style)).toBe(plan);
  });

  v.it('is not cached when a $state block is a getter', () => {
    const style = {
      color: RED,
      get $focus() {
        return { color: GREEN };
      },
    } as lng.NodeStyles;
    const plan = compileStyle(style);
    v.expect(plan.$focus!.values).toEqual([GREEN]);
    v.expect(compileStyle(style)).not.toBe(plan);
  });
});

v.describe('shaderParse', () => {
  v.it(
    'expands a border side and renames width, as the writes always did',
    () => {
      const side = { width: 2, color: RED };
      const parse = shaderParse('borderTop', side);
      v.expect(parse.keys).toEqual(['border', 'border-top', 'border-color']);
      v.expect(parse.values).toEqual([side, 2, RED]);
      v.expect(shaderParse('borderTop', side)).toBe(parse);
      // The same object under another prefix is a parse of its own.
      v.expect(shaderParse('border', side).keys).toEqual([
        'border',
        'border-w',
        'border-color',
      ]);
    },
  );

  v.it('re-reads an object with a getter on each parse', () => {
    let color = RED;
    const border = {
      width: 2,
      get color() {
        return color;
      },
    };
    v.expect(shaderParse('border', border).values[2]).toBe(RED);
    color = GREEN;
    v.expect(shaderParse('border', border).values[2]).toBe(GREEN);
  });
});

v.describe('state application order', () => {
  let savedOrder: lng.DollarString[] | undefined;
  v.beforeEach(() => {
    savedOrder = lng.Config.stateOrder;
  });
  v.afterEach(() => {
    lng.Config.stateOrder = savedOrder;
  });

  v.it(
    'writes keys in the order of the merged blocks: states not in stateOrder first, then by stateOrder',
    () => {
      // Same order as before 1.7, where the blocks were sorted and spread
      // into one object: the key order decides which write comes first.
      lng.Config.stateOrder = ['$b', '$a'];
      const { node, dispose } = mount({
        x: 0,
        y: 0,
        alpha: 1,
        $a: { x: 1, alpha: 0.5 },
        $b: { y: 2, x: 3 },
        $c: { alpha: 0.2, y: 9 },
      });
      const send = v.vi.spyOn(
        lng.ElementNode.prototype,
        '_sendToLightningAnimatable',
      );
      node.states = ['$a', '$c', '$b'];
      v.expect(send.mock.calls).toEqual([
        ['alpha', 0.5],
        ['y', 2],
        ['x', 1],
      ]);
      dispose();
    },
  );
});

v.describe('shader-prop writes', () => {
  v.it('writes only the border sub-props that changed', () => {
    const Base = { width: 2, color: RED };
    const { node, dispose } = mount({
      width: 100,
      height: 100,
      border: Base,
      $focus: { border: { width: 2, color: BLUE } },
    });
    const props = shaderProps(node);
    const counts = countWrites(props, ['border-w', 'border-color']);

    node.border = Base;
    v.expect(counts).toEqual({ 'border-w': 0, 'border-color': 0 });

    node.states.add('$focus');
    v.expect(props['border-color']).toBe(BLUE);
    v.expect(counts).toEqual({ 'border-w': 0, 'border-color': 1 });

    node.states.remove('$focus');
    v.expect(props['border-color']).toBe(RED);
    v.expect(counts).toEqual({ 'border-w': 0, 'border-color': 2 });
    dispose();
  });

  v.it(
    'a borderRadius written again with the same value is not written',
    () => {
      const { node, dispose } = mount({
        width: 100,
        height: 100,
        borderRadius: 8,
        $focus: { borderRadius: 8, alpha: 0.5 },
      });
      const counts = countWrites(shaderProps(node), ['radius']);
      node.borderRadius = 8;
      node.states.add('$focus');
      v.expect(node.alpha).toBe(0.5);
      v.expect(counts).toEqual({ radius: 0 });
      node.borderRadius = 12;
      v.expect(counts).toEqual({ radius: 1 });
      dispose();
    },
  );

  v.it('a border removed by undo resets every sub-prop it set', () => {
    const { node, dispose } = mount({
      width: 100,
      height: 100,
      borderRadius: 8,
      $focus: { border: { width: 4, color: BLUE, gap: 2 } },
    });
    node.states.add('$focus');
    v.expect(shaderProps(node)['border-w']).toBe(4);
    node.states.remove('$focus');
    v.expect(shaderProps(node)).toEqual({ radius: 8 });
    dispose();
  });

  v.it(
    'after a reset, the sub-props the new object keeps unchanged are not written again',
    () => {
      const { node, dispose } = mount({
        width: 100,
        height: 100,
        border: { width: 2, color: RED },
        $focus: { border: { width: 2, color: RED, gap: 4 } },
      });
      const props = shaderProps(node);
      const counts = countWrites(props, ['border-w', 'border-color']);
      node.states.add('$focus');
      v.expect(props['border-gap']).toBe(4);
      node.states.remove('$focus');
      v.expect(props['border-gap']).toBeUndefined();
      v.expect(counts).toEqual({ 'border-w': 0, 'border-color': 0 });
      dispose();
    },
  );

  v.it(
    'a sub-prop that border and a border side both set is always written, as before',
    () => {
      // border-color is written by `border` and by `borderTop`: diffing it
      // against one accessor's previous object alone would skip this write.
      const { node, dispose } = mount({
        width: 100,
        height: 100,
        border: { width: 2, color: RED },
      });
      node.borderTop = { width: 4, color: GREEN };
      v.expect(shaderProps(node)['border-color']).toBe(GREEN);
      node.border = { width: 3, color: RED };
      v.expect(shaderProps(node)['border-color']).toBe(RED);
      dispose();
    },
  );

  v.it(
    'a gradient set again updates the shader it made instead of a new one',
    () => {
      const { node, dispose } = mount({ width: 100, height: 100 });
      node.linearGradient = { colors: [RED, BLUE], angle: 1 };
      const shader = node.lng.shader;
      node.linearGradient = { colors: [GREEN, BLUE] };
      v.expect(node.lng.shader).toBe(shader);
      v.expect(shaderProps(node)).toEqual({ colors: [GREEN, BLUE] });
      dispose();
    },
  );
});
