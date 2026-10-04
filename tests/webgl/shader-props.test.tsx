/**
 * State styles and shader props on the real renderer: a renderer v2 shader's
 * `props` is a facade over the shader's resolved values, so what a node
 * holds after a state change is read through it, prop by prop, against a
 * node that never changed.
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
const SHADOW = 0x0000007a;

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

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The alpha byte and the RGB of a 0xRRGGBBAA colour. */
const alphaOf = (c: unknown) => (c as number) & 0xff;
const rgbOf = (c: unknown) => ((c as number) >>> 8) & 0xffffff;

/** Every declared prop of a node's shader, as the shader resolved it. */
function declaredProps(node: ElementNode): Record<string, unknown> {
  const shader = shaderOf(node);
  const out: Record<string, unknown> = {};
  for (const name in shader.shaderType.props) {
    out[name] = shader.props[name];
  }
  return out;
}

v.test(
  'B18: after $focus and blur, the border shader props equal a never-focused node',
  async () => {
    const Thumb: NodeStyles = {
      width: 100,
      height: 100,
      borderRadius: 16,
      border: { width: 0, color: 0x00000000 },
      $focus: { border: { color: BLUE, width: 6, gap: 4, align: 'outside' } },
    };
    let focused!: ElementNode;
    let never!: ElementNode;
    const dispose = render(() => (
      <view>
        <view ref={focused} style={Thumb} />
        <view ref={never} x={200} style={Thumb} />
      </view>
    ));
    await settle();
    focused.states.add('$focus');
    v.expect(shaderOf(focused).props['border-gap']).toBe(4);
    focused.states.remove('$focus');
    v.expect(declaredProps(focused)).toEqual(declaredProps(never));
    v.expect(shaderOf(focused).props['border-gap']).toBe(0);
    dispose();
  },
);

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

v.test(
  'B18: a $focus shadow over no base shadow draws nothing after blur, as a never-focused node',
  async () => {
    // A never-focused node has no shader. The blurred one keeps the shader
    // its focus made (a shader type is chosen once); its shadow goes
    // transparent, which Box neither draws nor grows the quad for.
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      color: 0xffffffff,
      $focus: { shadow: { color: SHADOW, blur: 24, spread: 4 } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['shadow-color']).toBe(SHADOW);
    changed.states.remove('$focus');
    v.expect(shaderOf(never)).toBeNull();
    v.expect(shaderOf(changed).props['shadow-color']).toBe(0x00000000);
    v.expect(shaderOf(changed).props['shadow-projection']).toEqual([
      0, 0, 5, 5,
    ]);
    dispose();
  },
);

v.test(
  'B18: a shadow element only $focus names (blur) returns to what a never-focused node holds',
  async () => {
    // The element aliases (shadow-x/y/blur/spread) of a fresh shader read
    // the projection's default, [0, 0, 5, 5]: blur is 5, not 0.
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      shadow: { color: SHADOW, y: 4 },
      $focus: { shadow: { color: SHADOW, y: 8, blur: 24 } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['shadow-projection']).toEqual([
      0, 8, 24, 5,
    ]);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['shadow-projection']).toEqual([
      0, 4, 5, 5,
    ]);
    dispose();
  },
);

v.test(
  'an unchanged shadow element is written again when the projection it is part of is reset',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      shadow: { color: SHADOW, y: 8 },
      $focus: { shadow: { color: SHADOW, projection: [3, 3, 30, 3], y: 8 } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['shadow-projection']).toEqual([
      3, 8, 30, 3,
    ]);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    dispose();
  },
);

v.test(
  'B18 with a border transition: the animated undo resets what a never-focused node does not have',
  async () => {
    // border-w and border-align resolve their value: reset to undefined they
    // would make no animation track and keep the focus values.
    const anims = watchAnimations();
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { color: 0x00000000 },
      transition: { border: { duration: 30 } },
      $focus: { border: { color: BLUE, width: 6, align: 'center' } },
    });
    changed.states.add('$focus');
    await anims.done();
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 6, 6, 6]);
    changed.states.remove('$focus');
    await anims.done();
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    anims.restore();
    dispose();
  },
);

