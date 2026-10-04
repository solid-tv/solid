/**
 * Shader props on the real renderer: a renderer v2 shader's `props` is a
 * facade over the shader's resolved values, so what a node holds after a
 * border, shadow or gradient write, direct or from a state, is read through
 * it, prop by prop. Each case is pinned to the result 1.6.4 gave for it: a
 * border or shadow object merges into the shader props, the later write of
 * a sub-prop winning, and a state undo writes the key's fallback object (or
 * nothing when there is none).
 *
 *   pnpm test:webgl
 */
import * as v from 'vitest';
import { ElementNode, type NodeStyles } from '@solidtv/solid';
import type { IAnimationController } from '@solidtv/renderer';
import {
  LinearGradient,
  Rounded,
  RoundedWithBorder,
  RoundedWithShadow,
} from '@solidtv/renderer/webgl/shaders';
import { render, renderer, settle } from './setup.js';

// The names Solid's convertToShader and gradient accessors create, as an app
// registers them (bench/src/arm-v2.ts).
renderer.registerShaderType('rounded', Rounded);
renderer.registerShaderType('roundedWithBorder', RoundedWithBorder);
renderer.registerShaderType('roundedWithShadow', RoundedWithShadow);
renderer.registerShaderType('linearGradient', LinearGradient);

const BLUE = 0x0000ffff;
const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;

type Shader = {
  shaderType: { props: Record<string, unknown> };
  props: Record<string, unknown>;
};
const shaderOf = (node: ElementNode) =>
  (node.lng as unknown as { shader: Shader }).shader;

/** Render two nodes with `style`; the first is the one whose states change. */
async function pair(style: NodeStyles) {
  let changed!: ElementNode;
  let never!: ElementNode;
  const dispose = render(() => (
    <view>
      <view ref={changed} style={style} />
      <view ref={never} x={200} style={style} />
    </view>
  ));
  await settle();
  return { changed, never, dispose };
}

/** Records the animations Solid starts, to wait for them to end. */
function watchAnimations() {
  const spy = v.vi.spyOn(ElementNode.prototype, 'animate');
  return {
    /** Wait until every animation started so far has stopped. */
    async done() {
      for (const r of spy.mock.results) {
        await (r.value as IAnimationController).waitUntilStopped();
      }
    },
    restore: () => spy.mockRestore(),
  };
}

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Every declared prop of a node's shader, as the shader resolved it. */
function declaredProps(node: ElementNode): Record<string, unknown> {
  const shader = shaderOf(node);
  const out: Record<string, unknown> = {};
  for (const name in shader.shaderType.props) {
    out[name] = shader.props[name];
  }
  return out;
}

/** The border colour and widths a node's shader holds. */
const borderOf = (node: ElementNode) => [
  shaderOf(node).props['border-color'],
  shaderOf(node).props['border-w'],
];

v.test(
  'a gradient set again updates its shader to what a new one would hold',
  async () => {
    let node!: ElementNode;
    let fresh!: ElementNode;
    const dispose = render(() => (
      <view>
        <view ref={node} width={100} height={100} />
        <view ref={fresh} x={200} width={100} height={100} />
      </view>
    ));
    await settle();
    node.linearGradient = {
      colors: [RED, BLUE, GREEN],
      angle: 1,
      stops: [0, 0.2, 1],
    };
    const shader = shaderOf(node);
    node.linearGradient = { colors: [GREEN, BLUE] } as never;
    fresh.linearGradient = { colors: [GREEN, BLUE] } as never;
    v.expect(shaderOf(node)).toBe(shader);
    v.expect(declaredProps(node)).toEqual(declaredProps(fresh));
    await settle();
    dispose();
  },
);

// Direct writes (D-cases of the stream S review), each as 1.6 gave it.

v.test(
  'D1: a direct border over a base borderTop sets all four widths; a later borderTop its own',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      borderTop: { width: 6, color: RED },
    });
    v.expect(borderOf(changed)).toEqual([RED, [6, 0, 0, 0]]);
    changed.border = { width: 2, color: BLUE };
    v.expect(borderOf(changed)).toEqual([BLUE, [2, 2, 2, 2]]);
    changed.borderTop = { width: 9 };
    v.expect(borderOf(changed)).toEqual([BLUE, [9, 2, 2, 2]]);
    dispose();
  },
);

v.test(
  'D2: a sub-prop that border and a border side both name takes the later write',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
    });
    changed.borderTop = { width: 4, color: GREEN };
    v.expect(borderOf(changed)).toEqual([GREEN, [4, 2, 2, 2]]);
    changed.border = { width: 3, color: RED };
    v.expect(borderOf(changed)).toEqual([RED, [3, 3, 3, 3]]);
    dispose();
  },
);

