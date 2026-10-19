// Compiled style plans (src/core/node/stylePlan.ts) and the shader-prop
// writes built on them (design 3.3): what is cached, by what, and what a node
// writes to its shader when a state changes. The node is the 2.0
// ElementNode on a headless core (the JSX host builds the old node until
// Task 8).
import * as v from 'vitest';
import { RendererCore } from '@solidtv/renderer';
import { Config } from '../src/core/config.js';
import type { DollarString, NodeStyles } from '../src/core/intrinsicTypes.js';
import { ElementNode } from '../src/core/node/ElementNode.js';
import { convertToShader, shaderParse } from '../src/core/node/shader.js';
import { compileBlock, compileStyle } from '../src/core/node/stylePlan.js';
import { NodeType } from '../src/core/nodeTypes.js';
import { registerDefaultShaders } from '../src/core/shaders.js';

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;
const GREEN = 0x00ff00ff;

v.beforeEach(() => {
  v.vi.spyOn(console, 'warn').mockImplementation(() => {});
});
v.afterEach(() => {
  v.vi.restoreAllMocks();
});

/**
 * One attached view with `style` on a headless core with the default shader
 * types: what attach does with the style and the shader props (Task 8).
 */
function mount(style: NodeStyles) {
  const core = new RendererCore({ appWidth: 640, appHeight: 360 });
  registerDefaultShaders(core);
  const node = new ElementNode(core, NodeType.Element);
  node.style = style;
  node.rendered = true;
  convertToShader(node);
  return { core, node };
}

/** The props facade of a node's shader. */
const shaderProps = (node: ElementNode) => node._shader!.props;

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
    // Task 5's shape: facade keys only, `width` is `border-width`.
    v.expect(shaderParse('border', border).keys).toEqual([
      'border-width',
      'border-color',
    ]);
  });
});

v.describe('compileStyle', () => {
  v.it("gives each $state block's plan, cached by the style object", () => {
    const style: NodeStyles = {
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
    } as NodeStyles;
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
      v.expect(parse.keys).toEqual(['border-top', 'border-color']);
      v.expect(parse.values).toEqual([2, RED]);
      v.expect(shaderParse('borderTop', side)).toBe(parse);
      // The same object under another prefix is a parse of its own.
      v.expect(shaderParse('border', side).keys).toEqual([
        'border-width',
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
    v.expect(shaderParse('border', border).values[1]).toBe(RED);
    color = GREEN;
    v.expect(shaderParse('border', border).values[1]).toBe(GREEN);
  });
});

v.describe('state application order', () => {
  let savedOrder: DollarString[] | undefined;
  v.beforeEach(() => {
    savedOrder = Config.stateOrder;
  });
  v.afterEach(() => {
    Config.stateOrder = savedOrder;
  });

  v.it(
    'writes keys in the order of the merged blocks: states not in stateOrder first, then by stateOrder',
    () => {
      // Same order as before 1.7, where the blocks were sorted and spread
      // into one object: the key order decides which write comes first.
      Config.stateOrder = ['$b', '$a'];
      const { node } = mount({
        x: 0,
        y: 0,
        alpha: 1,
        $a: { x: 1, alpha: 0.5 },
        $b: { y: 2, x: 3 },
        $c: { alpha: 0.2, y: 9 },
      });
      // The order is read off the node's own accessor writes: an own
      // accessor per key, over the prototype's.
      const writes: [string, unknown][] = [];
      const proto = ElementNode.prototype;
      for (const key of ['alpha', 'x', 'y']) {
        const desc = Object.getOwnPropertyDescriptor(proto, key)!;
        Object.defineProperty(node, key, {
          configurable: true,
          get() {
            return desc.get!.call(this);
          },
          set(value: unknown) {
            writes.push([key, value]);
            desc.set!.call(this, value);
          },
        });
      }
      node.states = ['$a', '$c', '$b'];
      v.expect(writes).toEqual([
        ['alpha', 0.5],
        ['y', 2],
        ['x', 1],
      ]);
    },
  );
});

v.describe('shader-prop writes', () => {
  v.it('writes only the border sub-props that changed', () => {
    const Base = { width: 2, color: RED };
    const { node } = mount({
      width: 100,
      height: 100,
      border: Base,
      $focus: { border: { width: 2, color: BLUE } },
    });
    const props = shaderProps(node);
    const counts = countWrites(props, ['border-width', 'border-color']);

    node.border = Base;
    v.expect(counts).toEqual({ 'border-width': 0, 'border-color': 0 });

    node.states.add('$focus');
    v.expect(props['border-color']).toBe(BLUE);
    v.expect(counts).toEqual({ 'border-width': 0, 'border-color': 1 });

    node.states.remove('$focus');
    v.expect(props['border-color']).toBe(RED);
    v.expect(counts).toEqual({ 'border-width': 0, 'border-color': 2 });
  });

  v.it(
    'a borderRadius written again with the same value is not written',
    () => {
      const { node } = mount({
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
    },
  );

  v.it(
    'a sub-prop that border and a border side both set takes the later write, as in 1.6',
    () => {
      // border-color is written by `border` and by `borderTop`: the later
      // direct write wins, whatever the object (D2).
      const { node } = mount({
        width: 100,
        height: 100,
        border: { width: 2, color: RED },
      });
      node.borderTop = { width: 4, color: GREEN };
      v.expect(shaderProps(node)['border-color']).toBe(GREEN);
      node.border = { width: 3, color: RED };
      v.expect(shaderProps(node)['border-color']).toBe(RED);
      v.expect(shaderProps(node)['border-width']).toEqual([3, 3, 3, 3]);
    },
  );

  v.it(
    'a direct border write while a state is on is replaced by the undo, which writes the style object back, as in 1.6',
    () => {
      // The undo writes the key's fallback (the style's border) when it
      // differs from the value the state wrote (D5).
      const { node } = mount({
        width: 100,
        height: 100,
        border: { width: 2, color: RED },
        $focus: { border: { width: 4, color: BLUE } },
      });
      node.states.add('$focus');
      v.expect(shaderProps(node)['border-color']).toBe(BLUE);
      node.border = { width: 6, color: GREEN };
      v.expect(shaderProps(node)['border-width']).toEqual([6, 6, 6, 6]);
      v.expect(shaderProps(node)['border-color']).toBe(GREEN);
      node.states.remove('$focus');
      v.expect(shaderProps(node)['border-width']).toEqual([2, 2, 2, 2]);
      v.expect(shaderProps(node)['border-color']).toBe(RED);
      // The getter gives the style's object, as before 1.7.
      v.expect(node.border).toBe(node.style.border);
    },
  );

  // 1.8 updated the shader a gradient made in place; Task 5 (src/core/node/
  // shader.ts, tests/node/shader.test.tsx "writing the same gradient object
  // again keeps its shader") makes a new shader for a new object. Not a
  // styles-and-states behaviour: left to the controller.
  v.it.skip(
    'a gradient set again updates the shader it made instead of a new one',
    () => {
      const { node } = mount({ width: 100, height: 100 });
      node.linearGradient = { colors: [RED, BLUE], angle: 1 };
      const shader = node._shader;
      node.linearGradient = { colors: [GREEN, BLUE] };
      v.expect(node._shader).toBe(shader);
      v.expect(shaderProps(node)).toEqual({ colors: [GREEN, BLUE] });
    },
  );
});