v.test(
  'a shadow with no colour over none shows again on every add (the removal left it transparent)',
  async () => {
    const { changed, dispose } = await pair({
      width: 100,
      height: 100,
      $focus: { shadow: { blur: 24, spread: 4 } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['shadow-color']).toBe(0x000000ff);
    changed.states.remove('$focus');
    v.expect(alphaOf(shaderOf(changed).props['shadow-color'])).toBe(0);
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['shadow-color']).toBe(0x000000ff);
    v.expect(shaderOf(changed).props['shadow-projection']).toEqual([
      0, 0, 24, 4,
    ]);
    dispose();
  },
);

v.test(
  'B18: a border side only $focus names (top) returns to the base width after blur',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: { border: { width: 2, color: BLUE, top: 6 } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 2, 2, 2]);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['border-w']).toEqual([2, 2, 2, 2]);
    dispose();
  },
);

v.test(
  'B18: a shadow element only $focus names returns to the shared projection after blur',
  async () => {
    const P = [0, 4, 10, 2];
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      shadow: { color: SHADOW, projection: P },
      $focus: { shadow: { color: SHADOW, projection: P, blur: 30 } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['shadow-projection']).toEqual([
      0, 4, 30, 2,
    ]);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['shadow-projection']).toEqual(P);
    dispose();
  },
);

v.test(
  'B18: a $focus borderTop over a base border returns to the base width after blur',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      $focus: { borderTop: { width: 6 } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 2, 2, 2]);
    v.expect(shaderOf(changed).props['border-color']).toBe(RED);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    dispose();
  },
);

v.test(
  'a border removed with a transition fades out (RGB kept, alpha and width down) and comes back from transparent',
  async () => {
    const anims = watchAnimations();
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      transition: { border: { duration: 400, easing: 'linear' } },
      $focus: { border: { color: BLUE, width: 6 } },
    });
    // The first focus makes the shader (no animation: there was none).
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 6, 6, 6]);

    changed.states.remove('$focus');
    await wait(150);
    const color = shaderOf(changed).props['border-color'];
    const w = (shaderOf(changed).props['border-w'] as number[])[0]!;
    v.expect(rgbOf(color)).toBe(rgbOf(BLUE));
    v.expect(alphaOf(color)).toBeGreaterThan(0);
    v.expect(alphaOf(color)).toBeLessThan(0xff);
    v.expect(w).toBeGreaterThan(0);
    v.expect(w).toBeLessThan(6);
    await anims.done();
    // Draws as a never-focused node, which has no shader: no border.
    v.expect(shaderOf(never)).toBeNull();
    v.expect(shaderOf(changed).props['border-w']).toEqual([0, 0, 0, 0]);
    v.expect(alphaOf(shaderOf(changed).props['border-color'])).toBe(0);

    changed.states.add('$focus');
    await wait(150);
    const back = shaderOf(changed).props['border-color'];
    v.expect(rgbOf(back)).toBe(rgbOf(BLUE));
    v.expect(alphaOf(back)).toBeGreaterThan(0);
    v.expect(alphaOf(back)).toBeLessThan(0xff);
    await anims.done();
    v.expect(shaderOf(changed).props['border-color']).toBe(BLUE);
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 6, 6, 6]);
    anims.restore();
    dispose();
  },
);

v.test(
  'an animated undo of borderRadius shrinks the radius and ends as a never-focused node',
  async () => {
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
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    anims.restore();
    dispose();
  },
);

v.test(
  'an animated undo of a shadow projection ends as a never-focused node',
  async () => {
    const anims = watchAnimations();
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      shadow: { color: SHADOW, y: 4 },
      transition: { shadow: { duration: 60 } },
      $focus: { shadow: { color: SHADOW, projection: [3, 6, 30, 3] } },
    });
    changed.states.add('$focus');
    await anims.done();
    v.expect(shaderOf(changed).props['shadow-projection']).toEqual([
      3, 6, 30, 3,
    ]);
    changed.states.remove('$focus');
    await anims.done();
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    anims.restore();
    dispose();
  },
);