v.test(
  'D3: a direct border hides and restores a base border with a bottom accent',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      borderBottom: { width: 6 },
    });
    v.expect(borderOf(changed)).toEqual([RED, [2, 2, 6, 2]]);
    changed.border = { width: 0 };
    v.expect(borderOf(changed)).toEqual([RED, [0, 0, 0, 0]]);
    changed.border = { width: 4, color: BLUE };
    v.expect(borderOf(changed)).toEqual([BLUE, [4, 4, 4, 4]]);
    dispose();
  },
);

v.test(
  'D3h: a handler-driven border over a base underline, then hidden',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      borderBottom: { width: 4, color: RED },
    });
    v.expect(borderOf(changed)).toEqual([RED, [0, 0, 4, 0]]);
    changed.border = { width: 3, color: BLUE };
    v.expect(borderOf(changed)).toEqual([BLUE, [3, 3, 3, 3]]);
    changed.border = { width: 0 };
    v.expect(borderOf(changed)).toEqual([BLUE, [0, 0, 0, 0]]);
    dispose();
  },
);

v.test(
  'D4: a direct borderTop while $focus is on wins over the display; the undo writes the style border back over it',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: { border: { width: 4, color: BLUE } },
    });
    changed.states.add('$focus');
    v.expect(borderOf(changed)).toEqual([BLUE, [4, 4, 4, 4]]);
    changed.borderTop = { width: 8, color: GREEN };
    v.expect(borderOf(changed)).toEqual([GREEN, [8, 4, 4, 4]]);
    changed.states.remove('$focus');
    // The style's border: all four widths and the colour (1.6).
    v.expect(borderOf(changed)).toEqual([RED, [2, 2, 2, 2]]);
    v.expect(borderOf(never)).toEqual([RED, [2, 2, 2, 2]]);
    dispose();
  },
);

v.test(
  'D5: a direct border to the key $focus names wins while on; the undo writes the style border back',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: { border: { width: 4, color: BLUE } },
    });
    changed.states.add('$focus');
    changed.border = { width: 6, color: GREEN };
    v.expect(borderOf(changed)).toEqual([GREEN, [6, 6, 6, 6]]);
    changed.states.remove('$focus');
    v.expect(borderOf(changed)).toEqual([RED, [2, 2, 2, 2]]);
    // The getter gives the style's object, as before 1.7.
    v.expect(changed.border).toBe(changed.style.border);
    dispose();
  },
);

v.test(
  'D6: a direct border while a $focus borderBottom is on sets all four widths; the undo of a key without a fallback writes nothing',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: { borderBottom: { width: 4 } },
    });
    changed.states.add('$focus');
    v.expect(borderOf(changed)).toEqual([RED, [2, 2, 4, 2]]);
    changed.border = { width: 1, color: BLUE };
    v.expect(borderOf(changed)).toEqual([BLUE, [1, 1, 1, 1]]);
    changed.states.remove('$focus');
    v.expect(borderOf(changed)).toEqual([BLUE, [1, 1, 1, 1]]);
    dispose();
  },
);

v.test(
  'D7: a direct border over a base border and borderTop sets all four; a $focus side sits on it and stays after the undo (no fallback)',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      borderTop: { width: 6 },
      $focus: { borderBottom: { width: 4 } },
    });
    v.expect(borderOf(changed)).toEqual([RED, [6, 2, 2, 2]]);
    changed.border = { width: 3, color: BLUE };
    v.expect(borderOf(changed)).toEqual([BLUE, [3, 3, 3, 3]]);
    changed.states.add('$focus');
    v.expect(borderOf(changed)).toEqual([BLUE, [3, 3, 4, 3]]);
    changed.states.remove('$focus');
    v.expect(borderOf(changed)).toEqual([BLUE, [3, 3, 4, 3]]);
    dispose();
  },
);

v.test(
  'an effects border is written like a direct one: a later borderTop sits on it',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      effects: { border: { width: 2, color: RED } },
    } as NodeStyles);
    v.expect(borderOf(changed)).toEqual([RED, [2, 2, 2, 2]]);
    changed.borderTop = { width: 6 };
    v.expect(borderOf(changed)).toEqual([RED, [6, 2, 2, 2]]);
    dispose();
  },
);

// Writes before render go into one props bag, which createShader resolves at
// render: the vec4 first, then the element aliases.

