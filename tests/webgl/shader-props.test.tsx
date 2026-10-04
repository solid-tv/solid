/**
 * State styles and shader props on the real renderer: a renderer v2 shader's
 * `props` is a facade over the shader's resolved values, so what a node
 * holds after a state change is read through it, prop by prop, against a
 * node that never changed.
 *
 *   pnpm test:webgl
 */
import * as v from 'vitest';
import type { ElementNode, NodeStyles } from '@solidtv/solid';
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
    const { changed, never, dispose } = await pair({
      width: 100,
      height: 100,
      border: { color: 0x00000000 },
      transition: { border: { duration: 30 } },
      $focus: { border: { color: BLUE, width: 6, align: 'center' } },
    });
    changed.states.add('$focus');
    await settle();
    v.expect(shaderOf(changed).props['border-w']).toEqual([6, 6, 6, 6]);
    changed.states.remove('$focus');
    await settle();
    v.expect(declaredProps(changed)).toEqual(declaredProps(never));
    dispose();
  },
);
