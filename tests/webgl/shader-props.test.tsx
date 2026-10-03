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
import { Rounded, RoundedWithBorder } from '@solidtv/renderer/webgl/shaders';
import { render, renderer, settle } from './setup.js';

// The names Solid's convertToShader creates, as an app registers them
// (bench/src/arm-v2.ts).
renderer.registerShaderType('rounded', Rounded);
renderer.registerShaderType('roundedWithBorder', RoundedWithBorder);

const BLUE = 0x0000ffff;

type Shader = {
  shaderType: { props: Record<string, unknown> };
  props: Record<string, unknown>;
};
const shaderOf = (node: ElementNode) =>
  (node.lng as unknown as { shader: Shader }).shader;

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