v.test(
  'J1: a JSX border prop and a style borderTop: the later colour wins, the widths as createShader resolves the bag',
  async () => {
    let a!: ElementNode;
    let b!: ElementNode;
    const dispose = render(() => (
      <view>
        <view
          ref={a}
          border={{ width: 2, color: RED }}
          style={{
            width: 100,
            height: 100,
            borderTop: { width: 6, color: GREEN },
          }}
        />
        <view
          ref={b}
          x={200}
          style={{
            width: 100,
            height: 100,
            borderTop: { width: 6, color: GREEN },
          }}
          border={{ width: 2, color: RED }}
        />
      </view>
    ));
    await settle();
    v.expect(borderOf(a)).toEqual([GREEN, [6, 2, 2, 2]]);
    v.expect(borderOf(b)).toEqual([RED, [6, 2, 2, 2]]);
    dispose();
  },
);

v.test(
  'TH1: theme border keys in key order: the later colour wins',
  async () => {
    let a!: ElementNode;
    const dispose = render(() => (
      <view>
        <view
          ref={a}
          width={100}
          height={100}
          theme={
            {
              borderTop: { width: 6, color: GREEN },
              border: { width: 2, color: RED },
            } as NodeStyles
          }
        />
      </view>
    ));
    await settle();
    v.expect(borderOf(a)).toEqual([RED, [6, 2, 2, 2]]);
    dispose();
  },
);

v.test(
  'S3: JSX border props before render: the later write of a key wins in the bag',
  async () => {
    let a!: ElementNode;
    let b!: ElementNode;
    const dispose = render(() => (
      <view>
        <view
          ref={a}
          width={100}
          height={100}
          borderTop={{ width: 6 }}
          border={{ top: 3, width: 1 }}
        />
        <view
          ref={b}
          x={200}
          width={100}
          height={100}
          border={{ top: 3, width: 1 }}
          borderTop={{ width: 6 }}
        />
      </view>
    ));
    await settle();
    v.expect(shaderOf(a).props['border-w']).toEqual([3, 1, 1, 1]);
    v.expect(shaderOf(b).props['border-w']).toEqual([6, 1, 1, 1]);
    dispose();
  },
);

// State changes: each key is written through its setter, in block key order.

for (const shadowFirst of [true, false]) {
  const label = shadowFirst ? 'shadow then border' : 'border then shadow';
  v.test(
    `N5: a $focus with ${label} on a node without a shader creates the type the first write chose`,
    async () => {
      const sh = { color: 0x000000ff, blur: 10 };
      const bo = { width: 4, color: BLUE };
      const { changed, dispose } = await pair({
        width: 100,
        height: 100,
        color: 0xffffffff,
        $focus: shadowFirst
          ? { shadow: sh, border: bo }
          : { border: bo, shadow: sh },
      });
      changed.states.add('$focus');
      const declared = shaderOf(changed).shaderType.props;
      v.expect('shadow-color' in declared).toBe(shadowFirst);
      v.expect('border-w' in declared).toBe(!shadowFirst);
      if (shadowFirst) {
        v.expect(shaderOf(changed).props['shadow-projection']).toEqual([
          0, 0, 10, 5,
        ]);
      } else {
        v.expect(borderOf(changed)).toEqual([BLUE, [4, 4, 4, 4]]);
      }
      dispose();
    },
  );
}

v.test('a $state getter for a border key is read once per apply', async () => {
  let reads = 0;
  const block = {
    get border() {
      reads++;
      return { width: 4, color: BLUE };
    },
    borderTop: { width: 8 },
  };
  const { changed, dispose } = await pair({
    width: 100,
    height: 100,
    $focus: block as NodeStyles['$focus'],
  });
  reads = 0;
  changed.states.add('$focus');
  v.expect(reads).toBe(1);
  v.expect(shaderOf(changed).props['border-w']).toEqual([8, 4, 4, 4]);
  changed.states.remove('$focus');
  v.expect(reads).toBe(1);
  dispose();
});

v.test(
  'T1: a setter that throws before the border keys leaves no state behind; later direct writes and the undo are as in 1.6',
  async () => {
    let thrown = false;
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: {
        myThrow: 1,
        border: { width: 4, color: BLUE },
        borderTop: { width: 8 },
      } as NodeStyles['$focus'],
    });
    Object.defineProperty(changed, 'myThrow', {
      configurable: true,
      get: () => undefined,
      set() {
        if (!thrown) {
          thrown = true;
          throw new Error('boom');
        }
      },
    });
    v.expect(() => changed.states.add('$focus')).toThrow('boom');
    v.expect(shaderOf(changed).props['border-w']).toEqual([2, 2, 2, 2]);
    changed.borderLeft = { width: 5 };
    v.expect(shaderOf(changed).props['border-w']).toEqual([2, 2, 2, 5]);
    // A write of undefined writes nothing (1.6).
    changed.borderLeft = undefined as unknown as NodeStyles['borderLeft'];
    v.expect(shaderOf(changed).props['border-w']).toEqual([2, 2, 2, 5]);
    // The undo writes the style's border back, over the left width (1.6).
    changed.states.remove('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([2, 2, 2, 2]);
    v.expect(shaderOf(changed).props['border-color']).toBe(RED);
    dispose();
  },
);