// Two border objects in one state (round 3, finding A). The undo removes
// both before anything is rebuilt, so no animation keeps a removed
// object's element. Pinned for both key orders, with and without a base.
for (const topFirst of [false, true]) {
  const order = topFirst ? 'borderTop first' : 'border first';
  const focus = (style: NodeStyles['$focus']) => style;
  const twoObjects = topFirst
    ? focus({ borderTop: { width: 8 }, border: { color: BLUE, width: 4 } })
    : focus({ border: { color: BLUE, width: 4 }, borderTop: { width: 8 } });

  v.test(
    `two border objects in $focus over none, ${order}, border transition: blur leaves no border`,
    async () => {
      const anims = watchAnimations();
      const { changed, never, dispose } = await pair({
        width: 100,
        height: 100,
        transition: { border: { duration: 120, easing: 'linear' } },
        $focus: twoObjects,
      });
      changed.states.add('$focus');
      await anims.done();
      changed.states.remove('$focus');
      await anims.done();
      await settle();
      v.expect(shaderOf(never)).toBeNull();
      v.expect(shaderOf(changed).props['border-w']).toEqual([0, 0, 0, 0]);
      v.expect(alphaOf(shaderOf(changed).props['border-color'])).toBe(0);
      anims.restore();
      dispose();
    },
  );

  v.test(
    `two border objects in $focus over a base border, ${order}, border transition: blur equals a never-focused node`,
    async () => {
      const anims = watchAnimations();
      const { changed, never, dispose } = await pair({
        width: 100,
        height: 100,
        border: { width: 2, color: RED },
        transition: { border: { duration: 120, easing: 'linear' } },
        $focus: twoObjects,
      });
      changed.states.add('$focus');
      await anims.done();
      changed.states.remove('$focus');
      await anims.done();
      await settle();
      v.expect(declaredProps(changed)).toEqual(declaredProps(never));
      anims.restore();
      dispose();
    },
  );
}

// The object written last wins for what it names, as in 1.6 (round 3,
// finding B); undo rebuilds from the objects that remain.
v.test(
  'a $focus border over a base borderBottom: the border wins while focused, the base after blur',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      borderBottom: { width: 2, color: RED },
      $focus: { border: { width: 4, color: BLUE } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([4, 4, 4, 4]);
    v.expect(shaderOf(changed).props['border-color']).toBe(BLUE);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['border-w']).toEqual([0, 0, 2, 0]);
    dispose();
  },
);

v.test(
  'a $focus border naming top over a base borderTop: its top wins while focused, the base after blur',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      borderTop: { width: 6, color: RED },
      $focus: { border: { top: 3, color: BLUE } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([3, 0, 0, 0]);
    v.expect(shaderOf(changed).props['border-color']).toBe(BLUE);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 0, 0, 0]);
    dispose();
  },
);

// Fix round 4: the border family is recomputed as a unit, by replaying the
// effective objects: the base ones as a never-focused node's props bag
// applies them, then the ones the states wrote, in state key order. No
// write-order record: what another node does in between changes nothing.

/** Render `changed` and `never` with `style`, and `other` with its own. */
async function trio(style: NodeStyles, other: NodeStyles) {
  let changed!: ElementNode;
  let never!: ElementNode;
  let third!: ElementNode;
  const dispose = render(() => (
    <view>
      <view ref={changed} style={style} />
      <view ref={never} x={200} style={style} />
      <view ref={third} x={400} style={other} />
    </view>
  ));
  await settle();
  return { changed, never, other: third, dispose };
}