v.test(
  'N6: a setter that throws after the border key does not lose the border',
  async () => {
    let thrown = false;
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: {
        border: { width: 4, color: BLUE },
        myThrow: 1,
      } as NodeStyles['$focus'],
      $hover: { alpha: 0.9 },
    });
    Object.defineProperty(changed, 'myThrow', {
      configurable: true,
      get: () => undefined,
      set() {
        if (!thrown) {
          thrown = true;
          throw new Error('boom');
        }
      },
    });
    v.expect(() => changed.states.add('$focus')).toThrow('boom');
    v.expect(borderOf(changed)).toEqual([BLUE, [4, 4, 4, 4]]);
    changed.states.add('$hover');
    v.expect(borderOf(changed)).toEqual([BLUE, [4, 4, 4, 4]]);
    changed.states.remove('$hover');
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(borderOf(changed)).toEqual([RED, [2, 2, 2, 2]]);
    dispose();
  },
);

v.test(
  'RE1: a state key setter that adds another state mid-change does not lose the border written before it',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: {
        border: { width: 4, color: BLUE },
        myKick: 1,
      } as NodeStyles['$focus'],
      $active: { alpha: 0.9 },
    });
    let kicked = false;
    Object.defineProperty(changed, 'myKick', {
      configurable: true,
      get: () => undefined,
      set(v: unknown) {
        if (v === 1 && !kicked) {
          kicked = true;
          changed.states.add('$active');
        }
      },
    });
    changed.states.add('$focus');
    never.states.add('$active');
    never.states.add('$focus');
    v.expect([...changed.states]).toEqual(['$focus', '$active']);
    v.expect(borderOf(changed)).toEqual([BLUE, [4, 4, 4, 4]]);
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    dispose();
  },
);

// Two states whose border objects overlap: 1.6 wrote every key of the merged
// object on each change, the later key winning. A change that writes one key
// of the family and leaves another unchanged writes the family again in that
// order, so a state's own side is not lost to another state's border.

v.test(
  'M1: a $focus border and borderTop with an $active border: each change shows the merged object, as 1.6',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      $focus: { border: { width: 4, color: BLUE }, borderTop: { width: 8 } },
      $active: { border: { width: 6, color: BLUE } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([8, 4, 4, 4]);
    changed.states.add('$active');
    v.expect(shaderOf(changed).props['border-w']).toEqual([8, 6, 6, 6]);
    changed.states.remove('$active');
    v.expect(shaderOf(changed).props['border-w']).toEqual([8, 4, 4, 4]);
    changed.states.remove('$focus');
    // No fallback for either key: the undo writes nothing (1.6; B18).
    v.expect(shaderOf(changed).props['border-w']).toEqual([8, 4, 4, 4]);
    dispose();
  },
);

v.test(
  'ST2: a $focus border removed while an $active borderTop stays on keeps the top over the base border, as 1.6',
  async () => {
    let throwOnApply = true;
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: {
        border: { width: 4, color: BLUE },
        myThrow: 1,
      } as NodeStyles['$focus'],
      $active: { borderTop: { width: 8 } },
    });
    Object.defineProperty(changed, 'myThrow', {
      configurable: true,
      get: () => undefined,
      set(v: unknown) {
        if (throwOnApply && v === 1) {
          throwOnApply = false;
          throw new Error('boom');
        }
      },
    });
    v.expect(() => changed.states.add('$focus')).toThrow('boom');
    v.expect(borderOf(changed)).toEqual([BLUE, [4, 4, 4, 4]]);
    changed.states.add('$active');
    v.expect(borderOf(changed)).toEqual([BLUE, [8, 4, 4, 4]]);
    changed.states.remove('$focus');
    v.expect(borderOf(changed)).toEqual([RED, [8, 2, 2, 2]]);
    changed.states.remove('$active');
    v.expect(borderOf(changed)).toEqual([RED, [2, 2, 2, 2]]);
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    dispose();
  },
);

// Values set through the `shader` prop, written into the shader's props, or
// mid-animation: a direct write goes over them, as 1.6 wrote it.

v.test(
  'RS1: a direct borderTop over border props set through the shader prop keeps them',
  async () => {
    let a!: ElementNode;
    const dispose = render(() => (
      <view>
        <view
          ref={a}
          width={100}
          height={100}
          color={0xffffffff}
          shader={
            [
              'roundedWithBorder',
              { 'border-w': 3, 'border-color': GREEN, radius: 10 },
            ] as never
          }
        />
      </view>
    ));
    await settle();
    v.expect(borderOf(a)).toEqual([GREEN, [3, 3, 3, 3]]);
    a.borderTop = { width: 6 };
    v.expect(borderOf(a)).toEqual([GREEN, [6, 3, 3, 3]]);
    v.expect(shaderOf(a).props.radius).toEqual([10, 10, 10, 10]);
    dispose();
  },
);

v.test(
  'RS2: a shader set after render replaces the base border; a direct borderTop sits on it',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
    });
    changed.shader = [
      'roundedWithBorder',
      { 'border-w': 3, 'border-color': GREEN },
    ] as never;
    v.expect(borderOf(changed)).toEqual([GREEN, [3, 3, 3, 3]]);
    changed.borderTop = { width: 6 };
    v.expect(borderOf(changed)).toEqual([GREEN, [6, 3, 3, 3]]);
    dispose();
  },
);

v.test(
  'RS3: a direct shadow over shadow props set through the shader prop keeps its colour and projection',
  async () => {
    let a!: ElementNode;
    const dispose = render(() => (
      <view>
        <view
          ref={a}
          width={100}
          height={100}
          color={0xffffffff}
          shader={
            [
              'roundedWithShadow',
              { 'shadow-color': GREEN, 'shadow-projection': [3, 3, 10, 5] },
            ] as never
          }
        />
      </view>
    ));
    await settle();
    a.shadow = { blur: 20 } as NodeStyles['shadow'];
    v.expect(shaderOf(a).props['shadow-color']).toBe(GREEN);
    v.expect(shaderOf(a).props['shadow-projection']).toEqual([3, 3, 20, 5]);
    dispose();
  },
);

v.test(
  'RS4: a direct borderTop during a direct border animation changes the top alone, mid-flight',
  async () => {
    const anims = watchAnimations();
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      transition: { border: { duration: 120, easing: 'linear' } },
    });
    changed.border = { width: 8, color: BLUE };
    await nextFrame();
    await nextFrame();
    const midW = (shaderOf(changed).props['border-w'] as number[]).slice();
    const midColor = shaderOf(changed).props['border-color'];
    changed.borderTop = { width: 3 };
    const after = shaderOf(changed).props['border-w'] as number[];
    v.expect(after[0]).toBe(3);
    v.expect(after.slice(1)).toEqual(midW.slice(1));
    v.expect(shaderOf(changed).props['border-color']).toBe(midColor);
    await anims.done();
    await settle();
    if (midW[1]! < 8) {
      // The animation was still running: its last frame writes the vec4.
      v.expect(shaderOf(changed).props['border-w']).toEqual([8, 8, 8, 8]);
    }
    anims.restore();
    dispose();
  },
);

v.test(
  'RS5: a sub-prop written straight into the shader props survives a direct borderTop',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
    });
    shaderOf(changed).props['border-gap'] = 4;
    changed.borderTop = { width: 6 };
    v.expect(shaderOf(changed).props['border-gap']).toBe(4);
    v.expect(borderOf(changed)).toEqual([RED, [6, 2, 2, 2]]);
    dispose();
  },
);

v.test(
  'an animated undo of borderRadius shrinks the radius and ends at none, as 1.6.4 did on renderer 1.9',
  async () => {
    // 1.6.4's animator made a track for `undefined` and the template
    // resolved it to [0, 0, 0, 0]; renderer 2.0 makes no track for it, so
    // the undo animates to 0 explicitly.
    const anims = watchAnimations();
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      transition: { borderRadius: { duration: 400, easing: 'linear' } },
      $focus: { borderRadius: 20 },
    });
    changed.states.add('$focus');
    await anims.done();
    v.expect(shaderOf(changed).props.radius).toEqual([20, 20, 20, 20]);
    changed.states.remove('$focus');
    await wait(150);
    const r = (shaderOf(changed).props.radius as number[])[0]!;
    v.expect(r).toBeGreaterThan(0);
    v.expect(r).toBeLessThan(20);
    await anims.done();
    v.expect(shaderOf(changed).props.radius).toEqual([0, 0, 0, 0]);
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    anims.restore();
    dispose();
  },
);