v.test(
  'R1: a $focus border over a base border and borderTop: the border alone while focused, the base pair after blur',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      borderTop: { width: 6 },
      $focus: { border: { width: 4, color: BLUE } },
    });
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 2, 2, 2]);
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([4, 4, 4, 4]);
    v.expect(shaderOf(changed).props['border-color']).toBe(BLUE);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 2, 2, 2]);
    v.expect(shaderOf(changed).props['border-color']).toBe(RED);
    dispose();
  },
);

v.test(
  'R1t: a $focus border over a base border and borderTop, with a border transition',
  async () => {
    const anims = watchAnimations();
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      borderTop: { width: 6 },
      transition: { border: { duration: 60 } },
      $focus: { border: { width: 4, color: BLUE } },
    });
    changed.states.add('$focus');
    await anims.done();
    v.expect(shaderOf(changed).props['border-w']).toEqual([4, 4, 4, 4]);
    changed.states.remove('$focus');
    await anims.done();
    await settle();
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 2, 2, 2]);
    anims.restore();
    dispose();
  },
);

v.test(
  'R1c: a $focus border that changes only the colour over a base border and borderBottom',
  async () => {
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { width: 2, color: RED },
      borderBottom: { width: 6 },
      $focus: { border: { width: 2, color: BLUE } },
    });
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([2, 2, 2, 2]);
    v.expect(shaderOf(changed).props['border-color']).toBe(BLUE);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['border-w']).toEqual([2, 2, 6, 2]);
    dispose();
  },
);

v.test(
  'M1: two states with border objects: each change replays what the merged object holds',
  async () => {
    const { changed, never, dispose } = await pair({
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
    // A never-focused node has no shader: no border drawn.
    v.expect(shaderOf(never)).toBeNull();
    v.expect(shaderOf(changed).props['border-w']).toEqual([0, 0, 0, 0]);
    v.expect(alphaOf(shaderOf(changed).props['border-color'])).toBe(0);
    dispose();
  },
);

for (const [label, other] of [
  [
    'border',
    { width: 50, height: 50, $focus: { border: { width: 3, color: BLUE } } },
  ],
  [
    'shadow',
    { width: 50, height: 50, $focus: { shadow: { color: SHADOW, blur: 10 } } },
  ],
] as const) {
  v.test(
    `G2: another node gaining a $focus ${label} between a focus and its blur leaves the blurred node as a never-focused one`,
    async () => {
      const {
        changed,
        never,
        other: y,
        dispose,
      } = await trio(
        {
          width: 100,
          height: 100,
          border: { width: 2, color: RED },
          borderTop: { width: 6 },
          $focus: { borderBottom: { width: 4 } },
        },
        other,
      );
      changed.states.add('$focus');
      v.expect(shaderOf(changed).props['border-w']).toEqual([6, 2, 4, 2]);
      // The focus manager's order: the new element gains $focus, then the
      // old one loses it.
      y.states.add('$focus');
      changed.states.remove('$focus');
      v.expect(declaredProps(changed)).toEqual(declaredProps(never));
      v.expect(shaderOf(changed).props['border-w']).toEqual([6, 2, 2, 2]);
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
  'a setter that throws mid state change leaves no state behind: later direct border writes and the blur are right',
  async () => {
    let thrown = false;
    const { changed, never, dispose } = await pair({
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
    changed.borderLeft = undefined as unknown as NodeStyles['borderLeft'];
    v.expect(shaderOf(changed).props['border-w']).toEqual([2, 2, 2, 2]);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    v.expect(shaderOf(changed).props['border-color']).toBe(RED);
    dispose();
  },
);

v.test(
  'a style listing a side before border: focus and blur agree with a never-focused node',
  async () => {
    // A never-focused node's bag applies the vec4 (border-w) before the
    // element aliases (border-top), whatever the style's key order: the
    // base objects are replayed the same way.
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      borderTop: { width: 6 },
      border: { width: 2, color: RED },
      $focus: { borderBottom: { width: 4 } },
    });
    v.expect(shaderOf(never).props['border-w']).toEqual([6, 2, 2, 2]);
    changed.states.add('$focus');
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 2, 4, 2]);
    changed.states.remove('$focus');
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    dispose();
  },
);
